import type { Dictionary } from '@renderer/i18n'
import { decodeUserMessageText } from './agent-message-refs'
import { parseAgentRunDocument } from './agent-run-document'
import { buildTraceFromAgentRunView } from './agent-run-trace-export'
import { stripComposerRefTokens } from './composer-ref-tokens'
import type { AgentLogEntry, AgentRunStep, AgentRunViewState } from './terminal-tabs'
import type { AgentRunTrace, CaptureScope, StoredAgentLogEntry } from '../../../shared/agent-types'
import { formatCaptureTranscript } from '../../../shared/capture-transcript'

const SUMMARY_MAX_CHARS = 80_000
const COMMAND_RESULT_MAX_CHARS = 2_000

export interface CaptureLogEntry {
  id: number
  kind: string
  text: string
}

function summarizeToolSteps(steps: AgentRunStep[]): string[] {
  const lines: string[] = []
  for (const step of steps) {
    if (step.kind !== 'tool') continue
    const command = (step.command || step.argsText || '').trim()
    const result = (step.resultText || '').trim()
    if (!command && !result) continue
    const resultPreview = result ? result.slice(0, COMMAND_RESULT_MAX_CHARS) : ''
    lines.push(
      [
        command ? `Command: ${command}` : '',
        resultPreview
          ? `Result: ${resultPreview}${result.length > COMMAND_RESULT_MAX_CHARS ? '…' : ''}${step.isError ? ' (error)' : ''}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return lines
}

function normalizeLogText(kind: string, text: string): string {
  const decoded = kind === 'user' ? decodeUserMessageText(text).text : text
  return stripComposerRefTokens(decoded).trim()
}

function collectUserGoals(
  log: CaptureLogEntry[],
  entryIndex: number,
  scope: CaptureScope
): string[] {
  const end = entryIndex >= 0 ? entryIndex : log.length
  const userIndexes: number[] = []
  for (let i = 0; i < end; i++) {
    if (log[i]?.kind === 'user' && normalizeLogText('user', log[i]!.text)) {
      userIndexes.push(i)
    }
  }
  const selected =
    scope === 'session'
      ? userIndexes
      : userIndexes.length
        ? [userIndexes[userIndexes.length - 1]!]
        : []
  return selected.map((index) => normalizeLogText('user', log[index]!.text))
}

/** Prefer the session-trace transcript; fall back to the in-memory log summary. */
export function buildSessionCaptureSummary(input: {
  traces: AgentRunTrace[]
  log: CaptureLogEntry[]
  entry?: CaptureLogEntry
  liveRun?: AgentRunViewState
  scope?: CaptureScope
  seedText?: string
  t: Dictionary
}): string {
  const transcript = formatCaptureTranscript({
    traces: input.traces,
    seedText: input.seedText,
    scope: input.scope ?? 'session'
  })
  const hasTraceBody = input.traces.some(
    (trace) => trace.input.trim() || trace.steps.length > 0 || Boolean(trace.resultSummary?.trim())
  )
  if (transcript.trim() && hasTraceBody) return transcript
  return buildCaptureSummary(input)
}

export function collectLiveCaptureTraces(input: {
  log: CaptureLogEntry[]
  tabId: string
  liveRunByLogId: Record<number, AgentRunViewState>
}): AgentRunTrace[] {
  const traces: AgentRunTrace[] = []
  for (let index = 0; index < input.log.length; index++) {
    const entry = input.log[index]
    if (entry?.kind !== 'assistant') continue
    const live = input.liveRunByLogId[entry.id]
    if (!live) continue
    let userText = ''
    for (let previous = index - 1; previous >= 0; previous--) {
      const candidate = input.log[previous]
      if (candidate?.kind === 'user') {
        userText = normalizeLogText('user', candidate.text)
        break
      }
    }
    traces.push(
      buildTraceFromAgentRunView({
        runId: live.runId ?? `live-${input.tabId}-${entry.id}`,
        tabId: input.tabId,
        displayInput: userText,
        status: live.error ? 'error' : 'success',
        run: live,
        output: live.result,
        error: live.error
      })
    )
  }
  return traces
}

export function buildCaptureSummary(input: {
  log: CaptureLogEntry[]
  entry?: CaptureLogEntry
  liveRun?: AgentRunViewState
  scope?: CaptureScope
  seedText?: string
  t: Dictionary
}): string {
  const { log, liveRun, t } = input
  const scope = input.scope ?? 'turn'
  const entry = input.entry ?? [...log].reverse().find((item) => item.kind === 'assistant')
  const entryIndex = entry ? log.findIndex((item) => item.id === entry.id) : log.length
  const userMessages = collectUserGoals(log, entryIndex, scope)
  const seed = input.seedText?.trim()
  if (seed && !userMessages.includes(seed)) userMessages.push(seed)

  let steps: AgentRunStep[] = liveRun?.steps ?? []
  let resultMarkdown = liveRun?.result?.trim() ?? ''
  if (entry && (!steps.length || !resultMarkdown) && entry.kind === 'assistant') {
    const parsed = parseAgentRunDocument(entry.text, t)
    if (parsed) {
      if (!steps.length) steps = parsed.steps
      if (!resultMarkdown) resultMarkdown = parsed.resultMarkdown.trim()
    } else if (!resultMarkdown && entry.text.trim()) {
      resultMarkdown = normalizeLogText('assistant', entry.text).slice(0, 2000)
    }
  }

  if (scope === 'session') {
    const extra: AgentRunStep[] = []
    for (const item of log) {
      if (item.kind !== 'assistant' || item.id === entry?.id) continue
      const parsed = parseAgentRunDocument(item.text, t)
      if (parsed?.steps.length) extra.push(...parsed.steps)
    }
    if (extra.length) steps = [...extra, ...steps]
  }

  const commandLines = summarizeToolSteps(steps)
  const parts = [
    '# User goals',
    userMessages.length ? userMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n') : '(none)',
    '',
    '# Commands and results',
    commandLines.length ? commandLines.join('\n\n') : '(none)',
    '',
    '# Final report',
    resultMarkdown || '(none)'
  ]

  let summary = parts.join('\n')
  if (summary.length > SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, SUMMARY_MAX_CHARS)}…`
  }
  return summary
}

export function buildSopGenerationSummary(input: {
  log: AgentLogEntry[]
  entry: AgentLogEntry
  liveRun?: AgentRunViewState
  t: Dictionary
  scope?: CaptureScope
  seedText?: string
}): string {
  return buildCaptureSummary({
    log: input.log,
    entry: input.entry,
    liveRun: input.liveRun,
    t: input.t,
    scope: input.scope ?? 'turn',
    seedText: input.seedText
  })
}

export function historyLogsToCaptureEntries(logs: StoredAgentLogEntry[]): CaptureLogEntry[] {
  return logs
    .filter((log) => log.kind === 'user' || log.kind === 'assistant' || log.kind === 'error')
    .map((log) => ({
      id: log.logId,
      kind: log.kind,
      text: log.text
    }))
}

export function hasCaptureableContent(input: {
  log: CaptureLogEntry[]
  seedText?: string
}): boolean {
  if (input.seedText?.trim()) return true
  return input.log.some(
    (entry) =>
      (entry.kind === 'user' || entry.kind === 'assistant') &&
      normalizeLogText(entry.kind, entry.text)
  )
}

export function buildFallbackSopSeed(userText: string): { title: string; content: string } {
  const seed = stripComposerRefTokens(userText).trim()
  return {
    title: seed.slice(0, 20) || 'SOP',
    content: seed
  }
}
