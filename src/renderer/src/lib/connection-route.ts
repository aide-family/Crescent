import type { ConnectionConfig } from '../../../shared/agent-types'
import {
  findDirectlyMentionedConnection,
  getConnectionNameMentionTokens,
  isConnectionOnlyRequest,
  isExplicitConnectionRequest,
  isExplicitReconnectRequest,
  isPasswordChangedReconnectRequest,
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
  resumeRequested?: boolean
  explicitNonTerminal?: boolean
  explicitLocalFile?: boolean
  /** Authoritative session/host alignment from main (terminal:get-context). */
  sessionAligned?: 'aligned' | 'drifted' | 'unknown'
  /** Newest prompt host from get-context; used to distinguish local vs hop drift. */
  promptHost?: string
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

  // Reconnect (retry / re-login / password changed). A uniquely named
  // connection wins over the current tab's binding; otherwise reconnect the
  // current tab's configured SSH. Do not dump every saved connection as a
  // picker, and never retry a different host than the one the user named.
  if (isExplicitReconnectRequest(message)) {
    const connection =
      (mentioned && connections.find((candidate) => candidate.id === mentioned.id)) ||
      (activeTab?.connectionId &&
        connections.find((candidate) => candidate.id === activeTab.connectionId))
    if (connection) {
      return {
        targetTabId: activeTabId,
        connectionId: connection.id,
        connection,
        action: 'connect',
        label: connection.name || activeLabel,
        reason: 'explicit-reconnect',
        executeAfterLogin:
          !isPasswordChangedReconnectRequest(message) &&
          !isConnectionOnlyRequest(message, connection)
      }
    }
  }

  if (mentioned) {
    return resolveNamedConnection({
      mentioned,
      message,
      activeTabId,
      activeTab,
      sessionTabs,
      connections,
      activeLabel,
      sessionAligned: ctx.sessionAligned,
      promptHost: ctx.promptHost
    })
  }

  // Prefer the active logged-in terminal before soft / remote-pick / LLM.
  // Soft keyword hits must not steal an already-ready SSH session.
  if (
    shouldPreferActiveLoggedIn({
      activeTab,
      mentionedConnection: undefined,
      sessionAligned: ctx.sessionAligned,
      promptHost: ctx.promptHost
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

  // Active remote session has left the operation target (exit-to-local or
  // fall-back to the jump box). Reconnect through configured login actions so
  // the agent re-executes on the restored target — not the wrong host.
  // Missing promptHost is not local-shell; only EnvGuard `drifted` reconnects.
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
      sessionAligned: ctx.sessionAligned,
      promptHost: ctx.promptHost
    })
  }

  // Unnamed remote work: reuse an already-open session. Opening a new SSH
  // login requires identified login intent (named connection above, or an
  // explicit login request below) — never lastUsed / unique-host guessing.
  if (looksLikeRemoteOpsIntent(message) || isExplicitConnectionRequest(message)) {
    const remotePick = resolveRemoteOpsWithoutName({
      activeTabId,
      activeTab,
      sessionTabs,
      connections,
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
  options?: {
    sessionAligned?: 'aligned' | 'drifted' | 'unknown'
    promptHost?: string
  }
): boolean {
  if (!tab) return false
  if (tab.terminalStartError?.trim()) return false
  if (!tab.terminalReady) return false
  if (!(tab.connectionId || tab.isSsh)) return false
  // EnvGuard drift (exit-to-local or jump-box fall-back) is the only signal
  // that the PTY left the operation target. A missing promptHost or a bare
  // `#` misread as local-shell must not force a second login on a ready tab.
  if (options?.sessionAligned === 'drifted') {
    return false
  }
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
  promptHost?: string
}): boolean {
  if (
    !isActiveLoggedInTerminal(input.activeTab, {
      sessionAligned: input.sessionAligned,
      promptHost: input.promptHost
    })
  ) {
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

/** True only for a parsed local-shell prompt — undefined is "unknown", not local. */
export function isLocalShellPromptHost(promptHost: string | undefined): boolean {
  return promptHost === 'local-shell'
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
  promptHost?: string
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
    if (isExplicitReconnectRequest(message) || sessionAligned === 'drifted') {
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
  activeLabel: string
  message: string
}): ConnectionRouteResult | undefined {
  const { activeTabId, activeTab, sessionTabs, connections, activeLabel, message } = input

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

  // No existing session to reuse. Only an explicit login/connect request may
  // open a new SSH session, and then only after the user picks the target.
  if (!isExplicitConnectionRequest(message)) {
    return undefined
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

  // Named target did not match any configured connection (e.g. "登录demo集群"
  // when the configured name is "demo测试集群"). Ask — do not guess lastUsed.
  return {
    targetTabId: activeTabId,
    action: 'clarify',
    label: activeLabel,
    reason: 'explicit-unnamed-request',
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
 * Generic verbs such as 打开/open are not login intent by themselves.
 */
export function looksLikeRemoteOpsIntent(message: string): boolean {
  return (
    /(?:kubectl|kubeadm|helm|k9s|\bk8s\b|kubernetes)/i.test(message) ||
    /(?:集群|命名空间|命名空間|pod|pods|节点|node|nodes|deployment|namespace)/i.test(message) ||
    /(?:^|[\s，,])(?:ssh|login|connect|连接|登录|登陆|切换到|重新连接|恢复连接|重连)/i.test(
      message
    ) ||
    /(?:巡检|健康检查|架构图|拓扑|网络架构)/i.test(message) ||
    /(?:^|\n)\s*\[[^\n]*@[\w.-]+/.test(message) ||
    /\b(?:scp|rsync)\b/i.test(message)
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
  sessionAligned?: 'aligned' | 'drifted' | 'unknown'
  promptHost?: string
}): ConnectionRouteResult {
  return resolveNamedConnection({
    mentioned: input.connection,
    message: input.message,
    activeTabId: input.activeTabId,
    activeTab: input.activeTab,
    sessionTabs: input.sessionTabs,
    connections: [input.connection],
    activeLabel: formatTabLabel(input.activeTab),
    sessionAligned: input.sessionAligned,
    promptHost: input.promptHost
  })
}
