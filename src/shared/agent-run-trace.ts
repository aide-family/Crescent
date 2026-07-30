import { redactSensitiveText } from './secret-redaction'
import type { AgentRunTrace, AgentRunTraceStep, StoredAgentRun } from './agent-types'

export interface AgentRunTraceBuildInput {
  runId: string
  tabId: string
  input: string
  status: StoredAgentRun['status']
  connectionId?: string
  startedAt?: number | string
  elapsedMs?: number
  actions?: Array<{ title: string; detail: string }>
  result?: string
  error?: string
}

const MAX_DETAIL_CHARS = 8_000
const MAX_RESULT_CHARS = 12_000

export function buildAgentRunTrace(input: AgentRunTraceBuildInput): AgentRunTrace {
  const startedAt = normalizeTimestamp(input.startedAt)
  const finishedAt =
    typeof input.elapsedMs === 'number' && startedAt
      ? new Date(Date.parse(startedAt) + input.elapsedMs).toISOString()
      : undefined

  return {
    version: 1,
    runId: input.runId,
    tabId: input.tabId,
    input: redactSensitiveText(input.input),
    status: input.status,
    connectionId: input.connectionId,
    startedAt,
    finishedAt,
    elapsedMs: input.elapsedMs,
    steps: (input.actions ?? []).map((action, index) =>
      buildTraceStep(index + 1, action.title, action.detail)
    ),
    resultSummary: truncateText(redactSensitiveText(input.result?.trim() ?? ''), MAX_RESULT_CHARS),
    error:
      truncateText(redactSensitiveText(input.error?.trim() ?? ''), MAX_RESULT_CHARS) || undefined
  }
}

export function serializeAgentRunTrace(trace: AgentRunTrace): string {
  return JSON.stringify(trace, null, 2)
}

export function parseAgentRunTrace(value: unknown): AgentRunTrace | undefined {
  if (!value) return undefined

  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return undefined
    }
  }

  if (!isRecord(parsed) || parsed.version !== 1) return undefined
  if (typeof parsed.runId !== 'string' || typeof parsed.tabId !== 'string') return undefined
  if (!Array.isArray(parsed.steps)) return undefined

  return {
    version: 1,
    runId: parsed.runId,
    tabId: parsed.tabId,
    input: String(parsed.input ?? ''),
    status: normalizeStatus(parsed.status),
    connectionId: typeof parsed.connectionId === 'string' ? parsed.connectionId : undefined,
    startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
    finishedAt: typeof parsed.finishedAt === 'string' ? parsed.finishedAt : undefined,
    elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
    steps: parsed.steps
      .filter(isRecord)
      .map((step, index) =>
        buildTraceStep(
          typeof step.index === 'number' ? step.index : index + 1,
          String(step.title ?? ''),
          String(step.detail ?? '')
        )
      ),
    resultSummary:
      typeof parsed.resultSummary === 'string' && parsed.resultSummary.trim()
        ? parsed.resultSummary
        : undefined,
    error: typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error : undefined
  }
}

function buildTraceStep(index: number, title: string, detail: string): AgentRunTraceStep {
  return {
    index,
    title: redactSensitiveText(title.trim() || `Step ${index}`),
    detail: truncateText(redactSensitiveText(detail.trim()), MAX_DETAIL_CHARS)
  }
}

function normalizeTimestamp(value: number | string | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
    return value
  }
  return undefined
}

function normalizeStatus(value: unknown): StoredAgentRun['status'] {
  if (value === 'success' || value === 'error' || value === 'canceled' || value === 'running') {
    return value
  }
  return 'error'
}

function truncateText(value: string, maxChars: number): string {
  if (!value) return ''
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
