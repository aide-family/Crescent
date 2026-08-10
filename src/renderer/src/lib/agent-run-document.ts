import type { Dictionary } from '@renderer/i18n'
import {
  AGENT_LIVE_RUN_MAX_FULL_STEPS,
  AGENT_LOG_ENTRY_MAX_CHARS,
  AGENT_RUN_STREAM_MAX_CHARS,
  clampAgentText
} from './agent-text-limits'
import { parseAgentRunMarkdown } from './agent-run-markdown'
import { legacyActionsMarkdownToSteps } from './legacy-actions-to-steps'
import type { AgentRunAction, AgentRunStep, AgentRunViewState } from './terminal-tabs'

export const AGENT_RUN_DOCUMENT_MARKER = 'CRESCENT_RUN_V2'

/** Stable error token written into parse-failure stub envelopes (UI maps to i18n). */
export const AGENT_RUN_DOCUMENT_PARSE_STUB_ERROR = 'HISTORY_PARSE_FAILED'

export interface ParsedAgentRunDocument {
  version: 1 | 2
  thinkingText?: string
  steps: AgentRunStep[]
  resultMarkdown: string
  errorMarkdown: string
  errorKind?: 'quota' | 'transient' | 'other'
  errorProvider?: string
  errorResetHint?: string
  elapsedMs?: number
  /** Legacy markdown actions block (v1 only). */
  actionsMarkdown?: string
  elapsedMarkdown?: string
}

interface SerializedAgentRunDocument {
  version: 2
  thinkingText?: string
  steps: AgentRunStep[]
  result?: string
  error?: string
  errorKind?: 'quota' | 'transient' | 'other'
  errorProvider?: string
  errorResetHint?: string
  elapsedMs?: number
}

export function formatAgentRunDocument(run: AgentRunViewState, t: Dictionary): string {
  const document = buildSerializedAgentRunDocument(run)

  // Keep a human-readable fallback for export/copy consumers that expect markdown.
  const markdownFallback = formatLegacyAgentRunMarkdown(
    {
      ...run,
      thinkingText: document.thinkingText,
      steps: document.steps,
      result: document.result,
      error: document.error
    },
    t
  )
  return `${AGENT_RUN_DOCUMENT_MARKER}\n${JSON.stringify(document)}\n\n${markdownFallback}`
}

/** Compact JSON-only document for in-memory / debounce persist (no markdown dual-write). */
export function formatAgentRunDocumentCompact(run: AgentRunViewState): string {
  const document = buildSerializedAgentRunDocument(run)
  return `${AGENT_RUN_DOCUMENT_MARKER}\n${JSON.stringify(document)}`
}

/** Full compact text written to SQLite at run end (memory path still structure-clamps). */
export function buildFinishPersistText(run: AgentRunViewState): string {
  return formatAgentRunDocumentCompact(run)
}

/** Valid envelope used when history JSON is corrupt — always parseable, never a half-cut slice. */
export function formatAgentRunDocumentParseStub(
  error: string = AGENT_RUN_DOCUMENT_PARSE_STUB_ERROR
): string {
  const document: SerializedAgentRunDocument = {
    version: 2,
    steps: [],
    error
  }
  return `${AGENT_RUN_DOCUMENT_MARKER}\n${JSON.stringify(document)}`
}

export function isAgentRunDocumentParseStub(value: string): boolean {
  try {
    const serialized = tryExtractSerializedDocument(value)
    return (
      serialized != null &&
      serialized.steps.length === 0 &&
      serialized.error === AGENT_RUN_DOCUMENT_PARSE_STUB_ERROR
    )
  } catch {
    return false
  }
}

/**
 * Memory-safe clamp for log entry text. CRESCENT_RUN_V2 envelopes are never sliced mid-JSON:
 * shrink structurally, or replace corrupt prefixes with a parseable stub.
 */
export function clampAgentRunEnvelopeText(
  text: string,
  maxChars = AGENT_LOG_ENTRY_MAX_CHARS
): string {
  try {
    if (!looksLikeAgentRunDocument(text)) {
      return text.length <= maxChars ? text : clampAgentText(text, maxChars)
    }

    const serialized = tryExtractSerializedDocument(text)
    if (!serialized) {
      return formatAgentRunDocumentParseStub()
    }

    const view = serializedDocumentToViewState(serialized)
    let compact = formatAgentRunDocumentCompact(view)
    if (compact.length <= maxChars) return compact

    for (
      let maxFullSteps = AGENT_LIVE_RUN_MAX_FULL_STEPS;
      maxFullSteps >= 0;
      maxFullSteps = maxFullSteps === 0 ? -1 : Math.floor(maxFullSteps / 2)
    ) {
      compact = formatAgentRunDocumentCompact(toLiveRunView(view, Math.max(0, maxFullSteps)))
      if (compact.length <= maxChars) return compact
      if (maxFullSteps <= 0) break
    }

    const minimal = formatAgentRunDocumentCompact({
      logId: view.logId,
      actions: [],
      steps: [],
      result: view.result?.trim() ? clampAgentText(view.result, 512) : undefined,
      error: view.error?.trim() ? clampAgentText(view.error, 512) : undefined,
      errorKind: view.errorKind,
      elapsedMs: view.elapsedMs
    })
    if (minimal.length <= maxChars) return minimal
    return formatAgentRunDocumentParseStub()
  } catch {
    return formatAgentRunDocumentParseStub()
  }
}

function buildSerializedAgentRunDocument(run: AgentRunViewState): SerializedAgentRunDocument {
  return {
    version: 2,
    thinkingText: run.thinkingText?.trim()
      ? clampAgentText(run.thinkingText, AGENT_RUN_STREAM_MAX_CHARS)
      : undefined,
    steps: (run.steps ?? []).map((step) => clampRunStepText(step)),
    result: run.result?.trim()
      ? clampAgentText(run.result, AGENT_RUN_STREAM_MAX_CHARS)
      : undefined,
    error: run.error?.trim() ? clampAgentText(run.error, AGENT_RUN_STREAM_MAX_CHARS) : undefined,
    errorKind: run.errorKind,
    errorProvider: run.errorProvider,
    errorResetHint: run.errorResetHint,
    elapsedMs: typeof run.elapsedMs === 'number' ? run.elapsedMs : undefined
  }
}

/**
 * Slim view published into React during streaming — no duplicated actions array,
 * clamped step texts, older steps collapsed to stubs.
 */
export function toLiveRunView(
  run: AgentRunViewState,
  maxFullSteps = AGENT_LIVE_RUN_MAX_FULL_STEPS
): AgentRunViewState {
  const steps = run.steps ?? []
  const start = Math.max(0, steps.length - maxFullSteps)
  const slimSteps = steps.map((step, index) => {
    if (index < start) return stubOlderStep(step)
    return clampRunStepText(step)
  })
  return {
    logId: run.logId,
    runId: run.runId,
    startedAt: run.startedAt,
    elapsedMs: run.elapsedMs,
    thinkingText: run.thinkingText?.trim()
      ? clampAgentText(run.thinkingText, AGENT_RUN_STREAM_MAX_CHARS)
      : undefined,
    steps: slimSteps,
    actions: [],
    result: run.result?.trim()
      ? clampAgentText(run.result, AGENT_RUN_STREAM_MAX_CHARS)
      : undefined,
    error: run.error?.trim() ? clampAgentText(run.error, AGENT_RUN_STREAM_MAX_CHARS) : undefined,
    errorKind: run.errorKind,
    errorProvider: run.errorProvider,
    errorResetHint: run.errorResetHint
  }
}

function stubOlderStep(step: AgentRunStep): AgentRunStep {
  if (step.kind === 'message' || step.kind === 'thought') {
    return {
      ...step,
      text: clampAgentText(step.text, 256)
    }
  }
  if (step.kind === 'tool') {
    return {
      ...step,
      resultText: step.resultText ? clampAgentText(step.resultText, 256) : step.resultText,
      argsText: step.argsText ? clampAgentText(step.argsText, 256) : step.argsText
    }
  }
  if (step.kind === 'status' && step.detail) {
    return { ...step, detail: clampAgentText(step.detail, 256) }
  }
  return step
}

function clampRunStepText(step: AgentRunStep): AgentRunStep {
  if (step.kind === 'message' || step.kind === 'thought') {
    return { ...step, text: clampAgentText(step.text, AGENT_RUN_STREAM_MAX_CHARS) }
  }
  if (step.kind === 'tool' && (step.resultText || step.argsText)) {
    return {
      ...step,
      resultText: step.resultText
        ? clampAgentText(step.resultText, AGENT_RUN_STREAM_MAX_CHARS)
        : step.resultText,
      argsText: step.argsText
        ? clampAgentText(step.argsText, AGENT_RUN_STREAM_MAX_CHARS)
        : step.argsText
    }
  }
  if (step.kind === 'status' && step.detail) {
    return { ...step, detail: clampAgentText(step.detail, AGENT_RUN_STREAM_MAX_CHARS) }
  }
  return step
}

export function parseAgentRunDocument(value: string, t: Dictionary): ParsedAgentRunDocument | null {
  try {
    return parseAgentRunDocumentInner(value, t)
  } catch {
    // Never throw into React / hydrate / new-turn paths.
    return null
  }
}

/** Alias kept for call sites that want an explicit "never throws" name. */
export function safeParseAgentRunDocument(
  value: string,
  t: Dictionary
): ParsedAgentRunDocument | null {
  return parseAgentRunDocument(value, t)
}

function parseAgentRunDocumentInner(value: string, t: Dictionary): ParsedAgentRunDocument | null {
  const normalized = value.replace(/\r\n/g, '\n')
  if (normalized.startsWith(`${AGENT_RUN_DOCUMENT_MARKER}\n`)) {
    const rest = normalized.slice(AGENT_RUN_DOCUMENT_MARKER.length + 1)
    const jsonEnd = findJsonObjectEnd(rest)
    if (jsonEnd > 0) {
      try {
        const parsed = JSON.parse(rest.slice(0, jsonEnd)) as SerializedAgentRunDocument
        if (parsed?.version === 2 && Array.isArray(parsed.steps)) {
          const thinkingText =
            typeof parsed.thinkingText === 'string' ? parsed.thinkingText : undefined
          const steps = upgradeStepsWithThinkingText(
            parsed.steps.filter(isAgentRunStep),
            thinkingText
          )
          return {
            version: 2,
            thinkingText: thinkingText ?? deriveThinkingTextFromSteps(steps),
            steps,
            resultMarkdown: typeof parsed.result === 'string' ? parsed.result : '',
            errorMarkdown: typeof parsed.error === 'string' ? parsed.error : '',
            errorKind: parseErrorKind(parsed.errorKind),
            errorProvider:
              typeof parsed.errorProvider === 'string' ? parsed.errorProvider : undefined,
            errorResetHint:
              typeof parsed.errorResetHint === 'string' ? parsed.errorResetHint : undefined,
            elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined
          }
        }
      } catch {
        // Fall through to legacy markdown parsing.
      }
    }
  }

  const legacy = parseAgentRunMarkdown(normalized, t)
  if (!legacy) return null

  // Promote legacy action markdown into structured steps so the UI never falls
  // back to the old "动作概要 / action summary" presentation.
  return {
    version: 2,
    steps: legacyActionsMarkdownToSteps(legacy.actionsMarkdown),
    resultMarkdown: legacy.resultMarkdown,
    errorMarkdown: legacy.errorMarkdown,
    elapsedMarkdown: legacy.elapsedMarkdown,
    elapsedMs: parseElapsedMs(legacy.elapsedMarkdown, t)
  }
}

export function extractResultFromAgentRunDocument(value: string, t: Dictionary): string {
  const parsed = parseAgentRunDocument(value, t)
  if (!parsed) return value.trim()
  return [parsed.resultMarkdown, parsed.errorMarkdown].filter(Boolean).join('\n\n').trim()
}

/** True when text looks like a CRESCENT_RUN_V2 envelope (even if JSON is corrupt). */
export function looksLikeAgentRunDocument(value: string): boolean {
  const normalized = value.replace(/\r\n/g, '\n').trimStart()
  return (
    normalized === AGENT_RUN_DOCUMENT_MARKER ||
    normalized.startsWith(`${AGENT_RUN_DOCUMENT_MARKER}\n`) ||
    normalized.startsWith(`${AGENT_RUN_DOCUMENT_MARKER}{`)
  )
}

/**
 * Safe text for model context / copy fallbacks: never feed raw CRESCENT_RUN_V2 JSON.
 * Returns null when the envelope is present but unparsable (caller should omit or use i18n error).
 */
export function sanitizeAgentLogTextForContext(value: string, t: Dictionary): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!looksLikeAgentRunDocument(trimmed)) return trimmed
  const parsed = parseAgentRunDocument(trimmed, t)
  if (!parsed) return null
  const extracted = [parsed.resultMarkdown, parsed.errorMarkdown].filter(Boolean).join('\n\n').trim()
  if (extracted) return extracted
  const stepHints = parsed.steps
    .map((step) => {
      if (step.kind === 'status') return step.title
      if (step.kind === 'message') return step.text
      if (step.kind === 'user-supplement') return step.text
      if (step.kind === 'tool') return step.command || step.name
      return ''
    })
    .filter(Boolean)
    .slice(0, 8)
  return stepHints.join('\n').trim() || null
}

export function deriveActionsFromRun(
  run: Pick<AgentRunViewState, 'steps' | 'thinkingText' | 'actions'>
): AgentRunAction[] {
  if (run.actions?.length) return run.actions
  return deriveActionsFromSteps(run.steps ?? [], run.thinkingText)
}

export function deriveActionsFromSteps(
  steps: AgentRunStep[],
  thinkingText?: string
): AgentRunAction[] {
  const actions: AgentRunAction[] = []
  const hasThoughtSteps = steps.some((step) => step.kind === 'thought')
  if (!hasThoughtSteps && thinkingText?.trim()) {
    actions.push({
      title: 'Thinking',
      detail: thinkingText.trim()
    })
  }
  for (const step of steps) {
    if (step.kind === 'status') {
      actions.push({ title: step.title, detail: step.detail ?? step.title })
      continue
    }
    if (step.kind === 'thought') {
      if (!step.text.trim()) continue
      actions.push({ title: 'Thinking', detail: step.text.trim() })
      continue
    }
    if (step.kind === 'message') {
      if (!step.text.trim()) continue
      actions.push({ title: 'Message', detail: step.text.trim() })
      continue
    }
    if (step.kind === 'user-supplement') {
      if (!step.text.trim()) continue
      actions.push({ title: 'User supplement', detail: step.text.trim() })
      continue
    }
    if (step.kind === 'approval') {
      actions.push({
        title: `Command review: ${step.command}`,
        detail: [
          step.auditSummary,
          step.phase === 'pending'
            ? 'Awaiting approval'
            : step.phase === 'approved'
              ? 'Approved'
              : 'Rejected',
          step.note || step.rejectionReason
        ]
          .filter(Boolean)
          .join('\n')
      })
      continue
    }
    if (step.kind !== 'tool') continue
    const detailParts = [
      step.command ? `Command:\n${step.command}` : step.argsText ? `Args:\n${step.argsText}` : '',
      step.resultText ? `Output:\n${step.resultText}` : '',
      step.phase === 'started' ? 'Running…' : step.isError ? 'Tool failed.' : ''
    ].filter(Boolean)
    actions.push({
      title: `Tool: ${step.name}`,
      detail: detailParts.join('\n\n') || step.name
    })
  }
  return actions
}

/** Promote legacy top-level thinkingText into an interleaved thought step when missing. */
export function upgradeStepsWithThinkingText(
  steps: AgentRunStep[],
  thinkingText?: string
): AgentRunStep[] {
  if (!thinkingText?.trim()) return steps
  if (steps.some((step) => step.kind === 'thought')) return steps
  return [
    {
      id: 'thought-legacy',
      kind: 'thought',
      text: thinkingText.trim(),
      phase: 'done'
    },
    ...steps
  ]
}

export function deriveThinkingTextFromSteps(steps: AgentRunStep[]): string | undefined {
  const texts = steps
    .filter((step): step is Extract<AgentRunStep, { kind: 'thought' }> => step.kind === 'thought')
    .map((step) => step.text.trim())
    .filter(Boolean)
  if (texts.length === 0) return undefined
  return texts.join('\n\n')
}

export function closeStreamingThoughts(steps: AgentRunStep[]): AgentRunStep[] {
  let changed = false
  const next = steps.map((step) => {
    if (step.kind === 'thought' && step.phase === 'streaming') {
      changed = true
      return { ...step, phase: 'done' as const }
    }
    return step
  })
  return changed ? next : steps
}

export function closeStreamingMessages(steps: AgentRunStep[]): AgentRunStep[] {
  let changed = false
  const next = steps.map((step) => {
    if (step.kind === 'message' && step.phase === 'streaming') {
      changed = true
      return { ...step, phase: 'done' as const }
    }
    return step
  })
  return changed ? next : steps
}

/** Close open thought + message steps before a new timeline phase. */
export function closeStreamingOpenSteps(steps: AgentRunStep[]): AgentRunStep[] {
  return closeStreamingMessages(closeStreamingThoughts(steps))
}

/** Formal Result chrome is only shown after the run records elapsedMs. */
export function shouldShowAgentRunResult(input: {
  hasResultContent: boolean
  elapsedMs?: number
}): boolean {
  return input.hasResultContent && typeof input.elapsedMs === 'number'
}

/**
 * Hide a streaming message that duplicates the formal result panel.
 * Equal after trim, or one side length > 200 and contains the other.
 */
export function isDuplicateResultMessage(messageText: string, resultMarkdown: string): boolean {
  const message = messageText.trim()
  const result = resultMarkdown.trim()
  if (!message || !result) return false
  if (message === result) return true
  if (message.length > 200 && message.includes(result)) return true
  if (result.length > 200 && result.includes(message)) return true
  return false
}

/** Drop the last message step when it duplicates resultMarkdown (no placeholder). */
export function omitDuplicateTrailingMessage(
  steps: AgentRunStep[],
  resultMarkdown: string
): AgentRunStep[] {
  let lastMessageIndex = -1
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === 'message') {
      lastMessageIndex = i
      break
    }
  }
  if (lastMessageIndex < 0) return steps
  const step = steps[lastMessageIndex]
  if (step.kind !== 'message') return steps
  if (!isDuplicateResultMessage(step.text, resultMarkdown)) return steps
  return steps.filter((_, index) => index !== lastMessageIndex)
}

export function syncActionsFromStructuredRun(run: AgentRunViewState): AgentRunViewState {
  return {
    ...run,
    actions: deriveActionsFromSteps(run.steps ?? [], run.thinkingText)
  }
}

function formatLegacyAgentRunMarkdown(run: AgentRunViewState, t: Dictionary): string {
  const lines: string[] = []
  const actions = deriveActionsFromSteps(run.steps ?? [], run.thinkingText)

  if (run.thinkingText?.trim()) {
    lines.push(`**${t.input.thinkingProcess}**`, '', run.thinkingText.trim(), '')
  }

  if (actions.length > 0) {
    lines.push(`**${t.input.actions}**`, '')
    for (const action of actions) {
      lines.push(`- ${action.title}`)
    }
  }

  if (run.result) {
    lines.push('', `**${t.input.result}**`, '', run.result)
  }

  if (run.error) {
    lines.push('', `**${t.input.error}**`, '', run.error)
  }

  if (typeof run.elapsedMs === 'number') {
    lines.push('', '---', '', `${t.input.elapsed}: ${formatDuration(run.elapsedMs)}`)
  }

  return lines.join('\n').trim()
}

function formatDuration(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`
  const seconds = elapsedMs / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return `${minutes}m ${rem}s`
}

function parseElapsedMs(elapsedMarkdown: string | undefined, t: Dictionary): number | undefined {
  if (!elapsedMarkdown?.trim()) return undefined
  const match = elapsedMarkdown.match(
    new RegExp(`${escapeRegExp(t.input.elapsed)}:\\s*(\\d+)ms`, 'i')
  )
  if (match) {
    const value = Number(match[1])
    return Number.isFinite(value) ? value : undefined
  }
  return undefined
}

function findJsonObjectEnd(value: string): number {
  const start = value.indexOf('{')
  if (start < 0) return -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < value.length; i += 1) {
    const ch = value[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function tryExtractSerializedDocument(value: string): SerializedAgentRunDocument | null {
  try {
    const normalized = value.replace(/\r\n/g, '\n').trimStart()
    if (!normalized.startsWith(`${AGENT_RUN_DOCUMENT_MARKER}\n`)) return null
    const rest = normalized.slice(AGENT_RUN_DOCUMENT_MARKER.length + 1)
    const jsonEnd = findJsonObjectEnd(rest)
    if (jsonEnd <= 0) return null
    const parsed = JSON.parse(rest.slice(0, jsonEnd)) as SerializedAgentRunDocument
    if (parsed?.version !== 2 || !Array.isArray(parsed.steps)) return null
    return {
      version: 2,
      thinkingText: typeof parsed.thinkingText === 'string' ? parsed.thinkingText : undefined,
      steps: parsed.steps.filter(isAgentRunStep),
      result: typeof parsed.result === 'string' ? parsed.result : undefined,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      errorKind: parseErrorKind(parsed.errorKind),
      errorProvider: typeof parsed.errorProvider === 'string' ? parsed.errorProvider : undefined,
      errorResetHint:
        typeof parsed.errorResetHint === 'string' ? parsed.errorResetHint : undefined,
      elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined
    }
  } catch {
    return null
  }
}

function serializedDocumentToViewState(
  document: SerializedAgentRunDocument
): AgentRunViewState {
  return {
    logId: 0,
    actions: [],
    thinkingText: document.thinkingText,
    steps: document.steps,
    result: document.result,
    error: document.error,
    errorKind: document.errorKind,
    errorProvider: document.errorProvider,
    errorResetHint: document.errorResetHint,
    elapsedMs: document.elapsedMs
  }
}

function isAgentRunStep(value: unknown): value is AgentRunStep {
  if (!value || typeof value !== 'object') return false
  const step = value as AgentRunStep
  if (typeof step.id !== 'string') return false
  if (step.kind === 'status') return typeof step.title === 'string'
  if (step.kind === 'thought') {
    return typeof step.text === 'string' && (step.phase === 'streaming' || step.phase === 'done')
  }
  if (step.kind === 'message') {
    return typeof step.text === 'string' && (step.phase === 'streaming' || step.phase === 'done')
  }
  if (step.kind === 'tool') {
    return typeof step.name === 'string' && (step.phase === 'started' || step.phase === 'finished')
  }
  if (step.kind === 'user-supplement') {
    return typeof step.text === 'string' && typeof step.createdAt === 'string'
  }
  if (step.kind === 'approval') {
    return (
      typeof step.requestId === 'string' &&
      typeof step.command === 'string' &&
      (step.phase === 'pending' || step.phase === 'approved' || step.phase === 'rejected')
    )
  }
  return false
}

/** Prefer live structured run state over reparsing serialized log text while streaming. */
export function agentRunViewToDocument(run: AgentRunViewState): ParsedAgentRunDocument {
  const steps = upgradeStepsWithThinkingText(run.steps ?? [], run.thinkingText)
  return {
    version: 2,
    thinkingText: run.thinkingText ?? deriveThinkingTextFromSteps(steps),
    steps,
    resultMarkdown: run.result ?? '',
    errorMarkdown: run.error ?? '',
    errorKind: run.errorKind,
    errorProvider: run.errorProvider,
    errorResetHint: run.errorResetHint,
    elapsedMs: typeof run.elapsedMs === 'number' ? run.elapsedMs : undefined
  }
}

function parseErrorKind(value: unknown): 'quota' | 'transient' | 'other' | undefined {
  if (value === 'quota' || value === 'transient' || value === 'other') return value
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
