import type { AgentRunTrace, SessionTokenUsage, StoredAgentRun } from './agent-types'
import { buildAgentRunTrace } from './agent-run-trace'
import { EMPTY_SESSION_TOKEN_USAGE } from './session-token-usage'

export interface AgentSessionTrace {
  version: 1
  kind: 'session-trace'
  tabId: string
  title: string
  exportedAt: string
  usage: SessionTokenUsage
  runs: AgentRunTrace[]
}

export interface BuildAgentSessionTraceInput {
  tabId: string
  title: string
  exportedAt?: string
  runs: StoredAgentRun[]
  usage?: SessionTokenUsage
}

export function buildAgentSessionTrace(input: BuildAgentSessionTraceInput): AgentSessionTrace {
  const runs = [...input.runs]
    .sort(compareStoredAgentRuns)
    .map((run) => run.trace ?? buildStubTraceFromStoredRun(run))

  return {
    version: 1,
    kind: 'session-trace',
    tabId: input.tabId,
    title: input.title,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    usage: input.usage ?? sumStoredRunUsage(input.runs),
    runs
  }
}

export function serializeAgentSessionTrace(trace: AgentSessionTrace): string {
  return JSON.stringify(trace, null, 2)
}

export function parseAgentSessionTrace(value: unknown): AgentSessionTrace | undefined {
  if (!value) return undefined

  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return undefined
    }
  }

  if (!parsed || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== 1 || record.kind !== 'session-trace') return undefined
  if (typeof record.tabId !== 'string' || typeof record.title !== 'string') return undefined
  if (!Array.isArray(record.runs)) return undefined

  const usage =
    record.usage && typeof record.usage === 'object'
      ? {
          input: readUsageCount((record.usage as { input?: unknown }).input),
          output: readUsageCount((record.usage as { output?: unknown }).output)
        }
      : { ...EMPTY_SESSION_TOKEN_USAGE }

  return {
    version: 1,
    kind: 'session-trace',
    tabId: record.tabId,
    title: record.title,
    exportedAt:
      typeof record.exportedAt === 'string' ? record.exportedAt : new Date().toISOString(),
    usage,
    runs: record.runs.filter(isAgentRunTrace)
  }
}

function buildStubTraceFromStoredRun(run: StoredAgentRun): AgentRunTrace {
  return buildAgentRunTrace({
    runId: run.runId,
    tabId: run.tabId,
    input: run.input,
    status: run.status,
    connectionId: run.connectionId,
    startedAt: run.startedAt,
    elapsedMs: run.elapsedMs,
    result: run.output,
    error: run.error
  })
}

function sumStoredRunUsage(runs: StoredAgentRun[]): SessionTokenUsage {
  return runs.reduce(
    (total, run) => ({
      input: total.input + (run.inputTokens ?? 0),
      output: total.output + (run.outputTokens ?? 0)
    }),
    { ...EMPTY_SESSION_TOKEN_USAGE }
  )
}

function compareStoredAgentRuns(left: StoredAgentRun, right: StoredAgentRun): number {
  const leftTime = Date.parse(left.startedAt ?? '')
  const rightTime = Date.parse(right.startedAt ?? '')
  const leftValid = Number.isFinite(leftTime)
  const rightValid = Number.isFinite(rightTime)
  if (leftValid && rightValid && leftTime !== rightTime) return leftTime - rightTime
  if (leftValid !== rightValid) return leftValid ? -1 : 1
  return left.runId.localeCompare(right.runId)
}

function isAgentRunTrace(value: unknown): value is AgentRunTrace {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    typeof record.runId === 'string' &&
    typeof record.tabId === 'string' &&
    Array.isArray(record.steps)
  )
}

function readUsageCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.round(value)
}
