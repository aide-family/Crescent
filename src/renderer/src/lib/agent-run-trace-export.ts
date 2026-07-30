import type { Dictionary } from '../i18n'
import { parseAgentRunMarkdown } from './agent-run-markdown'
import type { AgentLogEntry, AgentRunViewState } from './terminal-tabs'
import {
  buildAgentRunTrace,
  serializeAgentRunTrace
} from '../../../shared/agent-run-trace'
import type { AgentRunTrace, StoredAgentRun } from '../../../shared/agent-types'

export function buildTraceFromAgentRunView(input: {
  runId: string
  tabId: string
  displayInput: string
  status: StoredAgentRun['status']
  connectionId?: string
  run?: AgentRunViewState
  startedAt?: number
  output?: string
  error?: string
}): AgentRunTrace {
  return buildAgentRunTrace({
    runId: input.runId,
    tabId: input.tabId,
    input: input.displayInput,
    status: input.status,
    connectionId: input.connectionId,
    startedAt: input.run?.startedAt ?? input.startedAt,
    elapsedMs: input.run?.elapsedMs,
    actions: input.run?.actions,
    result: input.run?.result ?? input.output,
    error: input.run?.error ?? input.error
  })
}

export function buildTraceFromAgentLogEntry(input: {
  entry: AgentLogEntry
  tabId: string
  t: Dictionary
  storedRun?: StoredAgentRun
}): AgentRunTrace {
  if (input.storedRun?.trace) return input.storedRun.trace

  const parsed = parseAgentRunMarkdown(input.entry.text, input.t)
  const elapsedMs = parseElapsedMs(parsed?.elapsedMarkdown ?? '', input.t)
  const actions = extractActionsFromMarkdown(parsed?.actionsMarkdown ?? '')

  return buildAgentRunTrace({
    runId: input.storedRun?.runId ?? `log-${input.tabId}-${input.entry.id}`,
    tabId: input.tabId,
    input: input.storedRun?.input ?? '',
    status: input.storedRun?.status ?? (parsed?.errorMarkdown ? 'error' : 'success'),
    connectionId: input.storedRun?.connectionId,
    startedAt: input.storedRun?.startedAt ?? input.entry.createdAt,
    elapsedMs: input.storedRun?.elapsedMs ?? elapsedMs,
    actions,
    result: parsed?.resultMarkdown || input.storedRun?.output,
    error: parsed?.errorMarkdown || input.storedRun?.error
  })
}

export function formatTraceExport(trace: AgentRunTrace): string {
  return serializeAgentRunTrace(trace)
}

function extractActionsFromMarkdown(actionsMarkdown: string): Array<{ title: string; detail: string }> {
  if (!actionsMarkdown.trim()) return []

  const detailBlocks = [...actionsMarkdown.matchAll(/^####\s+(\d+)\.\s+(.+)$/gm)]
  if (detailBlocks.length > 0) {
    const lines = actionsMarkdown.split('\n')
    return detailBlocks.map((match, index) => {
      const title = match[2]?.trim() || `Step ${index + 1}`
      const startLine = lines.findIndex((line) => line.trim() === match[0].trim())
      const nextStart =
        index + 1 < detailBlocks.length
          ? lines.findIndex((line) => line.trim() === detailBlocks[index + 1]?.[0]?.trim())
          : lines.length
      const detail = lines
        .slice(startLine >= 0 ? startLine + 1 : 0, nextStart >= 0 ? nextStart : lines.length)
        .join('\n')
        .trim()
      return { title, detail }
    })
  }

  const bullets = actionsMarkdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)

  return bullets.map((title) => ({ title, detail: title }))
}

function parseElapsedMs(elapsedMarkdown: string, t: Dictionary): number | undefined {
  const match = elapsedMarkdown.match(new RegExp(`${escapeRegExp(t.input.elapsed)}:\\s*(\\d+)ms`, 'i'))
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
