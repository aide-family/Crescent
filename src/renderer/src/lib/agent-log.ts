import type { Dictionary } from '@renderer/i18n'
import type { StoredAgentLogEntry } from '../../../shared/agent-types'
import { trimMarkdownLines } from './agent-run-markdown'
import type { AgentLogEntry, AgentRunAction, AgentRunViewState } from './terminal-tabs'

export function logClassName(kind: AgentLogEntry['kind']): string {
  switch (kind) {
    case 'user':
      return 'rounded-lg border border-primary/25 border-l-[3px] border-l-primary bg-primary/10 px-3.5 py-3 shadow-sm ml-6'
    case 'assistant':
      return 'rounded-lg border border-border/80 border-l-[3px] border-l-muted-foreground/45 bg-card px-3.5 py-3 shadow-sm mr-6'
    case 'error':
      return 'rounded-lg border border-destructive/35 border-l-[3px] border-l-destructive bg-destructive/10 px-3.5 py-3 text-destructive shadow-sm'
    case 'tool':
    case 'command':
    case 'plan':
    case 'thought':
    case 'status':
      return ''
    default:
      return 'rounded-lg border bg-muted/40 p-3 text-muted-foreground'
  }
}

export function isConversationLog(kind: AgentLogEntry['kind']): boolean {
  return kind === 'user' || kind === 'assistant' || kind === 'error'
}

/** Quieter treatment for tool/command/status rows so conversation stays primary. */
export function actionLogClassName(kind: AgentLogEntry['kind']): string {
  switch (kind) {
    case 'tool':
      return 'border-border/55 border-l-[2px] border-l-amber-500/45 bg-muted/10'
    case 'command':
      return 'border-border/55 border-l-[2px] border-l-sky-500/40 bg-muted/10'
    case 'plan':
      return 'border-border/55 border-l-[2px] border-l-primary/40 bg-muted/10'
    case 'thought':
      return 'border-border/50 border-l-[2px] border-l-muted-foreground/35 bg-transparent'
    default:
      return 'border-border/45 border-l-[2px] border-l-border/80 bg-transparent text-muted-foreground'
  }
}

export function logListItemSpacingClass(
  kind: AgentLogEntry['kind'],
  previousKind: AgentLogEntry['kind'] | undefined,
  isFirst: boolean
): string {
  if (isFirst) return 'mt-4'

  const conversation = isConversationLog(kind)
  const previousConversation = previousKind ? isConversationLog(previousKind) : false

  if (conversation) return previousConversation ? 'mt-3' : 'mt-4'
  return previousConversation ? 'mt-2' : 'mt-1'
}

export function isConnectionFailureLog(text: string, markers: string[]): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  return markers.some((marker) => {
    const needle = marker.trim()
    return Boolean(needle) && normalized.includes(needle)
  })
}

export function connectionFailureMarkers(t: Dictionary): string[] {
  return [
    t.terminal.postLoginTaskAborted,
    t.terminal.terminalReconnectFailed,
    t.terminal.terminalReconnectUnavailable,
    t.terminal.shellExited,
    t.connections.passwordEnvVarMissing,
    'SSH requires PTY'
  ]
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
