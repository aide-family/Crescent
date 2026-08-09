import type {
  AgentConfig,
  AgentModelOption,
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference,
  StoredSessionTab
} from '../../../shared/agent-types'

export type AgentLogEntry =
  | { id: number; kind: 'user' | 'assistant' | 'error'; text: string; createdAt: string }
  | {
      id: number
      kind: 'user-supplement'
      text: string
      createdAt: string
      runId: string
    }
  | {
      id: number
      kind: 'status' | 'thought' | 'tool' | 'plan' | 'command'
      text: string
      createdAt: string
    }

/** Distributive omit so user-supplement keeps its runId discriminant. */
export type AgentLogEntryInput = AgentLogEntry extends infer Entry
  ? Entry extends AgentLogEntry
    ? Omit<Entry, 'id' | 'createdAt'>
    : never
  : never

export interface AgentRunViewState {
  logId: number
  runId?: string
  /** Derived snapshot for trace export / legacy consumers. */
  actions: AgentRunAction[]
  /** Structured timeline steps (Cursor-style). */
  steps: AgentRunStep[]
  /** Accumulated thinking/reasoning text (coalesced deltas). */
  thinkingText?: string
  startedAt?: number
  result?: string
  error?: string
  /** Structured provider failure class when error is set (additive). */
  errorKind?: 'quota' | 'transient' | 'other'
  errorProvider?: string
  errorResetHint?: string
  elapsedMs?: number
}

export type AgentRunStep =
  | {
      id: string
      kind: 'status'
      title: string
      detail?: string
    }
  | {
      id: string
      kind: 'thought'
      text: string
      phase: 'streaming' | 'done'
    }
  | {
      id: string
      kind: 'message'
      text: string
      phase: 'streaming' | 'done'
    }
  | {
      id: string
      kind: 'tool'
      name: string
      phase: 'started' | 'finished'
      argsText?: string
      command?: string
      resultText?: string
      isError?: boolean
      interrupted?: boolean
      timedOut?: boolean
      toolCallId?: string
    }
  | {
      id: string
      kind: 'user-supplement'
      text: string
      createdAt: string
    }
  | {
      id: string
      kind: 'approval'
      requestId: string
      command: string
      phase: 'pending' | 'approved' | 'rejected'
      auditSummary?: string
      operationReason?: string
      risk?: 'low' | 'medium' | 'high'
      riskPoints?: string[]
      impactAnalysis?: string
      recommendation?: string
      note?: string
      rejectionReason?: string
      source?: 'whitelist' | 'rule' | 'subagent' | 'timeout-fallback'
      elapsedMs?: number
    }

export interface AgentRunAction {
  title: string
  detail: string
}

export interface AgentToolReference {
  id: string
  name: string
  description: string
  source: 'built-in' | 'openapi' | 'mcp'
}

export interface AgentTerminalTab {
  id: string
  title: string
  /** Shared chat session id. Peer comparison terminals reuse the root tab id. */
  sessionGroupId: string
  providerId?: string
  model?: string
  connectionId?: string
  connectionName?: string
  isSsh: boolean
  sessionId?: number
  terminalReady: boolean
  /** Last local/PTY start failure; cleared on successful start. */
  terminalStartError?: string
  terminalCwd: string
  terminalMode: 'pty' | 'pipe'
  terminalOutput: string
  agentInput: string
  skillRefs: AgentSkillOption[]
  /** Selected wiki document ids injected as SOP guidance on the next agent run. */
  activeWikiIds: string[]
  pathRefs: AgentPathReference[]
  toolRefs: AgentToolReference[]
  wikiRefs: AgentWikiReference[]
  agentBusy: boolean
  agentThinking: boolean
  thinkingMessage?: string
  copiedLogId: number | null
  agentLog: AgentLogEntry[]
  subTerminals: TemporarySubterminal[]
  pendingClarification?: PendingAgentClarification
}

export interface PendingAgentClarification {
  kind: 'connection-intent'
  originalInput: string
  question: string
  options?: Array<{ id: string; label: string }>
  defaultOptionId?: string
}

export interface TemporarySubterminal {
  id: string
  name: string
  output: string
  rawOutput: string
  cwd: string
  status: 'active' | 'exited'
  widthPercent?: number
  connectionId?: string
  connectionName?: string
  isSsh?: boolean
  terminalMode?: 'pty' | 'pipe'
  sessionId?: number
  terminalReady?: boolean
}

const BLOCKED_TERMINAL_TITLE_PATTERN = /topology/i
/** Reserved ids historically collided across sessions; never mint or accept these. */
const RESERVED_TERMINAL_TAB_IDS = new Set(['default', 'local'])

export function createUniqueTerminalTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tab-${crypto.randomUUID()}`
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isReservedTerminalTabId(tabId: string | undefined): boolean {
  const normalized = tabId?.trim().toLowerCase()
  return !normalized || RESERVED_TERMINAL_TAB_IDS.has(normalized)
}

export function resolveTerminalTabId(requestedId?: string): string {
  const trimmed = requestedId?.trim()
  if (!trimmed || isReservedTerminalTabId(trimmed)) return createUniqueTerminalTabId()
  return trimmed
}

export function createTerminalTab(input?: Partial<AgentTerminalTab>): AgentTerminalTab {
  const id = resolveTerminalTabId(input?.id)
  const requestedGroupId = input?.sessionGroupId?.trim()
  const sessionGroupId =
    requestedGroupId && !isReservedTerminalTabId(requestedGroupId) ? requestedGroupId : id
  return {
    id,
    title: input?.title ?? 'Terminal',
    sessionGroupId,
    providerId: input?.providerId,
    model: input?.model,
    connectionId: input?.connectionId,
    connectionName: input?.connectionName,
    isSsh: input?.isSsh ?? false,
    sessionId: input?.sessionId,
    terminalReady: input?.terminalReady ?? false,
    terminalStartError: input?.terminalStartError,
    terminalCwd: input?.terminalCwd ?? '',
    terminalMode: input?.terminalMode ?? 'pty',
    terminalOutput: input?.terminalOutput ?? '',
    agentInput: input?.agentInput ?? '',
    skillRefs: input?.skillRefs ?? [],
    activeWikiIds: input?.activeWikiIds ?? [],
    pathRefs: input?.pathRefs ?? [],
    toolRefs: input?.toolRefs ?? [],
    wikiRefs: input?.wikiRefs ?? [],
    agentBusy: input?.agentBusy ?? false,
    agentThinking: input?.agentThinking ?? false,
    thinkingMessage: input?.thinkingMessage,
    copiedLogId: input?.copiedLogId ?? null,
    agentLog: input?.agentLog ?? [],
    subTerminals: input?.subTerminals ?? [],
    pendingClarification: input?.pendingClarification
  }
}

/** Footer / status-dot state for the local shell lifecycle. */
export function resolveShellFooterState(tab: {
  terminalReady: boolean
  sessionId?: number
  terminalStartError?: string
}): 'ready' | 'pending' | 'not-ready' {
  if (tab.terminalReady) return 'ready'
  if (tab.terminalStartError?.trim()) return 'not-ready'
  if (tab.sessionId) return 'not-ready'
  return 'pending'
}

export function toStoredSessionTabs(tabs: AgentTerminalTab[]): StoredSessionTab[] {
  return tabs.map((tab) => ({
    tabId: tab.id,
    sessionGroupId: getSessionGroupId(tab),
    title: tab.title,
    connectionId: tab.connectionId,
    connectionName: tab.connectionName,
    isSsh: tab.isSsh,
    terminalCwd: tab.terminalCwd,
    terminalMode: tab.terminalMode
  }))
}

/** Chat/session id shared by peer comparison terminals. */
export function getSessionGroupId(tab: Pick<AgentTerminalTab, 'id' | 'sessionGroupId'>): string {
  return tab.sessionGroupId || tab.id
}

export function getSessionTerminals(tabs: AgentTerminalTab[], groupId: string): AgentTerminalTab[] {
  return tabs.filter((tab) => getSessionGroupId(tab) === groupId)
}

/** Chat owner is the session root tab (id === sessionGroupId), else the first peer. */
export function getSessionChatTab(
  tabs: AgentTerminalTab[],
  tabOrGroupId: string
): AgentTerminalTab | undefined {
  const seed = tabs.find((tab) => tab.id === tabOrGroupId)
  const groupId = seed ? getSessionGroupId(seed) : tabOrGroupId
  const groupTabs = getSessionTerminals(tabs, groupId)
  if (groupTabs.length === 0) return undefined
  return groupTabs.find((tab) => tab.id === groupId) ?? groupTabs[0]
}

export function resolveSessionChatTabId(tabs: AgentTerminalTab[], tabId: string): string {
  const marker = '::subterminal::'
  const markerIndex = tabId.indexOf(marker)
  if (markerIndex !== -1) {
    const parentTabId = tabId.slice(0, markerIndex)
    return getSessionChatTab(tabs, parentTabId)?.id ?? parentTabId
  }
  return getSessionChatTab(tabs, tabId)?.id ?? tabId
}

/** One entry per chat session for the session selector. */
export function listSessionChatTabs(tabs: AgentTerminalTab[]): AgentTerminalTab[] {
  const seen = new Set<string>()
  const sessions: AgentTerminalTab[] = []
  for (const tab of tabs) {
    const groupId = getSessionGroupId(tab)
    if (seen.has(groupId)) continue
    seen.add(groupId)
    const chatTab = getSessionChatTab(tabs, groupId)
    if (chatTab) sessions.push(chatTab)
  }
  return sessions
}

export function getSessionDisplayTitle(tab: AgentTerminalTab, tabs: AgentTerminalTab[]): string {
  const groupId = getSessionGroupId(tab)
  const peers = getSessionTerminals(tabs, groupId)
  const chatTab = getSessionChatTab(tabs, groupId) ?? tab
  const base = getTerminalDisplayTitle(chatTab, tabs)
  if (peers.length <= 1) return base
  return `${base} · ${peers.length}`
}

export function getNextTerminalTitle(baseTitle: string, tabs: AgentTerminalTab[]): string {
  const normalizedBase = baseTitle.trim() || 'Terminal'
  const titles = new Set(tabs.map((tab) => tab.title))

  if (!titles.has(normalizedBase)) return normalizedBase

  for (let index = 1; ; index += 1) {
    const candidate = `${normalizedBase} ${index}`
    if (!titles.has(candidate)) return candidate
  }
}

export function sanitizeTerminalDisplayTitle(value: string | undefined, fallback: string): string {
  const title = value?.trim() ?? ''
  if (!title || BLOCKED_TERMINAL_TITLE_PATTERN.test(title)) return fallback
  return title
}

/** Stable base name used for grouping same-named sessions/tabs. */
export function getTerminalSessionBaseName(tab: AgentTerminalTab): string {
  if (tab.isSsh || tab.connectionId) {
    const raw = sanitizeTerminalDisplayTitle(tab.connectionName || tab.title, 'SSH')
    return stripTrailingSessionIndex(raw) || 'SSH'
  }

  const raw = sanitizeTerminalDisplayTitle(tab.title, 'Terminal')
  return stripTrailingSessionIndex(raw) || 'Terminal'
}

/**
 * Display label for a session/tab.
 * Uses the concrete session name, and appends a 1-based index when multiple
 * tabs share the same base name (e.g. `demo 1`, `demo 2`).
 */
export function getTerminalDisplayTitle(
  tab: AgentTerminalTab,
  tabs: AgentTerminalTab[] = []
): string {
  const baseName = getTerminalSessionBaseName(tab)
  if (tabs.length === 0) {
    return sanitizeTerminalDisplayTitle(tab.title, baseName)
  }

  const sameNameTabs = tabs.filter(
    (candidate) => getTerminalSessionBaseName(candidate) === baseName
  )
  if (sameNameTabs.length <= 1) return baseName

  const index = sameNameTabs.findIndex((candidate) => candidate.id === tab.id)
  const ordinal = index >= 0 ? index + 1 : sameNameTabs.length
  return `${baseName} ${ordinal}`
}

function stripTrailingSessionIndex(value: string): string {
  return value.replace(/\s+\d+$/u, '').trim()
}

export function resolveTabModelSelection(
  tab: AgentTerminalTab | undefined,
  config: AgentConfig,
  models: AgentModelOption[]
): { providerId?: string; model: string } {
  const providerId = tab?.providerId ?? config.providerId
  const providerModels = models.filter((model) => model.providerId === providerId)
  const model =
    tab?.model && providerModels.some((candidate) => candidate.id === tab.model)
      ? tab.model
      : (providerModels[0]?.id ?? config.model)

  return { providerId, model }
}
