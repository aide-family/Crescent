import type { AgentMemoryRecord } from '../agent/types'
import type {
  StoredAgentRun,
  StoredAgentLogEntry,
  OperationRecord,
  OpsHistoryRating
} from '../agent/types'
export interface SessionHistoryRow {
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
  agentStyle?: string | null
  executionMode?: string | null
}

export interface AgentRunRow {
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
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

export interface OpsHistoryRow {
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

// SQLite is a persistence boundary: validate every projected field before it enters IPC.
type Field<T> = { accepts: (value: unknown) => value is T; optional?: boolean }
type RowSchema<T> = { [K in keyof T]-?: Field<NonNullable<T[K]>> }
const text: Field<string> = { accepts: (v): v is string => typeof v === 'string' }
const count: Field<number> = {
  accepts: (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
}
const optional = <T>(field: Field<T>): Field<T> => ({ ...field, optional: true })
const oneOf = <T extends string | number>(...values: T[]): Field<T> => ({
  accepts: (v): v is T => values.some((x) => x === v)
})
export function readRow<T extends object>(value: unknown, schema: RowSchema<T>): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema) as [string, Field<unknown>][]) {
    const value = record[key]
    if (value == null && field.optional) continue
    if (!field.accepts(value)) return undefined
    result[key] = value
  }
  return result as T
}
export function readRows<T extends object>(values: unknown[], schema: RowSchema<T>): T[] {
  return values.flatMap((value) => {
    const row = readRow(value, schema)
    return row ? [row] : []
  })
}
export const agentRunRow: RowSchema<AgentRunRow> = {
  runId: text,
  tabId: text,
  input: text,
  status: oneOf('running', 'success', 'error', 'canceled'),
  connectionId: optional(text),
  output: optional(text),
  error: optional(text),
  startedAt: optional(text),
  elapsedMs: optional(count),
  traceJson: optional(text),
  inputTokens: optional(count),
  outputTokens: optional(count),
  cacheReadTokens: optional(count),
  cacheWriteTokens: optional(count)
}
export const opsHistoryRow: RowSchema<OpsHistoryRow> = {
  id: text,
  tabId: text,
  connectionId: text,
  runId: text,
  rating: oneOf('like', 'dislike'),
  userGoal: text,
  pathSummary: text,
  lesson: text,
  createdAt: text,
  updatedAt: text
}
export const sessionHistoryRow: RowSchema<SessionHistoryRow> = {
  tabId: text,
  title: text,
  connectionId: optional(text),
  connectionName: optional(text),
  isSsh: oneOf(0, 1),
  terminalCwd: optional(text),
  terminalMode: optional(oneOf('pty', 'pipe')),
  updatedAt: text,
  summary: optional(text),
  titleLocked: optional(oneOf(0, 1)),
  lastMessage: optional(text),
  lastMessageAt: optional(text),
  runCount: optional(count),
  agentStyle: optional(text),
  executionMode: optional(text)
}
export const agentLogRow: RowSchema<StoredAgentLogEntry> = {
  tabId: text,
  logId: count,
  kind: text,
  text,
  createdAt: text,
  runId: optional(text)
}
export const operationRow: RowSchema<OperationRecord> = {
  id: text,
  createdAt: text,
  connectionId: optional(text),
  connectionName: optional(text),
  command: optional(text),
  status: oneOf('success', 'error'),
  summary: text,
  output: optional(text)
}

export const memoryRow: RowSchema<AgentMemoryRecord> = {
  role: oneOf('user', 'assistant'),
  content: text,
  createdAt: text
}
