import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

import { getCrescentDir } from './crescent-store'
import type { StoredAgentLogEntry, StoredAgentRun, StoredSessionTab } from './agent/types'

let database: DatabaseSync | undefined

export function getCrescentDatabasePath(): string {
  return join(getCrescentDir(), 'crescent.db')
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

    CREATE INDEX IF NOT EXISTS idx_agent_logs_tab_created_at
      ON agent_logs (tab_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tab_updated_at
      ON agent_runs (tab_id, updated_at);
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

function getDatabase(): DatabaseSync {
  if (database) return database

  const dir = getCrescentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  database = new DatabaseSync(getCrescentDatabasePath())
  initializeCrescentDatabase()
  return database
}
