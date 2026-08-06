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
  elapsedMs?: number
}

export function formatAgentRunDocument(run: AgentRunViewState, t: Dictionary): string {
  const document: SerializedAgentRunDocument = {
    version: 2,
    thinkingText: run.thinkingText?.trim() ? run.thinkingText : undefined,
    steps: run.steps ?? [],
    result: run.result?.trim() ? run.result : undefined,
    error: run.error?.trim() ? run.error : undefined,
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
          return {
            version: 2,
            thinkingText: typeof parsed.thinkingText === 'string' ? parsed.thinkingText : undefined,
            steps: parsed.steps.filter(isAgentRunStep),
            resultMarkdown: typeof parsed.result === 'string' ? parsed.result : '',
            errorMarkdown: typeof parsed.error === 'string' ? parsed.error : '',
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
  if (thinkingText?.trim()) {
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
  return {
    version: 2,
    thinkingText: run.thinkingText,
    steps: run.steps ?? [],
    resultMarkdown: run.result ?? '',
    errorMarkdown: run.error ?? '',
    elapsedMs: typeof run.elapsedMs === 'number' ? run.elapsedMs : undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
