import { existsSync, mkdirSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'

import { getCrescentDatabasePath, getCrescentDir } from './crescent-paths'
import type {
  AgentMemoryRecord,
  OperationRecord,
  OpsHistoryRating,
  OpsHistoryRecord,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionTab
} from './agent/types'
import type { CrescentMemoryFile } from './crescent-store'
import { parseAgentRunTrace, serializeAgentRunTrace } from '../shared/agent-run-trace'

let database: DatabaseSync | undefined

interface SessionHistoryRow {
  tabId: string
  title: string
  connectionId?: string | null
  connectionName?: string | null
  isSsh: 0 | 1
  terminalCwd?: string | null
  terminalMode?: 'pty' | 'pipe' | null
  updatedAt: string
  summary?: string | null
  titleLocked?: 0 | 1
  lastMessage?: string | null
  lastMessageAt?: string | null
  runCount?: number
}

export function initializeCrescentDatabase(): void {
  const db = getDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_tabs (
      tab_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      connection_id TEXT,
      connection_name TEXT,
      is_ssh INTEGER NOT NULL DEFAULT 0,
      terminal_cwd TEXT,
      terminal_mode TEXT,
      summary TEXT,
      title_locked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      tab_id TEXT NOT NULL,
      log_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tab_id, log_id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      connection_id TEXT,
      output TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_whitelist (
      rule TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_memory_short_term (
      position INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_memory_long_term (
      kind TEXT NOT NULL,
      position INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (kind, position)
    );

    CREATE TABLE IF NOT EXISTS operation_records (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      connection_id TEXT,
      connection_name TEXT,
      command TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      output TEXT
    );

    CREATE TABLE IF NOT EXISTS ops_history_records (
      id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL,
      connection_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL UNIQUE,
      rating TEXT NOT NULL,
      user_goal TEXT NOT NULL,
      path_summary TEXT NOT NULL,
      lesson TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_logs_tab_created_at
      ON agent_logs (tab_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tab_updated_at
      ON agent_runs (tab_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_operation_records_created_at
      ON operation_records (created_at);
    CREATE INDEX IF NOT EXISTS idx_ops_history_tab_created_at
      ON ops_history_records (tab_id, created_at);
  `)

  ensureColumn(db, 'session_tabs', 'summary', 'TEXT')
  ensureColumn(db, 'session_tabs', 'title_locked', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'agent_logs', 'run_id', 'TEXT')
  ensureColumn(db, 'agent_runs', 'started_at', 'TEXT')
  ensureColumn(db, 'agent_runs', 'elapsed_ms', 'INTEGER')
  ensureColumn(db, 'agent_runs', 'trace_json', 'TEXT')
  ensureColumn(db, 'ops_history_records', 'connection_id', "TEXT NOT NULL DEFAULT ''")
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ops_history_connection_updated_at
      ON ops_history_records (connection_id, updated_at);
  `)
}

export function saveSessionTabs(tabs: StoredSessionTab[]): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO session_tabs (
      tab_id, title, connection_id, connection_name, is_ssh, terminal_cwd, terminal_mode, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tab_id) DO UPDATE SET
      title = CASE
        WHEN session_tabs.title_locked = 1 THEN session_tabs.title
        ELSE excluded.title
      END,
      connection_id = excluded.connection_id,
      connection_name = excluded.connection_name,
      is_ssh = excluded.is_ssh,
      terminal_cwd = excluded.terminal_cwd,
      terminal_mode = excluded.terminal_mode,
      updated_at = excluded.updated_at
  `)

  for (const tab of tabs) {
    statement.run(
      tab.tabId,
      tab.title,
      tab.connectionId ?? null,
      tab.connectionName ?? null,
      tab.isSsh ? 1 : 0,
      tab.terminalCwd ?? null,
      tab.terminalMode ?? null,
      now
    )
  }
}

export function saveAgentLog(entry: StoredAgentLogEntry): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const runId = entry.runId?.trim() || null

  db.prepare(
    `
    INSERT INTO agent_logs (tab_id, log_id, kind, text, created_at, updated_at, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tab_id, log_id) DO UPDATE SET
      kind = excluded.kind,
      text = excluded.text,
      updated_at = excluded.updated_at,
      run_id = excluded.run_id
  `
  ).run(entry.tabId, entry.logId, entry.kind, entry.text, entry.createdAt, now, runId)
}

export function updateAgentLog(input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>): void {
  getDatabase()
    .prepare(
      `
      UPDATE agent_logs
      SET text = ?, updated_at = ?
      WHERE tab_id = ? AND log_id = ?
    `
    )
    .run(input.text, new Date().toISOString(), input.tabId, input.logId)
}

export function deleteAgentLogs(tabId: string, logIds: number[]): number {
  const normalizedTabId = tabId.trim()
  const ids = logIds.filter((id) => Number.isFinite(id))
  if (!normalizedTabId || ids.length === 0) return 0

  const db = getDatabase()
  const deleteOne = db.prepare('DELETE FROM agent_logs WHERE tab_id = ? AND log_id = ?')
  let removed = 0
  for (const logId of ids) {
    const result = deleteOne.run(normalizedTabId, logId)
    removed += Number(result.changes ?? 0)
  }
  return removed
}

export function saveAgentRun(run: StoredAgentRun): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const startedAt = run.startedAt ?? (run.status === 'running' ? now : undefined)
  const traceJson = run.trace ? serializeAgentRunTrace(run.trace) : null

  db.prepare(
    `
    INSERT INTO agent_runs (
      run_id, tab_id, input, status, connection_id, output, error,
      started_at, elapsed_ms, trace_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      connection_id = excluded.connection_id,
      output = excluded.output,
      error = excluded.error,
      started_at = COALESCE(excluded.started_at, agent_runs.started_at),
      elapsed_ms = excluded.elapsed_ms,
      trace_json = COALESCE(excluded.trace_json, agent_runs.trace_json),
      updated_at = excluded.updated_at
  `
  ).run(
    run.runId,
    run.tabId,
    run.input,
    run.status,
    run.connectionId ?? null,
    run.output ?? null,
    run.error ?? null,
    startedAt ?? null,
    typeof run.elapsedMs === 'number' ? run.elapsedMs : null,
    traceJson,
    now,
    now
  )
}

export function getAgentRun(runId: string): StoredAgentRun | undefined {
  const normalizedRunId = runId.trim()
  if (!normalizedRunId) return undefined

  const row = getDatabase()
    .prepare(
      `
      SELECT
        run_id AS runId,
        tab_id AS tabId,
        input,
        status,
        connection_id AS connectionId,
        output,
        error,
        started_at AS startedAt,
        elapsed_ms AS elapsedMs,
        trace_json AS traceJson
      FROM agent_runs
      WHERE run_id = ?
    `
    )
    .get(normalizedRunId) as
    | {
        runId: string
        tabId: string
        input: string
        status: StoredAgentRun['status']
        connectionId?: string | null
        output?: string | null
        error?: string | null
        startedAt?: string | null
        elapsedMs?: number | null
        traceJson?: string | null
      }
    | undefined

  if (!row) return undefined

  return {
    runId: row.runId,
    tabId: row.tabId,
    input: row.input,
    status: row.status,
    connectionId: row.connectionId ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt ?? undefined,
    elapsedMs: typeof row.elapsedMs === 'number' ? row.elapsedMs : undefined,
    trace: parseAgentRunTrace(row.traceJson ?? undefined)
  }
}

export function listAgentRunsForTab(tabId: string, limit = 50): StoredAgentRun[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  const rows = getDatabase()
    .prepare(
      `
      SELECT
        run_id AS runId,
        tab_id AS tabId,
        input,
        status,
        connection_id AS connectionId,
        output,
        error,
        started_at AS startedAt,
        elapsed_ms AS elapsedMs,
        trace_json AS traceJson
      FROM agent_runs
      WHERE tab_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `
    )
    .all(normalizedTabId, limit) as Array<{
    runId: string
    tabId: string
    input: string
    status: StoredAgentRun['status']
    connectionId?: string | null
    output?: string | null
    error?: string | null
    startedAt?: string | null
    elapsedMs?: number | null
    traceJson?: string | null
  }>

  return rows.map((row) => ({
    runId: row.runId,
    tabId: row.tabId,
    input: row.input,
    status: row.status,
    connectionId: row.connectionId ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt ?? undefined,
    elapsedMs: typeof row.elapsedMs === 'number' ? row.elapsedMs : undefined,
    trace: parseAgentRunTrace(row.traceJson ?? undefined)
  }))
}

export function upsertOpsHistoryRecord(
  input: Omit<OpsHistoryRecord, 'createdAt' | 'updatedAt'> & {
    createdAt?: string
    updatedAt?: string
  }
): OpsHistoryRecord | undefined {
  const tabId = input.tabId.trim()
  const connectionId = input.connectionId.trim()
  const runId = input.runId.trim()
  const rating = input.rating
  const userGoal = input.userGoal.trim()
  const pathSummary = input.pathSummary.trim()
  const lesson = input.lesson.trim()
  if (!tabId || !connectionId || !runId || !userGoal || !pathSummary) return undefined
  if (rating !== 'like' && rating !== 'dislike') return undefined

  const now = new Date().toISOString()
  const id = input.id.trim() || `ops-${crypto.randomUUID()}`
  const existing = getOpsHistoryByRunId(runId)
  const createdAt = existing?.createdAt ?? input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now

  getDatabase()
    .prepare(
      `
      INSERT INTO ops_history_records (
        id, tab_id, connection_id, run_id, rating, user_goal, path_summary, lesson, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        tab_id = excluded.tab_id,
        connection_id = excluded.connection_id,
        rating = excluded.rating,
        user_goal = excluded.user_goal,
        path_summary = excluded.path_summary,
        lesson = excluded.lesson,
        updated_at = excluded.updated_at
    `
    )
    .run(
      id,
      tabId,
      connectionId,
      runId,
      rating,
      userGoal,
      pathSummary,
      lesson,
      createdAt,
      updatedAt
    )

  return getOpsHistoryByRunId(runId)
}

const OPS_HISTORY_SELECT = `
  id,
  tab_id AS tabId,
  connection_id AS connectionId,
  run_id AS runId,
  rating,
  user_goal AS userGoal,
  path_summary AS pathSummary,
  lesson,
  created_at AS createdAt,
  updated_at AS updatedAt
`

export function getOpsHistoryByRunId(runId: string): OpsHistoryRecord | undefined {
  const normalizedRunId = runId.trim()
  if (!normalizedRunId) return undefined

  const row = getDatabase()
    .prepare(
      `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE run_id = ?
    `
    )
    .get(normalizedRunId) as OpsHistoryRow | undefined

  return row ? mapOpsHistoryRow(row) : undefined
}

/** @deprecated Prefer listOpsHistoryForConnection — feedback is scoped to SSH connections. */
export function listOpsHistoryForTab(tabId: string, limit = 20): OpsHistoryRecord[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  const rows = getDatabase()
    .prepare(
      `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE tab_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `
    )
    .all(normalizedTabId, Math.max(1, Math.min(limit, 50))) as unknown as OpsHistoryRow[]

  return rows.map(mapOpsHistoryRow)
}

export function listOpsHistoryForConnection(connectionId: string, limit = 20): OpsHistoryRecord[] {
  const normalizedConnectionId = connectionId.trim()
  if (!normalizedConnectionId) return []

  const rows = getDatabase()
    .prepare(
      `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE connection_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `
    )
    .all(normalizedConnectionId, Math.max(1, Math.min(limit, 100))) as unknown as OpsHistoryRow[]

  return rows.map(mapOpsHistoryRow)
}

export function getOpsHistoryById(id: string): OpsHistoryRecord | undefined {
  const normalizedId = id.trim()
  if (!normalizedId) return undefined

  const row = getDatabase()
    .prepare(
      `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE id = ?
    `
    )
    .get(normalizedId) as OpsHistoryRow | undefined

  return row ? mapOpsHistoryRow(row) : undefined
}

export function updateOpsHistoryRecord(input: {
  id: string
  rating?: OpsHistoryRating
  userGoal?: string
  pathSummary?: string
  lesson?: string
}): OpsHistoryRecord | undefined {
  const existing = getOpsHistoryById(input.id)
  if (!existing) return undefined

  const rating = input.rating ?? existing.rating
  const userGoal = (input.userGoal ?? existing.userGoal).trim()
  const pathSummary = (input.pathSummary ?? existing.pathSummary).trim()
  const lesson = (input.lesson ?? existing.lesson).trim()
  if (!userGoal || !pathSummary) return undefined
  if (rating !== 'like' && rating !== 'dislike') return undefined

  const updatedAt = new Date().toISOString()
  getDatabase()
    .prepare(
      `
      UPDATE ops_history_records
      SET rating = ?, user_goal = ?, path_summary = ?, lesson = ?, updated_at = ?
      WHERE id = ?
    `
    )
    .run(rating, userGoal, pathSummary, lesson, updatedAt, existing.id)

  return getOpsHistoryById(existing.id)
}

export function deleteOpsHistoryRecord(id: string): boolean {
  const normalizedId = id.trim()
  if (!normalizedId) return false

  const result = getDatabase()
    .prepare('DELETE FROM ops_history_records WHERE id = ?')
    .run(normalizedId)
  return Number(result.changes) > 0
}

export function deleteOpsHistoryForConnection(connectionId: string): number {
  const normalizedConnectionId = connectionId.trim()
  if (!normalizedConnectionId) return 0

  const result = getDatabase()
    .prepare('DELETE FROM ops_history_records WHERE connection_id = ?')
    .run(normalizedConnectionId)
  return Number(result.changes)
}

interface OpsHistoryRow {
  id: string
  tabId: string
  connectionId: string
  runId: string
  rating: OpsHistoryRating
  userGoal: string
  pathSummary: string
  lesson: string
  createdAt: string
  updatedAt: string
}

function mapOpsHistoryRow(row: OpsHistoryRow): OpsHistoryRecord {
  return {
    id: row.id,
    tabId: row.tabId,
    connectionId: row.connectionId ?? '',
    runId: row.runId,
    rating: row.rating,
    userGoal: row.userGoal,
    pathSummary: row.pathSummary,
    lesson: row.lesson ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listSessionHistory(limit = 80): StoredSessionHistoryItem[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT
        tab.tab_id AS tabId,
        tab.title,
        tab.connection_id AS connectionId,
        tab.connection_name AS connectionName,
        tab.is_ssh AS isSsh,
        tab.terminal_cwd AS terminalCwd,
        tab.terminal_mode AS terminalMode,
        tab.updated_at AS updatedAt,
        tab.summary AS summary,
        tab.title_locked AS titleLocked,
        (
          SELECT log.text
          FROM agent_logs log
          WHERE log.tab_id = tab.tab_id
          ORDER BY log.created_at DESC, log.log_id DESC
          LIMIT 1
        ) AS lastMessage,
        (
          SELECT log.created_at
          FROM agent_logs log
          WHERE log.tab_id = tab.tab_id
          ORDER BY log.created_at DESC, log.log_id DESC
          LIMIT 1
        ) AS lastMessageAt,
        (
          SELECT COUNT(*)
          FROM agent_runs run
          WHERE run.tab_id = tab.tab_id
        ) AS runCount
      FROM session_tabs tab
      WHERE EXISTS (
        SELECT 1 FROM agent_logs log WHERE log.tab_id = tab.tab_id
      ) OR EXISTS (
        SELECT 1 FROM agent_runs run WHERE run.tab_id = tab.tab_id
      )
      ORDER BY COALESCE(lastMessageAt, tab.updated_at) DESC
      LIMIT ?
    `
    )
    .all(limit) as unknown as SessionHistoryRow[]

  return rows.map((row) => ({
    tabId: row.tabId,
    title: row.title,
    connectionId: row.connectionId ?? undefined,
    connectionName: row.connectionName ?? undefined,
    isSsh: Boolean(row.isSsh),
    terminalCwd: row.terminalCwd ?? undefined,
    terminalMode: row.terminalMode ?? undefined,
    updatedAt: row.updatedAt,
    summary: row.summary ?? undefined,
    lastMessage: row.lastMessage ?? undefined,
    lastMessageAt: row.lastMessageAt ?? undefined,
    runCount: Number(row.runCount ?? 0)
  }))
}

export function readSessionHistoryDetail(tabId: string): StoredSessionHistoryDetail | undefined {
  const tab = getDatabase()
    .prepare(
      `
      SELECT
        tab_id AS tabId,
        title,
        connection_id AS connectionId,
        connection_name AS connectionName,
        is_ssh AS isSsh,
        terminal_cwd AS terminalCwd,
        terminal_mode AS terminalMode,
        summary,
        title_locked AS titleLocked,
        updated_at AS updatedAt
      FROM session_tabs
      WHERE tab_id = ?
    `
    )
    .get(tabId) as SessionHistoryRow | undefined

  if (!tab) return undefined

  const logs = getDatabase()
    .prepare(
      `
      SELECT
        tab_id AS tabId,
        log_id AS logId,
        kind,
        text,
        created_at AS createdAt,
        run_id AS runId
      FROM agent_logs
      WHERE tab_id = ?
      ORDER BY log_id ASC
    `
    )
    .all(tabId) as unknown as StoredAgentLogEntry[]

  const [historyItem] = listSessionHistory(200).filter((item) => item.tabId === tabId)

  return {
    tabId: tab.tabId,
    title: tab.title,
    connectionId: tab.connectionId ?? undefined,
    connectionName: tab.connectionName ?? undefined,
    isSsh: Boolean(tab.isSsh),
    terminalCwd: tab.terminalCwd ?? undefined,
    terminalMode: tab.terminalMode ?? undefined,
    updatedAt: tab.updatedAt,
    summary: tab.summary ?? undefined,
    lastMessage: historyItem?.lastMessage,
    lastMessageAt: historyItem?.lastMessageAt,
    runCount: historyItem?.runCount ?? 0,
    logs
  }
}

export function deleteSessionHistory(tabId: string): boolean {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return false

  const db = getDatabase()
  let changed = 0

  runInTransaction(db, () => {
    changed += Number(
      db.prepare('DELETE FROM agent_runs WHERE tab_id = ?').run(normalizedTabId).changes
    )
    changed += Number(
      db.prepare('DELETE FROM agent_logs WHERE tab_id = ?').run(normalizedTabId).changes
    )
    // Keep ops_history_records: they are keyed by SSH connection and guide later ops
    // on the same connection across chat/session lifecycles.
    changed += Number(
      db.prepare('DELETE FROM session_tabs WHERE tab_id = ?').run(normalizedTabId).changes
    )
  })

  return changed > 0
}

export function renameSessionHistory(tabId: string, title: string): boolean {
  const normalizedTabId = tabId.trim()
  const normalizedTitle = title.trim()
  if (!normalizedTabId || !normalizedTitle) return false

  const result = getDatabase()
    .prepare(
      `
      UPDATE session_tabs
      SET title = ?, title_locked = 1, updated_at = ?
      WHERE tab_id = ?
    `
    )
    .run(normalizedTitle, new Date().toISOString(), normalizedTabId)

  return Number(result.changes) > 0
}

export function updateSessionHistorySummary(input: {
  tabId: string
  title: string
  summary: string
}): { ok: boolean; title: string; summary: string; updatedAt: string } {
  const normalizedTabId = input.tabId.trim()
  const title = input.title.trim()
  const summary = input.summary.trim()
  const updatedAt = new Date().toISOString()
  if (!normalizedTabId || !title || !summary) {
    return { ok: false, title, summary, updatedAt }
  }

  const result = getDatabase()
    .prepare(
      `
      UPDATE session_tabs
      SET
        title = CASE WHEN title_locked = 1 THEN title ELSE ? END,
        summary = ?,
        updated_at = ?
      WHERE tab_id = ?
    `
    )
    .run(title, summary, updatedAt, normalizedTabId)

  const row = getDatabase()
    .prepare('SELECT title, summary FROM session_tabs WHERE tab_id = ?')
    .get(normalizedTabId) as { title?: string; summary?: string } | undefined

  return {
    ok: Number(result.changes) > 0,
    title: row?.title ?? title,
    summary: row?.summary ?? summary,
    updatedAt
  }
}

export function readSessionLogsForSummary(tabId: string): StoredAgentLogEntry[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  return getDatabase()
    .prepare(
      `
      SELECT
        tab_id AS tabId,
        log_id AS logId,
        kind,
        text,
        created_at AS createdAt,
        run_id AS runId
      FROM agent_logs
      WHERE tab_id = ?
      ORDER BY log_id ASC
      LIMIT 80
    `
    )
    .all(normalizedTabId) as unknown as StoredAgentLogEntry[]
}

export function readCommandWhitelistFromDb(): string[] {
  const rows = getDatabase()
    .prepare('SELECT rule FROM command_whitelist ORDER BY position ASC, created_at ASC')
    .all() as Array<{ rule: string }>

  return rows.map((row) => row.rule)
}

export function writeCommandWhitelistToDb(rules: string[]): string[] {
  const normalized = normalizeStringList(rules)
  const db = getDatabase()
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO command_whitelist (rule, position, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `)

  runInTransaction(db, () => {
    db.prepare('DELETE FROM command_whitelist').run()
    normalized.forEach((rule, index) => insert.run(rule, index, now, now))
  })

  return normalized
}

export function readCrescentMemoryFromDb(): CrescentMemoryFile {
  const db = getDatabase()
  const shortTermRows = db
    .prepare(
      `
      SELECT role, content, created_at AS createdAt
      FROM agent_memory_short_term
      ORDER BY position ASC
    `
    )
    .all() as unknown as AgentMemoryRecord[]
  const longTermRows = db
    .prepare(
      `
      SELECT kind, content
      FROM agent_memory_long_term
      ORDER BY kind ASC, position ASC
    `
    )
    .all() as Array<{ kind: 'preferences' | 'notes'; content: string }>

  return {
    shortTerm: shortTermRows.filter(isMemoryRecord).slice(-100),
    longTerm: {
      preferences: longTermRows
        .filter((row) => row.kind === 'preferences')
        .map((row) => row.content)
        .slice(-100),
      notes: longTermRows
        .filter((row) => row.kind === 'notes')
        .map((row) => row.content)
        .slice(-100),
      operations: readOperationRecordsFromDb()
    }
  }
}

export function writeCrescentMemoryToDb(
  memory: CrescentMemoryFile,
  options: { replaceOperations?: boolean } = {}
): CrescentMemoryFile {
  const normalized: CrescentMemoryFile = {
    shortTerm: memory.shortTerm.filter(isMemoryRecord).slice(-100),
    longTerm: {
      preferences: normalizeStringList(memory.longTerm.preferences).slice(-100),
      notes: normalizeStringList(memory.longTerm.notes).slice(-100),
      operations: memory.longTerm.operations.filter(isOperationRecord).slice(0, 500)
    }
  }
  const db = getDatabase()

  runInTransaction(db, () => {
    db.prepare('DELETE FROM agent_memory_short_term').run()
    db.prepare('DELETE FROM agent_memory_long_term').run()

    const shortTermStatement = db.prepare(`
      INSERT INTO agent_memory_short_term (position, role, content, created_at)
      VALUES (?, ?, ?, ?)
    `)
    normalized.shortTerm.forEach((record, index) => {
      shortTermStatement.run(index, record.role, record.content, record.createdAt)
    })

    const longTermStatement = db.prepare(`
      INSERT INTO agent_memory_long_term (kind, position, content, created_at)
      VALUES (?, ?, ?, ?)
    `)
    const now = new Date().toISOString()
    normalized.longTerm.preferences.forEach((content, index) => {
      longTermStatement.run('preferences', index, content, now)
    })
    normalized.longTerm.notes.forEach((content, index) => {
      longTermStatement.run('notes', index, content, now)
    })

    if (options.replaceOperations) {
      db.prepare('DELETE FROM operation_records').run()

      const operationStatement = db.prepare(`
        INSERT INTO operation_records (
          id, created_at, connection_id, connection_name, command, status, summary, output
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      normalized.longTerm.operations.forEach((record) => {
        operationStatement.run(
          record.id,
          record.createdAt,
          record.connectionId ?? null,
          record.connectionName ?? null,
          record.command ?? null,
          record.status,
          record.summary,
          record.output ?? null
        )
      })
    }
  })

  return normalized
}

export function appendOperationRecordToDb(record: OperationRecord): OperationRecord {
  const db = getDatabase()

  db.prepare(
    `
    INSERT INTO operation_records (
      id, created_at, connection_id, connection_name, command, status, summary, output
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      connection_id = excluded.connection_id,
      connection_name = excluded.connection_name,
      command = excluded.command,
      status = excluded.status,
      summary = excluded.summary,
      output = excluded.output
  `
  ).run(
    record.id,
    record.createdAt,
    record.connectionId ?? null,
    record.connectionName ?? null,
    record.command ?? null,
    record.status,
    record.summary,
    record.output ?? null
  )

  db.prepare(
    `
    DELETE FROM operation_records
    WHERE id NOT IN (
      SELECT id FROM operation_records ORDER BY created_at DESC LIMIT 500
    )
  `
  ).run()

  return record
}

export function readCrescentDbFlag(key: string): boolean {
  const row = getDatabase().prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as
    | { value?: string }
    | undefined

  return row?.value === 'true'
}

export function writeCrescentDbFlag(key: string, value: boolean): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
    )
    .run(key, value ? 'true' : 'false', new Date().toISOString())
}

function getDatabase(): DatabaseSync {
  if (database) return database

  const dir = getCrescentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  database = new DatabaseSync(getCrescentDatabasePath())
  initializeCrescentDatabase()
  return database
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  if (columns.some((entry) => entry.name === column)) return

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function readOperationRecordsFromDb(): OperationRecord[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT
        id,
        created_at AS createdAt,
        connection_id AS connectionId,
        connection_name AS connectionName,
        command,
        status,
        summary,
        output
      FROM operation_records
      ORDER BY created_at DESC
      LIMIT 500
    `
    )
    .all() as unknown as OperationRecord[]

  return rows.filter(isOperationRecord)
}

function runInTransaction(db: DatabaseSync, callback: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    callback()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
}

function isMemoryRecord(value: unknown): value is AgentMemoryRecord {
  return (
    Boolean(value && typeof value === 'object' && !Array.isArray(value)) &&
    ((value as AgentMemoryRecord).role === 'user' ||
      (value as AgentMemoryRecord).role === 'assistant') &&
    typeof (value as AgentMemoryRecord).content === 'string' &&
    typeof (value as AgentMemoryRecord).createdAt === 'string'
  )
}

function isOperationRecord(value: unknown): value is OperationRecord {
  return (
    Boolean(value && typeof value === 'object' && !Array.isArray(value)) &&
    typeof (value as OperationRecord).id === 'string' &&
    typeof (value as OperationRecord).createdAt === 'string' &&
    ((value as OperationRecord).status === 'success' ||
      (value as OperationRecord).status === 'error') &&
    typeof (value as OperationRecord).summary === 'string'
  )
}
