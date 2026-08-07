import type { ConnectionConfig } from '../../../shared/agent-types'
import {
  findDirectlyMentionedConnection,
  getConnectionNameMentionTokens,
  isConnectionOnlyRequest,
  isSameConnectionTab,
  normalizeConnectionMentionText
} from './agent-input'
import type { AgentTerminalTab } from './terminal-tabs'

export type ConnectionRouteAction =
  | 'reuse'
  | 'switch'
  | 'connect'
  | 'clarify'
  | 'llm-fallback'

export interface ConnectionClarifyOption {
  id: string
  label: string
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
}

/**
 * Layered connection routing A→C→remote-pick→B→D.
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
      activeLabel
    })
  }

  // --- Layer C: soft keyword mismatch ---
  const softMatches = findSoftConnectionMatches(message, connections)
  if (softMatches.length > 1) {
    return {
      targetTabId: activeTabId,
      action: 'clarify',
      label: activeLabel,
      reason: 'ambiguous-matches',
      clarifyOptions: softMatches.map((connection) => ({
        id: connection.id,
        label: connection.name
      }))
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
      soft: true
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
      activeLabel
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

function resolveNamedConnection(input: {
  mentioned: ConnectionConfig
  message: string
  activeTabId: string
  activeTab?: AgentTerminalTab
  sessionTabs: AgentTerminalTab[]
  connections: ConnectionConfig[]
  activeLabel: string
  soft?: boolean
}): ConnectionRouteResult {
  const { mentioned, message, activeTabId, activeTab, sessionTabs, activeLabel, soft } = input
  const prefix = soft ? 'soft' : 'mention'

  if (isSameConnectionTab(activeTab, mentioned)) {
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
}): ConnectionRouteResult | undefined {
  const { activeTabId, activeTab, sessionTabs, connections, lastUsedConnectionId, activeLabel } =
    input

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
    clarifyOptions: connections.map((connection) => ({
      id: connection.id,
      label: connection.name
    }))
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
  const normalized = normalizeConnectionMentionText(message)
  if (!normalized) return []

  return connections.filter((connection) =>
    getConnectionNameMentionTokens(connection).some(
      (token) => token.length >= 3 && normalized.includes(token)
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
