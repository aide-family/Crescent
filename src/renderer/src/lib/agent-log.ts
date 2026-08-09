import type { Dictionary } from '@renderer/i18n'
import type { StoredAgentLogEntry } from '../../../shared/agent-types'
import { formatAgentRunDocument } from './agent-run-document'
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

export const AGENT_LOG_SOFT_LIMIT = 120

function isUserLikeLog(kind: AgentLogEntry['kind']): boolean {
  return kind === 'user' || kind === 'user-supplement'
}

/**
 * Trim agent log for memory while preferring conversation turns.
 * 1) Drop non-conversation / non-user-supplement rows first.
 * 2) If still over limit, drop oldest user / user-supplement rows.
 * 3) Never drop the newest user-like entry.
 * 4) Only then drop other oldest conversation rows if still over.
 */
export function trimAgentLogEntries(
  entries: AgentLogEntry[],
  limit = AGENT_LOG_SOFT_LIMIT
): AgentLogEntry[] {
  if (entries.length <= limit) return entries
  if (limit <= 0) return []

  const latestUserLikeIndex = findLastIndex(entries, (entry) => isUserLikeLog(entry.kind))
  const keepLatestUserLike = latestUserLikeIndex >= 0

  const droppable = entries.map((entry, index) => ({ entry, index }))
  const dropSet = new Set<number>()
  let remaining = entries.length - limit

  for (const item of droppable) {
    if (remaining <= 0) break
    if (isConversationLog(item.entry.kind) || isUserLikeLog(item.entry.kind)) continue
    dropSet.add(item.index)
    remaining -= 1
  }

  // Overflow: drop oldest user-like first (never the latest).
  for (const item of droppable) {
    if (remaining <= 0) break
    if (!isUserLikeLog(item.entry.kind)) continue
    if (keepLatestUserLike && item.index === latestUserLikeIndex) continue
    if (dropSet.has(item.index)) continue
    dropSet.add(item.index)
    remaining -= 1
  }

  // Still over: drop oldest remaining conversation (assistant/error), never latest user-like.
  for (const item of droppable) {
    if (remaining <= 0) break
    if (dropSet.has(item.index)) continue
    if (keepLatestUserLike && item.index === latestUserLikeIndex) continue
    if (!isConversationLog(item.entry.kind)) continue
    dropSet.add(item.index)
    remaining -= 1
  }

  // Last resort (tiny limit): drop anything except the pinned latest user-like.
  if (remaining > 0) {
    for (const item of droppable) {
      if (remaining <= 0) break
      if (dropSet.has(item.index)) continue
      if (keepLatestUserLike && item.index === latestUserLikeIndex) continue
      dropSet.add(item.index)
      remaining -= 1
    }
  }

  return entries.filter((_, index) => !dropSet.has(index))
}

/** Ids removed by trim — used to keep SQLite history in sync with in-memory log. */
export function collectTrimmedAgentLogIds(
  before: AgentLogEntry[],
  after: AgentLogEntry[]
): number[] {
  const keep = new Set(after.map((entry) => entry.id))
  return before.filter((entry) => !keep.has(entry.id)).map((entry) => entry.id)
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
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
    case 'user-supplement':
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
  const kind = normalizeStoredAgentLogKind(entry.kind)
  if (kind === 'user-supplement') {
    return {
      id: entry.logId,
      kind: 'user-supplement',
      text: entry.text,
      createdAt: entry.createdAt,
      runId: entry.runId?.trim() || ''
    }
  }
  return {
    id: entry.logId,
    kind,
    text: entry.text,
    createdAt: entry.createdAt
  }
}

export function normalizeStoredAgentLogKind(kind: string): AgentLogEntry['kind'] {
  if (
    kind === 'user' ||
    kind === 'user-supplement' ||
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
  return formatAgentRunDocument(
    {
      ...run,
      steps: run.steps ?? [],
      actions: (run.actions ?? []).filter((action) => !isNoisyMcpCatalogAction(action))
    },
    t
  )
}

export function appendElapsedFooter(text: string, elapsedMs: number, t: Dictionary): string {
  return [text.trim(), formatElapsedFooter(elapsedMs, t)].filter(Boolean).join('\n\n')
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
