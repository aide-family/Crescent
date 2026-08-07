import type { Dictionary } from '@renderer/i18n'
import { parseAgentRunMarkdown } from './agent-run-markdown'
import { legacyActionsMarkdownToSteps } from './legacy-actions-to-steps'
import type { AgentRunAction, AgentRunStep, AgentRunViewState } from './terminal-tabs'

export const AGENT_RUN_DOCUMENT_MARKER = 'CRESCENT_RUN_V2'

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
  const document: SerializedAgentRunDocument = {
    version: 2,
    thinkingText: run.thinkingText?.trim() ? run.thinkingText : undefined,
    steps: run.steps ?? [],
    result: run.result?.trim() ? run.result : undefined,
    error: run.error?.trim() ? run.error : undefined,
    errorKind: run.errorKind,
    errorProvider: run.errorProvider,
    errorResetHint: run.errorResetHint,
    elapsedMs: typeof run.elapsedMs === 'number' ? run.elapsedMs : undefined
  }

  // Keep a human-readable fallback for export/copy consumers that expect markdown.
  const markdownFallback = formatLegacyAgentRunMarkdown(run, t)
  return `${AGENT_RUN_DOCUMENT_MARKER}\n${JSON.stringify(document)}\n\n${markdownFallback}`
}

export function parseAgentRunDocument(value: string, t: Dictionary): ParsedAgentRunDocument | null {
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
