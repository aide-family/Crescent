import type { Dictionary } from '@renderer/i18n'
import type { StoredAgentLogEntry } from '../../../shared/agent-types'
import { trimMarkdownLines } from './agent-run-markdown'
import type { AgentLogEntry, AgentRunAction, AgentRunViewState } from './terminal-tabs'

export function logClassName(kind: AgentLogEntry['kind']): string {
  const base = 'rounded-lg border p-3 shadow-sm'

  switch (kind) {
    case 'user':
      return `${base} ml-8 border-primary/20 bg-primary/10 shadow-primary/5`
    case 'assistant':
      return `${base} mr-8 border-border/80 bg-card/85 shadow-black/5`
    case 'error':
      return `${base} border-destructive/40 bg-destructive/10 text-destructive`
    case 'tool':
      return `${base} border-amber-500/30 bg-amber-500/10`
    case 'command':
      return `${base} border-sky-400/30 bg-sky-400/10`
    case 'plan':
      return `${base} border-purple-500/30 bg-purple-500/10`
    default:
      return `${base} bg-muted/40 text-muted-foreground`
  }
}

export function isConversationLog(kind: AgentLogEntry['kind']): boolean {
  return kind === 'user' || kind === 'assistant' || kind === 'error'
}

export function actionLogClassName(kind: AgentLogEntry['kind']): string {
  switch (kind) {
    case 'tool':
      return 'border-amber-500/25 bg-amber-500/5'
    case 'command':
      return 'border-sky-400/25 bg-sky-400/5'
    case 'plan':
      return 'border-purple-500/25 bg-purple-500/5'
    case 'thought':
      return 'border-blue-500/25 bg-blue-500/5'
    default:
      return 'border-border bg-muted/20'
  }
}

export function summarizeBehaviorLog(
  value: string,
  kind: AgentLogEntry['kind'],
  t: Dictionary
): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (kind === 'command') {
    if (!firstLine) return t.terminal.commandExecuted
    if (firstLine.startsWith(`${t.terminal.commandExecuted}:`)) return t.terminal.commandExecuted
    if (firstLine.startsWith(`${t.terminal.connectionAction} `)) {
      return firstLine.split(':')[0] || t.terminal.connectionAction
    }
    return firstLine
  }

  return firstLine || t.input.actionDetails
}

export function logRoleLabel(kind: AgentLogEntry['kind'], t: Dictionary): string {
  switch (kind) {
    case 'user':
      return t.roles.user
    case 'assistant':
      return t.roles.assistant
    case 'error':
      return t.roles.error
    case 'tool':
      return t.roles.tool
    case 'command':
      return t.roles.command
    case 'plan':
      return t.roles.plan
    case 'thought':
      return t.roles.thought
    default:
      return t.roles.system
  }
}

export function formatLogTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

export function formatHistoryTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function hydrateStoredAgentLog(entry: StoredAgentLogEntry): AgentLogEntry {
  return {
    id: entry.logId,
    kind: normalizeStoredAgentLogKind(entry.kind),
    text: entry.text,
    createdAt: entry.createdAt
  }
}

export function normalizeStoredAgentLogKind(kind: string): AgentLogEntry['kind'] {
  if (
    kind === 'user' ||
    kind === 'assistant' ||
    kind === 'error' ||
    kind === 'status' ||
    kind === 'thought' ||
    kind === 'tool' ||
    kind === 'plan' ||
    kind === 'command'
  ) {
    return kind
  }

  return 'status'
}

export function formatAgentRunMarkdown(run: AgentRunViewState, t: Dictionary): string {
  const lines: string[] = []
  const visibleActions = run.actions.filter((action) => !isNoisyMcpCatalogAction(action))

  if (visibleActions.length > 0) {
    lines.push(`**${t.input.actions}**`, '')
    for (const action of visibleActions) {
      lines.push(`- ${action.title}`)
    }
    lines.push('', '<details>', `<summary>${t.input.actionDetails}</summary>`, '')
    for (const [index, action] of visibleActions.entries()) {
      lines.push(`#### ${index + 1}. ${action.title}`, '', formatActionNarrative(action, t), '')
    }
    lines.push('</details>')
  }

  if (run.result) {
    lines.push('', `**${t.input.result}**`, '', run.result)
  }

  if (run.error) {
    lines.push('', `**${t.input.error}**`, '', run.error)
  }

  if (typeof run.elapsedMs === 'number') {
    lines.push('', formatElapsedFooter(run.elapsedMs, t))
  }

  return lines.join('\n').trim()
}

export function appendElapsedFooter(text: string, elapsedMs: number, t: Dictionary): string {
  return [text.trim(), formatElapsedFooter(elapsedMs, t)].filter(Boolean).join('\n\n')
}

function formatActionNarrative(action: AgentRunAction, t: Dictionary): string {
  const intent = extractActionIntent(action, t)
  const lines = [
    ...(intent ? [`**${t.input.actionIntent}**`, intent, ''] : []),
    `**${t.input.rawActionObservation}**`,
    '```text',
    action.detail,
    '```'
  ]

  return lines.join('\n')
}

function extractActionIntent(action: AgentRunAction, t: Dictionary): string {
  const operationReason = extractLabeledSection(action.detail, t.commandReview.operationReason)
  if (operationReason) return operationReason

  const command = extractActionCommand(action.detail, t)
  if (command) return `${t.input.actionIntentCommand}\n\`\`\`bash\n${command}\n\`\`\``

  const planSteps = extractNumberedLines(action.detail)
  if (planSteps.length > 0) return [t.input.actionIntentPlan, ...planSteps].join('\n')

  const skillReason = extractLabeledSection(action.detail, t.input.skillMatchReason)
  if (skillReason) return `${t.input.actionIntentSkill} ${skillReason}`

  const normalizedDetail = action.detail.trim()
  if (normalizedDetail && normalizedDetail !== action.title.trim()) return normalizedDetail

  return ''
}

function extractActionCommand(detail: string, t: Dictionary): string {
  const labels = [
    'Command',
    t.commandReview.command,
    t.commandReview.submitted,
    `${t.commandReview.submitted}:`
  ]

  for (const label of labels) {
    const value = extractLabeledSection(detail, label)
    if (value) return value
  }

  return ''
}

function extractLabeledSection(detail: string, label: string): string {
  const lines = detail.replace(/\r\n/g, '\n').split('\n')
  const normalizedLabel = label.replace(/:$/, '').trim()
  const startIndex = lines.findIndex((line) => {
    const trimmed = line.trim()
    return trimmed === `${normalizedLabel}:` || trimmed.startsWith(`${normalizedLabel}: `)
  })
  if (startIndex < 0) return ''

  const firstLine = lines[startIndex].trim()
  const inlineValue = firstLine.slice(`${normalizedLabel}:`.length).trim()
  if (inlineValue) return inlineValue

  const valueLines: string[] = []
  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (valueLines.length > 0) break
      continue
    }
    if (/^[^:：]{1,32}[:：]\s*$/.test(trimmed) && valueLines.length > 0) break
    valueLines.push(line.trimEnd())
  }

  return trimMarkdownLines(valueLines)
}

function extractNumberedLines(detail: string): string[] {
  return detail
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
}

function formatElapsedFooter(elapsedMs: number, t: Dictionary): string {
  return ['---', '', `${t.input.elapsed}: ${formatElapsedDuration(elapsedMs)}`].join('\n')
}

function formatElapsedDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function isNoisyMcpCatalogAction(action: AgentRunAction): boolean {
  return /^Loaded \d+ MCP tools?[.:]?$/i.test(action.title.trim())
}
