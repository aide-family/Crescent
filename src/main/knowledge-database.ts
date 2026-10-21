import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getCrescentDir } from './crescent-paths'

/** SQLite stays lazy and main-owned, as in crescent-sqlite. */
export function openKnowledgeDatabase(name: 'memory.db' | 'code_index.db'): DatabaseSync {
  mkdirSync(getCrescentDir(), { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite = require('node:sqlite') as typeof import('node:sqlite')
  const db = new sqlite.DatabaseSync(join(getCrescentDir(), name))
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON')
  return db
}
