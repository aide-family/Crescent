import type { ConnectionConfig } from '../../../shared/agent-types'
import {
  findDirectlyMentionedConnection,
  getConnectionNameMentionTokens,
  isConnectionOnlyRequest,
  isExplicitConnectionRequest,
  isSameConnectionTab,
  normalizeConnectionMentionText,
  connectionNameTokenAppearsInInput
} from './agent-input'
import type { AgentTerminalTab } from './terminal-tabs'

export type ConnectionRouteAction = 'reuse' | 'switch' | 'connect' | 'clarify' | 'llm-fallback'

export interface ConnectionClarifyOption {
  id: string
  label: string
  /** True when this option is the active terminal's connection. */
  isCurrent?: boolean
}

export interface ConnectionRouteResult {
  targetTabId: string
  connectionId?: string
  connection?: ConnectionConfig
  action: ConnectionRouteAction
  /** Short UI label, e.g. "aide 集群" or tab title. */
  label: string
  executeAfterLogin?: boolean
  reason?: string
  /** Structured connection choices when action === 'clarify'. */
  clarifyOptions?: ConnectionClarifyOption[]
}

export interface ConnectionRouteContext {
  message: string
  activeTabId: string
  activeTab?: AgentTerminalTab
  /** Peer tabs in the same session (including active). */
  sessionTabs: AgentTerminalTab[]
  connections: ConnectionConfig[]
  /** Soft default from crescent-store (last successful SSH). */
  lastUsedConnectionId?: string
  resumeRequested?: boolean
  explicitNonTerminal?: boolean
  explicitLocalFile?: boolean
  /** Authoritative session/host alignment from main (terminal:get-context). */
  sessionAligned?: 'aligned' | 'drifted' | 'unknown'
}

/**
 * Layered connection routing: explicit → active-logged-in → soft → remote-pick → B → D.
 * Most messages resolve with zero LLM cost (reuse / switch / connect).
 */
export function routeConnection(ctx: ConnectionRouteContext): ConnectionRouteResult {
  const {
    message,
    activeTabId,
    activeTab,
    sessionTabs,
    connections,
    lastUsedConnectionId,
    resumeRequested,
    explicitNonTerminal,
    explicitLocalFile
  } = ctx

  const activeLabel = formatTabLabel(activeTab)

  if (resumeRequested || explicitNonTerminal || explicitLocalFile) {
    return {
      targetTabId: activeTabId,
      connectionId: activeTab?.connectionId,
      action: 'reuse',
      label: activeLabel,
      reason: 'skip-intent'
    }
  }

  // --- Layer A: explicit signals ---
  const atMention = resolveAtMention(message, connections, sessionTabs)
  if (atMention?.kind === 'tab') {
    return {
      targetTabId: atMention.tab.id,
      connectionId: atMention.tab.connectionId,
      connection: connections.find((c) => c.id === atMention.tab.connectionId),
      action: atMention.tab.id === activeTabId ? 'reuse' : 'switch',
      label: formatTabLabel(atMention.tab),
      reason: 'at-tab'
    }
  }

  const mentioned =
    atMention?.kind === 'connection'
      ? atMention.connection
      : findDirectlyMentionedConnection(message, connections)

  if (mentioned) {
    return resolveNamedConnection({
      mentioned,
      message,
      activeTabId,
      activeTab,
      sessionTabs,
      connections,
      activeLabel,
      sessionAligned: ctx.sessionAligned
    })
  }

  // Prefer the active logged-in terminal before soft / remote-pick / LLM.
  // Soft keyword hits must not steal an already-ready SSH session.
  if (
    shouldPreferActiveLoggedIn({
      activeTab,
      mentionedConnection: undefined,
      sessionAligned: ctx.sessionAligned
    })
  ) {
    return {
      targetTabId: activeTabId,
      connectionId: activeTab?.connectionId,
      connection: connections.find((c) => c.id === activeTab?.connectionId),
      action: 'reuse',
      label: activeLabel,
      reason: 'active-logged-in'
    }
  }

  // Active remote session has drifted (e.g. SSH closed by the remote side while
  // the outer PTY stayed alive). Reconnect the same connection through its
  // configured login actions instead of reusing a dead session or letting the
  // agent improvise a raw ssh command.
  if (ctx.sessionAligned === 'drifted' && activeTab?.connectionId) {
    const connection = connections.find((c) => c.id === activeTab.connectionId)
    if (connection) {
      return {
        targetTabId: activeTabId,
        connectionId: connection.id,
        connection,
        action: 'connect',
        label: activeLabel,
        reason: 'active-reconnect',
        executeAfterLogin: true
      }
    }
  }

  // --- Layer C: soft keyword mismatch (only when active is not a ready login) ---
  const softMatches = findSoftConnectionMatches(message, connections)
  if (softMatches.length > 1) {
    return {
      targetTabId: activeTabId,
      action: 'clarify',
      label: activeLabel,
      reason: 'ambiguous-matches',
      clarifyOptions: buildClarifyOptions(softMatches, activeTab?.connectionId)
    }
  }
  if (softMatches.length === 1) {
    return resolveNamedConnection({
      mentioned: softMatches[0],
      message,
      activeTabId,
      activeTab,
      sessionTabs,
      connections,
      activeLabel,
      soft: true,
      sessionAligned: ctx.sessionAligned
    })
  }

  // --- Remote ops without a named target: session / unique / lastUsed / clarify ---
  if (looksLikeRemoteOpsIntent(message)) {
    const remotePick = resolveRemoteOpsWithoutName({
      activeTabId,
      activeTab,
      sessionTabs,
      connections,
      lastUsedConnectionId,
      activeLabel,
      message
    })
    if (remotePick) return remotePick
  }

  // --- Layer B: inherit active terminal ---
  if (activeTab?.connectionId || activeTab?.isSsh) {
    return {
      targetTabId: activeTabId,
      connectionId: activeTab.connectionId,
      connection: connections.find((c) => c.id === activeTab.connectionId),
      action: 'reuse',
      label: activeLabel,
      reason: 'active-connected'
    }
  }

  // Local / ready terminal with no SSH target — stay put (no LLM).
  if (activeTab && !needsConnectionDiscovery(message, connections)) {
    return {
      targetTabId: activeTabId,
      action: 'reuse',
      label: activeLabel || 'local',
      reason: 'active-local'
    }
  }

  // --- Layer D: LLM fallback only when still unknown ---
  return {
    targetTabId: activeTabId,
    action: 'llm-fallback',
    label: activeLabel,
    reason: 'unknown'
  }
}

/** Synced “logged in / ready to reuse” for routing (no async PTY snapshot). */
export function isActiveLoggedInTerminal(
  tab:
    | Pick<
        AgentTerminalTab,
        'terminalReady' | 'connectionId' | 'isSsh' | 'sessionId' | 'terminalStartError'
      >
    | undefined,
  options?: { sessionAligned?: 'aligned' | 'drifted' | 'unknown' }
): boolean {
  if (!tab) return false
  if (tab.terminalStartError?.trim()) return false
  if (!tab.terminalReady) return false
  if (!(tab.connectionId || tab.isSsh)) return false
  if (options?.sessionAligned === 'drifted') return false
  return true
}

/**
 * Prefer reusing the active logged-in terminal unless the user explicitly named
 * a different connection (Layer A already handled that case).
 */
export function shouldPreferActiveLoggedIn(input: {
  activeTab?: AgentTerminalTab
  mentionedConnection?: ConnectionConfig
  sessionAligned?: 'aligned' | 'drifted' | 'unknown'
}): boolean {
  if (!isActiveLoggedInTerminal(input.activeTab, { sessionAligned: input.sessionAligned })) {
    return false
  }
  if (
    input.mentionedConnection &&
    !isSameConnectionTab(input.activeTab, input.mentionedConnection)
  ) {
    return false
  }
  return true
}

/** Put the active connection first and optionally mark it as current. */
export function buildClarifyOptions(
  connections: ConnectionConfig[],
  activeConnectionId?: string,
  currentBadge?: string
): ConnectionClarifyOption[] {
  const badge = currentBadge?.trim()
  const mapped = connections.map((connection) => {
    const isCurrent = Boolean(activeConnectionId && connection.id === activeConnectionId)
    const label = isCurrent && badge ? `${badge} · ${connection.name}` : connection.name
    return { id: connection.id, label, isCurrent }
  })
  if (!activeConnectionId) return mapped
  const current = mapped.filter((option) => option.id === activeConnectionId)
  const rest = mapped.filter((option) => option.id !== activeConnectionId)
  return [...current, ...rest]
}

/** Re-order / badge existing clarify options (ids already chosen by the router). */
export function prioritizeClarifyOptions(
  options: ConnectionClarifyOption[],
  activeConnectionId: string | undefined,
  currentBadge?: string
): ConnectionClarifyOption[] {
  const badge = currentBadge?.trim()
  const decorated = options.map((option) => {
    const isCurrent = Boolean(activeConnectionId && option.id === activeConnectionId)
    const alreadyBadged = Boolean(badge && option.label.startsWith(`${badge} · `))
    return {
      id: option.id,
      isCurrent,
      label: isCurrent && badge && !alreadyBadged ? `${badge} · ${option.label}` : option.label
    }
  })
  if (!activeConnectionId) return decorated
  return [
    ...decorated.filter((option) => option.id === activeConnectionId),
    ...decorated.filter((option) => option.id !== activeConnectionId)
  ]
}

function resolveNamedConnection(input: {
  mentioned: ConnectionConfig
  message: string
  activeTabId: string
  activeTab?: AgentTerminalTab
  sessionTabs: AgentTerminalTab[]
  connections: ConnectionConfig[]
  activeLabel: string
  soft?: boolean
  sessionAligned?: 'aligned' | 'drifted' | 'unknown'
}): ConnectionRouteResult {
  const {
    mentioned,
    message,
    activeTabId,
    activeTab,
    sessionTabs,
    activeLabel,
    soft,
    sessionAligned
  } = input
  const prefix = soft ? 'soft' : 'mention'

  if (isSameConnectionTab(activeTab, mentioned)) {
    if (sessionAligned === 'drifted') {
      return {
        targetTabId: activeTabId,
        connectionId: mentioned.id,
        connection: mentioned,
        action: 'connect',
        label: mentioned.name || activeLabel,
        reason: `${prefix}-reconnect`,
        executeAfterLogin: true
      }
    }
    return {
      targetTabId: activeTabId,
      connectionId: mentioned.id,
      connection: mentioned,
      action: 'reuse',
      label: mentioned.name || activeLabel,
      reason: `${prefix}-current`
    }
  }

  const peer = sessionTabs.find(
    (tab) => tab.connectionId === mentioned.id || tab.connectionName === mentioned.name
  )
  if (peer) {
    return {
      targetTabId: peer.id,
      connectionId: mentioned.id,
      connection: mentioned,
      action: 'switch',
      label: mentioned.name || formatTabLabel(peer),
      reason: soft ? 'soft-peer' : 'mention-peer-tab'
    }
  }

  return {
    targetTabId: activeTabId,
    connectionId: mentioned.id,
    connection: mentioned,
    action: 'connect',
    label: mentioned.name,
    executeAfterLogin: !isConnectionOnlyRequest(message, mentioned),
    reason: soft ? 'soft-new' : 'mention-new'
  }
}

function resolveRemoteOpsWithoutName(input: {
  activeTabId: string
  activeTab?: AgentTerminalTab
  sessionTabs: AgentTerminalTab[]
  connections: ConnectionConfig[]
  lastUsedConnectionId?: string
  activeLabel: string
  message: string
}): ConnectionRouteResult | undefined {
  const {
    activeTabId,
    activeTab,
    sessionTabs,
    connections,
    lastUsedConnectionId,
    activeLabel,
    message
  } = input

  // Already on a connected tab — reuse (do not ask how to log in).
  if (activeTab?.connectionId || activeTab?.isSsh) {
    return {
      targetTabId: activeTabId,
      connectionId: activeTab.connectionId,
      connection: connections.find((c) => c.id === activeTab.connectionId),
      action: 'reuse',
      label: activeLabel,
      reason: 'remote-active-connected'
    }
  }

  // Session already has a connected peer tab — switch there.
  const sessionConnected = sessionTabs.find((tab) => Boolean(tab.connectionId) || tab.isSsh)
  if (sessionConnected?.connectionId) {
    const connection = connections.find((c) => c.id === sessionConnected.connectionId)
    return {
      targetTabId: sessionConnected.id,
      connectionId: sessionConnected.connectionId,
      connection,
      action: sessionConnected.id === activeTabId ? 'reuse' : 'switch',
      label: connection?.name || formatTabLabel(sessionConnected),
      reason: 'remote-session-default'
    }
  }

  if (connections.length === 0) {
    return {
      targetTabId: activeTabId,
      action: 'clarify',
      label: activeLabel || 'local',
      reason: 'remote-no-connections',
      clarifyOptions: []
    }
  }

  // The user explicitly asked to log into / connect to a named target that did
  // not match any configured connection (e.g. "登录demo集群" when the only
  // matching name is "demo测试集群"). Never guess with the last-used
  // connection — ask which connection is intended.
  if (isExplicitConnectionRequest(message)) {
    return {
      targetTabId: activeTabId,
      action: 'clarify',
      label: activeLabel,
      reason: 'explicit-unnamed-request',
      clarifyOptions: buildClarifyOptions(connections, activeTab?.connectionId)
    }
  }

  if (connections.length === 1) {
    const only = connections[0]
    return {
      targetTabId: activeTabId,
      connectionId: only.id,
      connection: only,
      action: 'connect',
      label: only.name,
      executeAfterLogin: true,
      reason: 'remote-unique-connect'
    }
  }

  if (lastUsedConnectionId) {
    const last = connections.find((c) => c.id === lastUsedConnectionId)
    if (last) {
      const peer = sessionTabs.find((tab) => tab.connectionId === last.id)
      if (peer) {
        return {
          targetTabId: peer.id,
          connectionId: last.id,
          connection: last,
          action: peer.id === activeTabId ? 'reuse' : 'switch',
          label: last.name,
          reason: 'remote-last-used-peer'
        }
      }
      return {
        targetTabId: activeTabId,
        connectionId: last.id,
        connection: last,
        action: 'connect',
        label: last.name,
        executeAfterLogin: true,
        reason: 'remote-last-used-connect'
      }
    }
  }

  return {
    targetTabId: activeTabId,
    action: 'clarify',
    label: activeLabel,
    reason: 'remote-ambiguous',
    clarifyOptions: buildClarifyOptions(connections, activeTab?.connectionId)
  }
}

function formatTabLabel(tab: AgentTerminalTab | undefined): string {
  if (!tab) return ''
  return tab.connectionName || tab.title || tab.id
}

/** Parse `@name` tokens against connections and session tab titles. */
export function resolveAtMention(
  message: string,
  connections: ConnectionConfig[],
  sessionTabs: AgentTerminalTab[]
):
  | { kind: 'connection'; connection: ConnectionConfig }
  | { kind: 'tab'; tab: AgentTerminalTab }
  | undefined {
  const mentions = [...message.matchAll(/(?:^|[\s，,])@([^\s@]+)/g)].map((m) => m[1])
  if (mentions.length === 0) return undefined

  for (const raw of mentions) {
    const normalized = normalizeConnectionMentionText(raw)
    if (!normalized) continue

    const tabHits = sessionTabs.filter((tab) => {
      const title = normalizeConnectionMentionText(tab.title)
      const name = normalizeConnectionMentionText(tab.connectionName ?? '')
      return (
        (title.length >= 2 && (title.includes(normalized) || normalized.includes(title))) ||
        (name.length >= 2 && (name.includes(normalized) || normalized.includes(name)))
      )
    })
    if (tabHits.length === 1) return { kind: 'tab', tab: tabHits[0] }

    const connHits = connections.filter((connection) =>
      getConnectionNameMentionTokens(connection).some(
        (token) => token.includes(normalized) || normalized.includes(token)
      )
    )
    if (connHits.length === 1) return { kind: 'connection', connection: connHits[0] }
  }

  return undefined
}

/**
 * True when the message looks like cluster/host ops that typically need SSH/k8s context.
 */
export function looksLikeRemoteOpsIntent(message: string): boolean {
  return (
    /(?:kubectl|kubeadm|helm|k9s|\bk8s\b|kubernetes)/i.test(message) ||
    /(?:集群|命名空间|命名空間|pod|pods|节点|node|nodes|deployment|namespace)/i.test(message) ||
    /(?:^|[\s，,])(?:ssh|login|connect|连接|登录|登陆|切换到|打开)/i.test(message) ||
    /(?:巡检|健康检查|架构图|拓扑|网络架构)/i.test(message)
  )
}

/**
 * True when the message looks like it needs SSH discovery
 * (no active connection and mentions connect-ish or unknown host words).
 */
export function needsConnectionDiscovery(
  message: string,
  connections: ConnectionConfig[]
): boolean {
  if (connections.length === 0) return false
  if (looksLikeRemoteOpsIntent(message)) return true
  return findSoftConnectionMatches(message, connections).length > 0
}

/**
 * Whether the execution tab is ready for agent bash (avoids No active terminal session).
 */
export function isExecutionTerminalReadyForAgent(input: {
  tab?: Pick<AgentTerminalTab, 'terminalReady' | 'connectionId' | 'isSsh'>
  terminalMode?: string
}): boolean {
  if (input.terminalMode === 'none') return false
  if (input.tab && input.tab.terminalReady === false) return false
  if (input.terminalMode === 'pty' || input.terminalMode === 'pipe') return true
  // If mode unknown, require terminalReady when tab is present
  if (input.tab) return Boolean(input.tab.terminalReady)
  return false
}

function findSoftConnectionMatches(
  message: string,
  connections: ConnectionConfig[]
): ConnectionConfig[] {
  if (!message.trim()) return []

  return connections.filter((connection) =>
    getConnectionNameMentionTokens(connection).some(
      (token) => token.length >= 3 && connectionNameTokenAppearsInInput(message, token)
    )
  )
}

/** Format selected suggestion texts for injection into the agent input. */
export function formatSuggestionsForInput(texts: string[]): string {
  return texts
    .map((text, index) => {
      const trimmed = text.trim().replace(/^\d+[.)、]\s*/, '')
      return `${index + 1}. ${trimmed}`
    })
    .filter(Boolean)
    .join('\n')
}

/** Build a numbered clarify question from connection options. */
export function formatConnectionClarifyOptions(options: ConnectionClarifyOption[]): string {
  return options.map((option, index) => `${index + 1}. ${option.label}`).join('\n')
}

export interface ConnectionClarifyConfirmTarget {
  id?: string
  index: number
  label: string
}

export interface ConnectionClarifyConfirmPayload {
  routeId: string
  target: ConnectionClarifyConfirmTarget
}

export type ConnectionClarifyConfirmAction =
  | { kind: 'noop'; reason: 'settled' | 'empty' | 'unmatched' }
  | { kind: 'open-connections' }
  | { kind: 'manual-continue'; originalInput: string }
  | {
      kind: 'connect'
      originalInput: string
      connectionId: string
      /** Full target for assistant-side steps; never assembled into a user bubble. */
      targetDetail: string
      label: string
    }

const SPECIAL_CLARIFY_IDS = new Set(['manual-continue', 'open-connections'])

/**
 * Resolve a clarify-card confirm into the next UI/agent action.
 * Connection picks force a concrete connectionId so rematch cannot re-ambiguate.
 * Does not build a synthetic user message — callers resume with originalInput + forcedConnectionId.
 */
export function resolveConnectionClarifyConfirm(input: {
  clarification: {
    routeId?: string
    originalInput: string
    options?: Array<{ id: string; label: string }>
    settled?: { status: 'confirmed' | 'cancelled'; label?: string }
  }
  payload: ConnectionClarifyConfirmPayload
  connections: ConnectionConfig[]
  formatTarget: (connection: ConnectionConfig) => string
}): ConnectionClarifyConfirmAction {
  if (input.clarification.settled) return { kind: 'noop', reason: 'settled' }
  const expectedRouteId = input.clarification.routeId?.trim()
  if (expectedRouteId && input.payload.routeId !== expectedRouteId) {
    return { kind: 'noop', reason: 'unmatched' }
  }

  const options = input.clarification.options ?? []
  const { target } = input.payload
  const trimmed = target.label.trim()
  if (!trimmed && target.id == null && target.index < 0) {
    return { kind: 'noop', reason: 'empty' }
  }

  const byId =
    target.id != null && target.id.length > 0
      ? options.find((option) => option.id === target.id)
      : undefined
  const byIndex =
    target.index >= 0 && target.index < options.length ? options[target.index] : undefined
  const byLabel = trimmed ? options.find((option) => option.label === trimmed) : undefined
  const matched = byId ?? byIndex ?? byLabel
  if (!matched) return { kind: 'noop', reason: 'unmatched' }

  if (matched.id === 'open-connections') return { kind: 'open-connections' }
  if (matched.id === 'manual-continue') {
    return {
      kind: 'manual-continue',
      originalInput: input.clarification.originalInput.trim() || matched.label
    }
  }

  if (SPECIAL_CLARIFY_IDS.has(matched.id)) {
    return { kind: 'noop', reason: 'unmatched' }
  }

  const connection = input.connections.find((candidate) => candidate.id === matched.id)
  if (!connection) {
    return { kind: 'noop', reason: 'unmatched' }
  }

  const originalInput = input.clarification.originalInput.trim() || matched.label
  const targetDetail = [connection.name, input.formatTarget(connection)].filter(Boolean).join(' | ')

  return {
    kind: 'connect',
    originalInput,
    connectionId: connection.id,
    targetDetail,
    label: matched.label
  }
}

/** Force route to a known connection after clarify confirm (skips rematch ambiguity). */
export function routeForcedConnection(input: {
  connection: ConnectionConfig
  message: string
  activeTabId: string
  activeTab?: AgentTerminalTab
  sessionTabs: AgentTerminalTab[]
}): ConnectionRouteResult {
  return resolveNamedConnection({
    mentioned: input.connection,
    message: input.message,
    activeTabId: input.activeTabId,
    activeTab: input.activeTab,
    sessionTabs: input.sessionTabs,
    connections: [input.connection],
    activeLabel: formatTabLabel(input.activeTab)
  })
}
