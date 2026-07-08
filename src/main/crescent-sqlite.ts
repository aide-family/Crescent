import { existsSync, mkdirSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'

import { getCrescentDatabasePath, getCrescentDir } from './crescent-paths'
import type {
  AgentMemoryRecord,
  OperationRecord,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionTab
} from './agent/types'
import type { CrescentMemoryFile } from './crescent-store'

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
      title = excluded.title,
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

  db.prepare(
    `
    INSERT INTO agent_logs (tab_id, log_id, kind, text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tab_id, log_id) DO UPDATE SET
      kind = excluded.kind,
      text = excluded.text,
      updated_at = excluded.updated_at
  `
  ).run(entry.tabId, entry.logId, entry.kind, entry.text, entry.createdAt, now)
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

export function saveAgentRun(run: StoredAgentRun): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    INSERT INTO agent_runs (
      run_id, tab_id, input, status, connection_id, output, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      connection_id = excluded.connection_id,
      output = excluded.output,
      error = excluded.error,
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
    now,
    now
  )
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
        created_at AS createdAt
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
    lastMessage: historyItem?.lastMessage,
    lastMessageAt: historyItem?.lastMessageAt,
    runCount: historyItem?.runCount ?? 0,
    logs
  }
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
