import {
  readRow,
  readRows,
  agentRunRow,
  opsHistoryRow,
  sessionHistoryRow,
  agentLogRow,
  operationRow,
  memoryRow,
  type AgentRunRow,
  type OpsHistoryRow
} from './sqlite/rows'
import { normalizeExecutionMode } from '../shared/execution-plan'
import { existsSync, mkdirSync } from 'fs'
import type { DatabaseSync } from 'node:sqlite'

import { getCrescentDatabasePath, getCrescentDir } from './crescent-paths'
import type {
  AgentMemoryRecord,
  OperationRecord,
  OpsHistoryRating,
  OpsHistoryRecord,
  StoredAgentLogEntry,
  StoredAgentRun,
  SessionTokenUsage,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionTab
} from './agent/types'
import type { CrescentMemoryFile } from './crescent-store'
import { parseAgentRunTrace, serializeAgentRunTrace } from '../shared/agent-run-trace'
import { isAgentStyle, type AgentStyle } from '../shared/agent-style'

let database: DatabaseSync | undefined

function parseStoredAgentStyle(value: string | null | undefined): AgentStyle | undefined {
  return isAgentStyle(value) ? value : undefined
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
  ensureColumn(db, 'session_tabs', 'agent_style', 'TEXT')
  ensureColumn(db, 'session_tabs', 'execution_mode', 'TEXT')
  ensureColumn(db, 'session_tabs', 'handoff_blocked', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'session_tabs', 'expected_target', 'TEXT')
  ensureColumn(db, 'session_tabs', 'connection_origin', 'TEXT')
  ensureColumn(db, 'agent_logs', 'run_id', 'TEXT')
  ensureColumn(db, 'agent_runs', 'started_at', 'TEXT')
  ensureColumn(db, 'agent_runs', 'elapsed_ms', 'INTEGER')
  ensureColumn(db, 'agent_runs', 'trace_json', 'TEXT')
  ensureColumn(db, 'agent_runs', 'input_tokens', 'INTEGER')
  ensureColumn(db, 'agent_runs', 'output_tokens', 'INTEGER')
  ensureColumn(db, 'agent_runs', 'cache_read_tokens', 'INTEGER')
  ensureColumn(db, 'agent_runs', 'cache_write_tokens', 'INTEGER')
  ensureColumn(db, 'ops_history_records', 'connection_id', "TEXT NOT NULL DEFAULT ''")
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ops_history_connection_updated_at
      ON ops_history_records (connection_id, updated_at);
  `)
}

/** Main-only metadata read: restore execution intent before any PTY can be used. No logs/credentials. */
export function readStoredExecutionIntent(tabId: string):
  | {
      isSsh: boolean
      blocked: boolean
      expectedTarget?: string
      connectionId?: string
      connectionOrigin?: import('../shared/connection-state').ConnectionOrigin
    }
  | undefined {
  const row = getDatabase()
    .prepare(
      'SELECT is_ssh, handoff_blocked, expected_target, connection_id, connection_origin FROM session_tabs WHERE tab_id = ?'
    )
    .get(tabId)
  if (!row) return undefined
  if (![0, 1].includes(row.is_ssh as number) || ![0, 1].includes(row.handoff_blocked as number))
    return { isSsh: false, blocked: true }
  return {
    isSsh: row.is_ssh === 1,
    blocked: row.handoff_blocked === 1,
    expectedTarget: typeof row.expected_target === 'string' ? row.expected_target : undefined,
    connectionId: typeof row.connection_id === 'string' ? row.connection_id : undefined,
    connectionOrigin: ['manual-shell', 'connection-card', 'special-ssh'].includes(
      String(row.connection_origin)
    )
      ? (row.connection_origin as import('../shared/connection-state').ConnectionOrigin)
      : undefined
  }
}

export function saveSessionTabs(tabs: StoredSessionTab[]): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO session_tabs (
      tab_id, title, connection_id, connection_name, is_ssh, terminal_cwd, terminal_mode, agent_style, execution_mode, handoff_blocked, expected_target, connection_origin, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      agent_style = excluded.agent_style,
      execution_mode = excluded.execution_mode,
      handoff_blocked = excluded.handoff_blocked,
      expected_target = excluded.expected_target,
      connection_origin = excluded.connection_origin,
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
      tab.agentStyle ?? null,
      normalizeExecutionMode(tab.executionMode),
      tab.handoffBlocked ? 1 : 0,
      tab.expectedTarget ?? null,
      tab.connectionOrigin ?? null,
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

export function getAgentLog(tabId: string, logId: number): StoredAgentLogEntry | undefined {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId || !Number.isFinite(logId)) return undefined
  const row = readRow(
    getDatabase()
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
      WHERE tab_id = ? AND log_id = ?
    `
      )
      .get(normalizedTabId, logId),
    agentLogRow
  )
  return row
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

const AGENT_RUN_SELECT_COLUMNS = `
  run_id AS runId,
  tab_id AS tabId,
  input,
  status,
  connection_id AS connectionId,
  output,
  error,
  started_at AS startedAt,
  elapsed_ms AS elapsedMs,
  trace_json AS traceJson,
  input_tokens AS inputTokens,
  output_tokens AS outputTokens,
  cache_read_tokens AS cacheReadTokens,
  cache_write_tokens AS cacheWriteTokens
`

export function saveAgentRun(run: StoredAgentRun): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const startedAt = run.startedAt ?? (run.status === 'running' ? now : undefined)
  const traceJson = run.trace ? serializeAgentRunTrace(run.trace) : null
  const inputTokens = optionalTokenCount(run.inputTokens)
  const outputTokens = optionalTokenCount(run.outputTokens)
  const cacheReadTokens = optionalTokenCount(run.cacheReadTokens)
  const cacheWriteTokens = optionalTokenCount(run.cacheWriteTokens)

  db.prepare(
    `
    INSERT INTO agent_runs (
      run_id, tab_id, input, status, connection_id, output, error,
      started_at, elapsed_ms, trace_json, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      connection_id = excluded.connection_id,
      output = excluded.output,
      error = excluded.error,
      started_at = COALESCE(excluded.started_at, agent_runs.started_at),
      elapsed_ms = excluded.elapsed_ms,
      trace_json = COALESCE(excluded.trace_json, agent_runs.trace_json),
      input_tokens = COALESCE(excluded.input_tokens, agent_runs.input_tokens),
      output_tokens = COALESCE(excluded.output_tokens, agent_runs.output_tokens),
      cache_read_tokens = COALESCE(excluded.cache_read_tokens, agent_runs.cache_read_tokens),
      cache_write_tokens = COALESCE(excluded.cache_write_tokens, agent_runs.cache_write_tokens),
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
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    now,
    now
  )
}

export function getAgentRun(runId: string): StoredAgentRun | undefined {
  const normalizedRunId = runId.trim()
  if (!normalizedRunId) return undefined

  const row = readRow(
    getDatabase()
      .prepare(
        `
      SELECT ${AGENT_RUN_SELECT_COLUMNS}
      FROM agent_runs
      WHERE run_id = ?
    `
      )
      .get(normalizedRunId),
    agentRunRow
  )

  if (!row) return undefined
  return mapStoredAgentRun(row)
}

export function listAgentRunsForTab(tabId: string, limit = 50): StoredAgentRun[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  const rows = readRows(
    getDatabase()
      .prepare(
        `
      SELECT ${AGENT_RUN_SELECT_COLUMNS}
      FROM agent_runs
      WHERE tab_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `
      )
      .all(normalizedTabId, limit),
    agentRunRow
  )

  return rows.map(mapStoredAgentRun)
}

export function listAllAgentRunsForTab(tabId: string): StoredAgentRun[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  const rows = readRows(
    getDatabase()
      .prepare(
        `
      SELECT ${AGENT_RUN_SELECT_COLUMNS}
      FROM agent_runs
      WHERE tab_id = ?
      ORDER BY COALESCE(started_at, created_at) ASC, run_id ASC
    `
      )
      .all(normalizedTabId),
    agentRunRow
  )

  return rows.map(mapStoredAgentRun)
}

export function getSessionTokenUsage(tabId: string): SessionTokenUsage {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  const row = getDatabase()
    .prepare(
      `
      SELECT
        COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS input,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS output,
        COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0) AS cacheRead,
        COALESCE(SUM(COALESCE(cache_write_tokens, 0)), 0) AS cacheWrite
      FROM agent_runs
      WHERE tab_id = ?
    `
    )
    .get(normalizedTabId)

  return {
    input: readSqlCount(row?.input),
    output: readSqlCount(row?.output),
    cacheRead: readSqlCount(row?.cacheRead),
    cacheWrite: readSqlCount(row?.cacheWrite)
  }
}

function readSqlCount(value: unknown): number {
  if (typeof value === 'bigint') {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return 0
}

function mapStoredAgentRun(row: AgentRunRow): StoredAgentRun {
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
    trace: parseAgentRunTrace(row.traceJson ?? undefined),
    inputTokens: typeof row.inputTokens === 'number' ? row.inputTokens : undefined,
    outputTokens: typeof row.outputTokens === 'number' ? row.outputTokens : undefined,
    cacheReadTokens: typeof row.cacheReadTokens === 'number' ? row.cacheReadTokens : undefined,
    cacheWriteTokens: typeof row.cacheWriteTokens === 'number' ? row.cacheWriteTokens : undefined
  }
}

function optionalTokenCount(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
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

  const row = readRow(
    getDatabase()
      .prepare(
        `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE run_id = ?
    `
      )
      .get(normalizedRunId),
    opsHistoryRow
  )

  return row ? mapOpsHistoryRow(row) : undefined
}

/** @deprecated Prefer listOpsHistoryForConnection — feedback is scoped to SSH connections. */
export function listOpsHistoryForTab(tabId: string, limit = 20): OpsHistoryRecord[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  const rows = readRows(
    getDatabase()
      .prepare(
        `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE tab_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `
      )
      .all(normalizedTabId, Math.max(1, Math.min(limit, 50))),
    opsHistoryRow
  )

  return rows.map(mapOpsHistoryRow)
}

export function listOpsHistoryForConnection(connectionId: string, limit = 20): OpsHistoryRecord[] {
  const normalizedConnectionId = connectionId.trim()
  if (!normalizedConnectionId) return []

  const rows = readRows(
    getDatabase()
      .prepare(
        `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE connection_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `
      )
      .all(normalizedConnectionId, Math.max(1, Math.min(limit, 100))),
    opsHistoryRow
  )

  return rows.map(mapOpsHistoryRow)
}

export function getOpsHistoryById(id: string): OpsHistoryRecord | undefined {
  const normalizedId = id.trim()
  if (!normalizedId) return undefined

  const row = readRow(
    getDatabase()
      .prepare(
        `
      SELECT ${OPS_HISTORY_SELECT}
      FROM ops_history_records
      WHERE id = ?
    `
      )
      .get(normalizedId),
    opsHistoryRow
  )

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
  const rows = readRows(
    getDatabase()
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
        tab.agent_style AS agentStyle,
        tab.execution_mode AS executionMode,
        tab.handoff_blocked AS handoffBlocked,
        tab.expected_target AS expectedTarget,
        tab.connection_origin AS connectionOrigin,
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
      .all(limit),
    sessionHistoryRow
  )

  return rows.map((row) => ({
    tabId: row.tabId,
    title: row.title,
    connectionId: row.connectionId ?? undefined,
    connectionName: row.connectionName ?? undefined,
    isSsh: Boolean(row.isSsh),
    terminalCwd: row.terminalCwd ?? undefined,
    terminalMode: row.terminalMode ?? undefined,
    agentStyle: parseStoredAgentStyle(row.agentStyle),
    executionMode: normalizeExecutionMode(row.executionMode),
    handoffBlocked: Boolean(row.handoffBlocked),
    expectedTarget: row.expectedTarget ?? undefined,
    connectionOrigin: row.connectionOrigin ?? undefined,
    updatedAt: row.updatedAt,
    summary: row.summary ?? undefined,
    lastMessage: row.lastMessage ?? undefined,
    lastMessageAt: row.lastMessageAt ?? undefined,
    runCount: Number(row.runCount ?? 0)
  }))
}

export function readSessionHistoryDetail(tabId: string): StoredSessionHistoryDetail | undefined {
  const tab = readRow(
    getDatabase()
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
        agent_style AS agentStyle,
        execution_mode AS executionMode,
        handoff_blocked AS handoffBlocked,
        expected_target AS expectedTarget,
        connection_origin AS connectionOrigin,
        summary,
        title_locked AS titleLocked,
        updated_at AS updatedAt
      FROM session_tabs
      WHERE tab_id = ?
    `
      )
      .get(tabId),
    sessionHistoryRow
  )

  if (!tab) return undefined

  const logs = readRows(
    getDatabase()
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
      .all(tabId),
    agentLogRow
  )

  const [historyItem] = listSessionHistory(200).filter((item) => item.tabId === tabId)

  return {
    tabId: tab.tabId,
    title: tab.title,
    connectionId: tab.connectionId ?? undefined,
    connectionName: tab.connectionName ?? undefined,
    isSsh: Boolean(tab.isSsh),
    terminalCwd: tab.terminalCwd ?? undefined,
    terminalMode: tab.terminalMode ?? undefined,
    agentStyle: parseStoredAgentStyle(tab.agentStyle),
    executionMode: normalizeExecutionMode(tab.executionMode),
    handoffBlocked: Boolean(tab.handoffBlocked),
    expectedTarget: tab.expectedTarget ?? undefined,
    connectionOrigin: tab.connectionOrigin ?? undefined,
    updatedAt: tab.updatedAt,
    summary: tab.summary ?? undefined,
    lastMessage: historyItem?.lastMessage,
    lastMessageAt: historyItem?.lastMessageAt,
    runCount: historyItem?.runCount ?? 0,
    logs
  }
}

/** Page older agent logs for a tab (exclusive beforeLogId). Newest-first page then reversed. */
export function listAgentLogs(
  tabId: string,
  options?: { beforeLogId?: number; limit?: number }
): StoredAgentLogEntry[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []
  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 40)))
  const beforeLogId =
    typeof options?.beforeLogId === 'number' && Number.isFinite(options.beforeLogId)
      ? options.beforeLogId
      : undefined

  const rows = (
    beforeLogId == null
      ? readRows(
          getDatabase()
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
        ORDER BY log_id DESC
        LIMIT ?
      `
            )
            .all(normalizedTabId, limit),
          agentLogRow
        )
      : readRows(
          getDatabase()
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
        WHERE tab_id = ? AND log_id < ?
        ORDER BY log_id DESC
        LIMIT ?
      `
            )
            .all(normalizedTabId, beforeLogId, limit),
          agentLogRow
        )
  ).slice()

  return rows.reverse()
}

export function countAgentLogs(tabId: string): number {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return 0
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM agent_logs WHERE tab_id = ?`)
    .get(normalizedTabId)
  return Number(row?.count ?? 0)
}

/** Revision metadata for edits anywhere in a conversation; no history text crosses IPC. */
export function sessionKnowledgeRevision(tabId: string): string {
  return JSON.stringify(
    getDatabase()
      .prepare(
        'SELECT COUNT(*) AS count, MAX(log_id) AS lastId, MAX(updated_at) AS updatedAt, SUM(length(text)) AS characters FROM agent_logs WHERE tab_id=?'
      )
      .get(tabId)
  )
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
    .get(normalizedTabId)

  return {
    ok: Number(result.changes) > 0,
    title: typeof row?.title === 'string' ? row.title : title,
    summary: typeof row?.summary === 'string' ? row.summary : summary,
    updatedAt
  }
}

export function readSessionLogsForSummary(tabId: string): StoredAgentLogEntry[] {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return []

  return readRows(
    getDatabase()
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
      .all(normalizedTabId),
    agentLogRow
  )
}

export function readCommandWhitelistFromDb(): string[] {
  const rows = getDatabase()
    .prepare('SELECT rule FROM command_whitelist ORDER BY position ASC, created_at ASC')
    .all()

  return rows.flatMap((row) => (typeof row.rule === 'string' ? [row.rule] : []))
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
    .all()
  const longTermRows = db
    .prepare(
      `
      SELECT kind, content
      FROM agent_memory_long_term
      ORDER BY kind ASC, position ASC
    `
    )
    .all()

  return {
    shortTerm: readRows(shortTermRows, memoryRow).slice(-100),
    longTerm: {
      preferences: longTermRows
        .filter((row) => row.kind === 'preferences')
        .flatMap((row) => (typeof row.content === 'string' ? [row.content] : []))
        .slice(-100),
      notes: longTermRows
        .filter((row) => row.kind === 'notes')
        .flatMap((row) => (typeof row.content === 'string' ? [row.content] : []))
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

export function readCrescentDbValue(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM app_metadata WHERE key = ?').get(key)

  return typeof row?.value === 'string' ? row.value : undefined
}

export function writeCrescentDbValue(key: string, value: string): void {
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
    .run(key, value, new Date().toISOString())
}

export function readCrescentDbFlag(key: string): boolean {
  return readCrescentDbValue(key) === 'true'
}

export function writeCrescentDbFlag(key: string, value: boolean): void {
  writeCrescentDbValue(key, value ? 'true' : 'false')
}

function getDatabase(): DatabaseSync {
  if (database) return database

  const dir = getCrescentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // Lazy-load node:sqlite so its ExperimentalWarning fires only after
  // main/index.ts has installed the warning filter. A static top-level import
  // would emit the warning before the filter exists.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite = require('node:sqlite') as typeof import('node:sqlite')
  database = new sqlite.DatabaseSync(getCrescentDatabasePath())
  initializeCrescentDatabase()
  return database
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (columns.some((entry) => entry.name === column)) return

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function readOperationRecordsFromDb(): OperationRecord[] {
  const rows = readRows(
    getDatabase()
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
      .all(),
    operationRow
  )

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
