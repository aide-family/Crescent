import { agentClient, connectionsClient, terminalClient } from '@renderer/clients'
import type { AgentLogEntryInput } from '@renderer/lib/terminal-tabs'
import type { AttentionNotifyOptions } from '@renderer/lib/pending-attention-notify'
import type { Dictionary } from '@renderer/i18n'
import { localizeAgentEventMessage } from '@renderer/lib/agent-event-formatters'
import {
  buildAgentInputWithReferences,
  buildCurrentTerminalAgentInput,
  buildPostLoginAgentInput,
  buildRecentConversationContext,
  buildResumeAgentInput,
  formatVisibleInputWithReferences,
  hasUsableCurrentTerminal,
  isContinueIntent,
  isExplicitConnectionRequest,
  isExplicitNonTerminalAgentRequest,
  isExplicitReconnectRequest,
  isPasswordChangedReconnectRequest
} from '@renderer/lib/agent-input'
import { formatAgentRunMarkdown } from '@renderer/lib/agent-log'
import { snapshotMessageReferences } from '@renderer/lib/agent-message-refs'
import { buildFinishPersistText, closeStreamingOpenSteps } from '@renderer/lib/agent-run-document'
import { resolveSuccessfulAgentResult } from '@renderer/lib/agent-run-finalize'
import { buildTraceFromAgentRunView } from '@renderer/lib/agent-run-trace-export'
import { ReuseAgentRun, waitForTerminalReadyForAgent } from '@renderer/lib/app-controller-support'
import { formatPipePrompt } from '@renderer/lib/app-shell'
import {
  buildBusySupplementArtifacts,
  mergePostLoginSupplements
} from '@renderer/lib/busy-supplement'
import { hasComposerRefTokens, stripComposerRefTokens } from '@renderer/lib/composer-ref-tokens'
import { markConnectionFailed, type ConnectionAttemptState } from '@renderer/lib/connection-attempt'
import {
  buildConnectionLoginActions,
  hasLiveTerminalSession
} from '@renderer/lib/connection-commands'
import { connTrace } from '@renderer/lib/connection-login-runtime'
import {
  formatConnectionClarifyOptions,
  isActiveLoggedInTerminal,
  isLeaveTargetDrift,
  prioritizeClarifyOptions,
  routeConnection,
  routeForcedConnection
} from '@renderer/lib/connection-route'
import { formatConnectionTarget } from '@renderer/lib/connections'
import { ensureLocalTerminalStarted } from '@renderer/lib/ensure-local-terminal'
import { summarizeNotificationBody } from '@renderer/lib/pending-attention-notify'
import { parseCompactSlashCommand } from '@renderer/lib/slash-commands'
import {
  CLARIFY_MANUAL_CONTINUE_ID,
  buildTerminalNotReadyClarifyOptions,
  isRemoteExecutionTab,
  isTerminalSnapshotReadyForAgent,
  resolveTerminalReadyGateOutcome
} from '@renderer/lib/terminal-ready-gate'
import {
  createTerminalTab,
  getSessionGroupId,
  getSessionTerminals,
  resolveSessionChatTabId,
  resolveTabModelSelection,
  retainSettledClarification,
  type AgentRunViewState,
  type AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import { FitAddon } from '@xterm/addon-fit'
import type { RefObject } from 'react'
import { FormEvent } from 'react'
import { hasExplicitLocalWorkIntent } from '../../../shared/agent-local-intent'
import { normalizeAgentStyle } from '../../../shared/agent-style'
import {
  type AgentConfig,
  type AgentConnectionIntentResult,
  type AgentModelOption,
  type CaptureKind,
  type ConnectionConfig,
  type StoredAgentRun
} from '../../../shared/agent-types'
import { parseCaptureIntent } from '../../../shared/capture-intent'
import { normalizeExecutionMode } from '../../../shared/execution-plan'
import { wrapSteerSupplementPayload } from '../../../shared/runtime-supplement'

interface Parameters {
  activeTabIdRef: RefObject<string>
  tabsRef: RefObject<AgentTerminalTab[]>
  startNewSession: () => void
  reloadApplicationRuntime: () => Promise<void>
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  applyComposerInput: (
    tab: AgentTerminalTab,
    value: string,
    extras?: Partial<AgentTerminalTab>
  ) => AgentTerminalTab
  compactCurrentSession: (instructions?: string) => Promise<void>
  startCaptureFromCurrentSession: (
    kind: CaptureKind,
    scope: 'turn' | 'session',
    seedText?: string,
    tabId?: string
  ) => Promise<void>
  t: Dictionary
  activeRunIdRef: RefObject<Map<string, string>>
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => number
  pendingPostLoginSupplementsRef: RefObject<Map<string, string[]>>
  updateAgentRun: (tabId: string, updater: (run: AgentRunViewState) => AgentRunViewState) => void
  updateConnectionAttempt: (
    chatTabId: string,
    updater: (state: ConnectionAttemptState) => ConnectionAttemptState
  ) => void
  connections: ConnectionConfig[]
  resolveConnectionIntentForInput: (
    input: string,
    options?: {
      conversationContext?: string
      currentConnectionId?: string
      currentConnectionName?: string
      terminalSummary?: string
    }
  ) => Promise<{ analysis?: AgentConnectionIntentResult; connection?: ConnectionConfig }>
  setActiveExecutionTerminal: (chatTabId: string, terminalTabId: string | null) => void
  appendStatusToActiveRunOrLog: (chatTabId: string, text: string, reuseRun?: ReuseAgentRun) => void
  pendingAttentionNotifierRef: RefObject<{
    notifyIfUnfocused: (
      pendingId: string,
      title: string,
      body: string,
      options?: AttentionNotifyOptions
    ) => void
    notifyRunComplete: (
      runId: string,
      title: string,
      body: string,
      options?: Omit<AttentionNotifyOptions, 'runId'>
    ) => void
    clear: (pendingId: string) => void
    clearApproval: (requestId: string) => void
    clearRunAttention: (runId: string) => void
    clearAll: () => void
  }>
  activeRunCanceledRef: RefObject<Set<string>>
  activeRunInputRef: RefObject<Map<string, string>>
  activeAgentRunRef: RefObject<Map<string, AgentRunViewState>>
  persistAgentRun: (run: StoredAgentRun) => void
  skipStoredPasswordTabsRef: RefObject<Set<string>>
  connectToConnection: (
    connection: ConnectionConfig,
    postLoginInput?: string,
    postLoginDisplayInput?: string,
    postLoginConversationContext?: string,
    postLoginAppendUserLog?: boolean,
    postLoginStartedAt?: number,
    reuseRun?: ReuseAgentRun,
    postLoginRefs?: { activeWikiIds?: string[]; activeSkillPaths?: string[] }
  ) => Promise<string>
  lastLoginRunLogIdRef: RefObject<Map<string, number>>
  fitAddonRef: RefObject<FitAddon | null>
  terminalSessionIdRef: RefObject<number | null>
  terminalModeRef: RefObject<'pty' | 'pipe'>
  terminalCwdRef: RefObject<string>
  pipePromptRef: RefObject<string>
  config: AgentConfig
  visibleModels: AgentModelOption[]
  activeExecutionTabIdRef: RefObject<Map<string, string>>
  locale: 'en' | 'zh-CN'
  sessionAgentStyle: 'swift' | 'concise' | 'guided' | 'teach'
  updateLogEntryText: (tabId: string, logId: number, text: string) => void
  pruneLiveRuns: (logIds: number[]) => void
}

export function useAgentController({
  activeTabIdRef,
  tabsRef,
  startNewSession,
  reloadApplicationRuntime,
  updateTab,
  applyComposerInput,
  compactCurrentSession,
  startCaptureFromCurrentSession,
  t,
  activeRunIdRef,
  appendLog,
  pendingPostLoginSupplementsRef,
  updateAgentRun,
  updateConnectionAttempt,
  connections,
  resolveConnectionIntentForInput,
  setActiveExecutionTerminal,
  appendStatusToActiveRunOrLog,
  pendingAttentionNotifierRef,
  activeRunCanceledRef,
  activeRunInputRef,
  activeAgentRunRef,
  persistAgentRun,
  skipStoredPasswordTabsRef,
  connectToConnection,
  lastLoginRunLogIdRef,
  fitAddonRef,
  terminalSessionIdRef,
  terminalModeRef,
  terminalCwdRef,
  pipePromptRef,
  config,
  visibleModels,
  activeExecutionTabIdRef,
  locale,
  sessionAgentStyle,
  updateLogEntryText,
  pruneLiveRuns
}: Parameters) {
  async function submitAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await submitAgentMessage()
  }

  async function submitAgentMessage(
    overrideInput?: string,
    options?: { forcedConnectionId?: string; skipUserLog?: boolean }
  ): Promise<void> {
    const terminalTabId = activeTabIdRef.current
    const chatTabId = resolveSessionChatTabId(tabsRef.current, terminalTabId)
    const tab = tabsRef.current.find((candidate) => candidate.id === chatTabId)
    let terminalTab = tabsRef.current.find((candidate) => candidate.id === terminalTabId)
    const rawInput = (overrideInput ?? tab?.agentInput ?? '').trim()
    const displayInput = stripComposerRefTokens(rawInput).trim()
    if (!displayInput && !hasComposerRefTokens(rawInput)) return

    if (/^\/new$/i.test(displayInput)) {
      startNewSession()
      return
    }

    if (/^\/reload$/i.test(displayInput)) {
      void reloadApplicationRuntime()
      return
    }

    const compactCommand = parseCompactSlashCommand(displayInput)
    if (compactCommand) {
      updateTab(chatTabId, (current) => applyComposerInput(current, ''))
      void compactCurrentSession(compactCommand.instructions)
      return
    }

    const captureIntent = parseCaptureIntent(displayInput)
    if (captureIntent) {
      updateTab(chatTabId, (current) => applyComposerInput(current, ''))
      void startCaptureFromCurrentSession(
        captureIntent.kind,
        captureIntent.scope,
        captureIntent.seedText
      )
      return
    }

    const skillRefs = tab?.skillRefs ?? []
    const pathRefs = tab?.pathRefs ?? []
    const toolRefs = tab?.toolRefs ?? []
    const wikiRefs = tab?.wikiRefs ?? []
    const wikiIds = [...(tab?.activeWikiIds ?? [])]
    const skillPaths = skillRefs.map((skill) => skill.path).filter(Boolean)
    const messageRefs = snapshotMessageReferences({
      skillRefs,
      wikiRefs,
      toolRefs,
      pathRefs
    })
    const resumeRequested = isContinueIntent(displayInput)
    const baseInput = buildAgentInputWithReferences(
      displayInput,
      skillRefs,
      pathRefs,
      toolRefs,
      wikiRefs,
      t
    )
    const input = resumeRequested && tab ? buildResumeAgentInput(tab, baseInput, t) : baseInput
    const conversationContext = tab ? buildRecentConversationContext(tab, displayInput, t) : ''
    const startedAt = Date.now()

    if (tab?.agentBusy) {
      updateTab(chatTabId, (current) => ({
        ...current,
        agentInput: '',
        skillRefs: [],
        pathRefs: [],
        toolRefs: [],
        wikiRefs: [],
        activeWikiIds: []
      }))
      const runId = activeRunIdRef.current.get(chatTabId)
      if (runId) {
        const artifacts = buildBusySupplementArtifacts({
          displayInput: rawInput,
          runId,
          createdAt: new Date().toISOString(),
          stepId: `supplement-${Date.now()}`,
          references: messageRefs
        })
        appendLog(artifacts.logEntry, chatTabId)
        const ok = await agentClient
          .supplement({ runId, input: wrapSteerSupplementPayload(input) })
          .then((result) => result?.ok === true)
          .catch(() => false)
        if (!ok) {
          // The agent session may not be active yet (e.g. still logging in via
          // post-connection automation). Queue the supplement so it is merged
          // into the post-login task input instead of being silently dropped.
          const pending = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
          pendingPostLoginSupplementsRef.current.set(chatTabId, [...pending, displayInput])
        }
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: [...(run.steps ?? []), artifacts.step]
        }))
      }
      return
    }

    updateTab(chatTabId, (current) => ({
      ...current,
      agentInput: '',
      skillRefs: [],
      pathRefs: [],
      toolRefs: [],
      wikiRefs: [],
      activeWikiIds: []
    }))
    // Clarify-card confirm resumes with skipUserLog — selection lives on the settled card
    // and assistant match steps, never as a second user bubble.
    if (!options?.skipUserLog) {
      appendLog(
        {
          kind: 'user',
          text: rawInput,
          references: messageRefs
        },
        chatTabId
      )
    }
    const setThinking = (message: string): void => {
      updateTab(chatTabId, (current) => ({
        ...current,
        agentThinking: true,
        thinkingMessage: message
      }))
    }
    const clearThinking = (): void => {
      updateTab(chatTabId, (current) => ({
        ...current,
        agentThinking: false,
        thinkingMessage: undefined
      }))
    }
    setThinking(t.input.thinkingAnalyzingRequest)

    const terminalContext = await terminalClient.getContext(terminalTabId)
    if (terminalContext.connectionOrigin === 'manual-shell' && terminalTab?.connectionId) {
      updateTab(terminalTabId, (current) => ({
        ...current,
        connectionId: undefined,
        connectionName: undefined,
        isSsh: false
      }))
      terminalTab = {
        ...terminalTab,
        connectionId: undefined,
        connectionName: undefined,
        isSsh: false
      }
    }
    connTrace(
      'getContext',
      `tab=${terminalTabId}`,
      `aligned=${terminalContext.sessionAligned ?? 'n/a'}`,
      `expected=${terminalContext.expectedHost ?? '-'}`,
      `tail=${terminalContext.output.slice(-160).replace(/\n/g, '\\n')}`
    )
    if (terminalContext.sessionAligned === 'drifted') {
      // Only clear readiness on real leave-target drift (local shell or jump
      // fall-back). Hostname≠IP false positives must keep terminalReady so
      // inspection reuses the live PTY instead of re-typing login actions.
      const leftTarget = isLeaveTargetDrift({
        sessionAligned: terminalContext.sessionAligned,
        promptHost: terminalContext.promptHost,
        returnToJumpHost: terminalContext.returnToJumpHost
      })
      if (leftTarget) {
        const driftedChatTabId = resolveSessionChatTabId(tabsRef.current, terminalTabId)
        updateConnectionAttempt(driftedChatTabId, (state) =>
          markConnectionFailed(state, { reason: t.terminal.connectionDriftedReconnecting })
        )
        updateTab(terminalTabId, (tab) => ({ ...tab, terminalReady: false }))
      }
    }
    const pendingClarification = tab?.pendingClarification
    const activePending =
      !options?.forcedConnectionId &&
      pendingClarification?.kind === 'connection-intent' &&
      !pendingClarification.settled
    const intentSourceInput = activePending
      ? `${pendingClarification.originalInput}\n\n${t.terminal.connectionClarifyReplyPrefix}\n${displayInput}`
      : displayInput
    if (activePending) {
      updateTab(chatTabId, (current) => ({ ...current, pendingClarification: undefined }))
    } else if (pendingClarification?.settled && !options?.forcedConnectionId) {
      // Cancelled/stale settled card: drop on next typed submit.
      updateTab(chatTabId, (current) => ({ ...current, pendingClarification: undefined }))
    }

    const explicitNonTerminalRequest = isExplicitNonTerminalAgentRequest(displayInput, toolRefs)
    const explicitLocalFileRequest = hasExplicitLocalWorkIntent(intentSourceInput)
    const sessionTabs = getSessionTerminals(
      tabsRef.current,
      getSessionGroupId(tab ?? terminalTab ?? { id: terminalTabId, sessionGroupId: terminalTabId })
    )
    const lastUsedConnectionId =
      (await connectionsClient.getLastUsed().catch(() => null)) ?? undefined
    let route = routeConnection({
      message: intentSourceInput,
      activeTabId: terminalTabId,
      activeTab: terminalTab,
      sessionTabs,
      connections,
      resumeRequested,
      explicitNonTerminal: explicitNonTerminalRequest,
      explicitLocalFile: explicitLocalFileRequest,
      sessionAligned: terminalContext.sessionAligned,
      promptHost: terminalContext.promptHost,
      aliases: terminalContext.aliases,
      expectedHost: terminalContext.expectedHost,
      returnToJumpHost: terminalContext.returnToJumpHost,
      monitorPolicy: terminalContext.monitorPolicy
    })
    connTrace(
      'route',
      `action=${route.action}`,
      `reason=${route.reason ?? '-'}`,
      `target=${route.targetTabId}`,
      `aligned=${terminalContext.sessionAligned ?? 'n/a'}`
    )

    const forcedConnectionId = options?.forcedConnectionId?.trim()
    if (forcedConnectionId) {
      const forcedConnection = connections.find((candidate) => candidate.id === forcedConnectionId)
      if (!forcedConnection) {
        console.warn('[connection-clarify] forcedConnectionId not found', forcedConnectionId)
      } else {
        route = routeForcedConnection({
          connection: forcedConnection,
          message: intentSourceInput,
          activeTabId: terminalTabId,
          activeTab: terminalTab,
          sessionTabs,
          sessionAligned: terminalContext.sessionAligned,
          promptHost: terminalContext.promptHost
        })
      }
    }

    const terminalSummary = [
      `mode=${terminalContext.mode}`,
      `cwd=${terminalContext.cwd || '-'}`,
      terminalTab?.connectionId ? `tabConnectionId=${terminalTab.connectionId}` : '',
      terminalTab?.connectionName ? `tabConnectionName=${terminalTab.connectionName}` : '',
      terminalTab?.isSsh ? 'tabIsSsh=true' : 'tabIsSsh=false',
      route.label ? `routeLabel=${route.label}` : '',
      route.action ? `routeAction=${route.action}` : '',
      `recentOutput=${terminalContext.output.slice(-1200)}`
    ]
      .filter(Boolean)
      .join('\n')

    let connectionIntent: Awaited<ReturnType<typeof resolveConnectionIntentForInput>> | undefined
    let executionTerminalId = terminalTabId
    const activeLoggedIn = isActiveLoggedInTerminal(terminalTab, {
      sessionAligned: terminalContext.sessionAligned,
      promptHost: terminalContext.promptHost,
      returnToJumpHost: terminalContext.returnToJumpHost
    })
    try {
      if (route.action === 'llm-fallback' && activeLoggedIn) {
        // Never let LLM / lastUsed steal an already logged-in active terminal.
        if (route.label) {
          setThinking(t.input.routingTo.replace('{label}', route.label))
        }
        connectionIntent = undefined
      } else if (route.action === 'llm-fallback') {
        setThinking(t.input.thinkingResolvingConnection)
        connectionIntent = await resolveConnectionIntentForInput(intentSourceInput, {
          conversationContext,
          currentConnectionId: terminalTab?.connectionId,
          currentConnectionName: terminalTab?.connectionName,
          terminalSummary
        })
        // User asked to log in but the model did not pick a target — ask, do not
        // guess lastUsed / the only configured host.
        if (
          isExplicitConnectionRequest(intentSourceInput) &&
          connectionIntent.analysis &&
          !connectionIntent.analysis.needsClarification &&
          !connectionIntent.analysis.shouldConnect
        ) {
          connectionIntent = {
            analysis: {
              ok: false,
              shouldConnect: false,
              confidence: 0,
              needsClarification: true,
              clarificationQuestion:
                connections.length > 0
                  ? t.terminal.connectionClarifyPickOne.replace(
                      '{options}',
                      formatConnectionClarifyOptions(
                        prioritizeClarifyOptions(
                          connections.map((c) => ({ id: c.id, label: c.name })),
                          terminalTab?.connectionId,
                          t.terminal.clarifyCurrentBadge
                        )
                      )
                    )
                  : t.terminal.connectionNoneConfigured,
              reason: 'llm-no-connect-login'
            }
          }
        }
      } else if (route.action === 'clarify') {
        const clarifyOptions = prioritizeClarifyOptions(
          route.clarifyOptions && route.clarifyOptions.length > 0
            ? route.clarifyOptions
            : connections.map((c) => ({ id: c.id, label: c.name })),
          terminalTab?.connectionId,
          t.terminal.clarifyCurrentBadge
        )
        const optionsText = formatConnectionClarifyOptions(clarifyOptions)
        const clarificationQuestion =
          route.reason === 'remote-no-connections'
            ? t.terminal.connectionNoneConfigured
            : optionsText
              ? t.terminal.connectionClarifyPickOne.replace('{options}', optionsText)
              : t.terminal.connectionClarifyFallback
        route = { ...route, clarifyOptions }
        connectionIntent = {
          analysis: {
            ok: false,
            shouldConnect: false,
            confidence: 0,
            needsClarification: true,
            clarificationQuestion,
            reason: route.reason
          }
        }
      } else if ((route.action === 'connect' || route.action === 'switch') && route.connection) {
        const thinkingLabel = route.label || route.connection.name
        setThinking(
          route.action === 'connect'
            ? t.terminal.autoConnecting.replace('{label}', thinkingLabel)
            : t.input.routingTo.replace('{label}', thinkingLabel)
        )
        // switch to an already-connected peer tab: reuse without reconnect
        if (route.action === 'switch' && route.targetTabId !== terminalTabId) {
          executionTerminalId = route.targetTabId
          setActiveExecutionTerminal(chatTabId, route.targetTabId)
          connectionIntent = undefined
        } else {
          connectionIntent = {
            analysis: {
              ok: true,
              shouldConnect: true,
              connectionId: route.connection.id,
              confidence: 100,
              executeAfterLogin: route.executeAfterLogin !== false,
              matchBasis: 'name',
              reason: `${t.terminal.connectionMatched}: ${route.connection.name}`
            },
            connection: route.connection
          }
        }
      } else {
        // reuse — instantaneous routing indicator, no LLM
        if (route.label) {
          setThinking(t.input.routingTo.replace('{label}', route.label))
        }
        connectionIntent = undefined
        if (route.reason === 'active-logged-in' && route.label) {
          appendStatusToActiveRunOrLog(
            chatTabId,
            t.terminal.usingCurrentConnection.replace('{name}', route.label)
          )
        }
      }
    } finally {
      // Keep thinking visible until the next concrete UI phase replaces it.
    }

    if (connectionIntent?.analysis?.needsClarification) {
      clearThinking()
      const question =
        connectionIntent.analysis.clarificationQuestion?.trim() ||
        t.terminal.connectionClarifyFallback
      const clarifyOptions = prioritizeClarifyOptions(
        route.clarifyOptions && route.clarifyOptions.length > 0
          ? route.clarifyOptions
          : connections.map((c) => ({ id: c.id, label: c.name })),
        terminalTab?.connectionId,
        t.terminal.clarifyCurrentBadge
      )
      const defaultOptionId =
        (terminalTab?.connectionId &&
        clarifyOptions.some((option) => option.id === terminalTab.connectionId)
          ? terminalTab.connectionId
          : undefined) ||
        (lastUsedConnectionId && clarifyOptions.some((option) => option.id === lastUsedConnectionId)
          ? lastUsedConnectionId
          : undefined)
      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'clarify',
                  kind: 'status',
                  title: t.terminal.connectionClarifyTitle,
                  detail: [connectionIntent.analysis.reason, question].filter(Boolean).join('\n')
                }
              ],
              result: question,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )
      updateTab(chatTabId, (current) => ({
        ...current,
        pendingClarification: {
          kind: 'connection-intent',
          routeId: `clarify-${crypto.randomUUID()}`,
          originalInput: pendingClarification?.originalInput || displayInput,
          question,
          options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
          defaultOptionId
        }
      }))
      pendingAttentionNotifierRef.current.notifyIfUnfocused(
        `clarify:${chatTabId}`,
        t.notifications.clarifyTitle,
        t.notifications.clarifyBody,
        { tabId: chatTabId, chatTabId }
      )
      return
    }

    const shouldUseCurrentTerminal =
      terminalContext.mode !== 'none' &&
      hasUsableCurrentTerminal(
        tabsRef.current.find((candidate) => candidate.id === executionTerminalId) ?? terminalTab,
        terminalContext.output,
        terminalContext.mode
      ) &&
      !connectionIntent?.analysis?.shouldConnect &&
      !explicitNonTerminalRequest &&
      !isExplicitConnectionRequest(displayInput)

    // Explicit login without a resolved target must not fall through to the main
    // model (it would otherwise invent a login method). Non-login work proceeds.
    if (
      !activeLoggedIn &&
      !connectionIntent?.analysis?.shouldConnect &&
      isExplicitConnectionRequest(intentSourceInput) &&
      connections.length > 0 &&
      !(
        tabsRef.current.find((candidate) => candidate.id === executionTerminalId)?.connectionId ||
        terminalTab?.connectionId ||
        terminalTab?.isSsh
      )
    ) {
      clearThinking()
      const clarifyOptions = prioritizeClarifyOptions(
        connections.map((c) => ({ id: c.id, label: c.name })),
        terminalTab?.connectionId,
        t.terminal.clarifyCurrentBadge
      )
      const optionsText = formatConnectionClarifyOptions(clarifyOptions)
      const question = t.terminal.connectionClarifyPickOne.replace('{options}', optionsText)
      const defaultOptionId =
        lastUsedConnectionId && clarifyOptions.some((option) => option.id === lastUsedConnectionId)
          ? lastUsedConnectionId
          : undefined
      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'clarify',
                  kind: 'status',
                  title: t.terminal.connectionClarifyTitle,
                  detail: question
                }
              ],
              result: question,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )
      updateTab(chatTabId, (current) => ({
        ...current,
        pendingClarification: {
          kind: 'connection-intent',
          routeId: `clarify-${crypto.randomUUID()}`,
          originalInput: pendingClarification?.originalInput || displayInput,
          question,
          options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
          defaultOptionId
        }
      }))
      pendingAttentionNotifierRef.current.notifyIfUnfocused(
        `clarify:${chatTabId}`,
        t.notifications.clarifyTitle,
        t.notifications.clarifyBody,
        { tabId: chatTabId, chatTabId }
      )
      return
    }

    if (
      activeLoggedIn &&
      connectionIntent?.analysis?.shouldConnect &&
      connectionIntent.connection?.id &&
      connectionIntent.connection.id !== terminalTab?.connectionId &&
      !options?.forcedConnectionId &&
      route.action !== 'connect' &&
      route.action !== 'switch'
    ) {
      // LLM / lastUsed must not steal a logged-in active terminal; explicit route actions may.
      connectionIntent = undefined
    }

    if (
      activeLoggedIn &&
      connectionIntent?.analysis?.shouldConnect &&
      connectionIntent.connection?.id === terminalTab?.connectionId &&
      !isExplicitReconnectRequest(intentSourceInput)
    ) {
      // Already on this connection: run the inspect/task in the live PTY.
      // Do not open a second login card or re-type ssh / login actions.
      connectionIntent = undefined
    }

    if (connectionIntent?.analysis?.shouldConnect) {
      clearThinking()
      const matchedConnection = connectionIntent.connection
      const executeAfterLogin = connectionIntent.analysis.executeAfterLogin === true

      if (!matchedConnection) {
        appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [],
                steps: [
                  {
                    id: 'match-miss',
                    kind: 'status',
                    title: t.terminal.connectionMatched,
                    detail: connectionIntent.analysis.reason ?? displayInput
                  }
                ],
                error: t.terminal.connectionNoMatch,
                elapsedMs: Date.now() - startedAt
              },
              t
            )
          },
          chatTabId
        )
        return
      }

      const matchDetail = [
        matchedConnection.name,
        `${t.terminal.connectionTarget}: ${formatConnectionTarget(matchedConnection)}`,
        connectionIntent.analysis.reason,
        executeAfterLogin ? t.terminal.postLoginSkillHint : ''
      ]
        .filter(Boolean)
        .join('\n')

      const taskInput =
        intentSourceInput === displayInput
          ? input
          : buildAgentInputWithReferences(
              intentSourceInput,
              skillRefs,
              pathRefs,
              toolRefs,
              wikiRefs,
              t
            )

      if (executeAfterLogin) {
        const runId = `run-${crypto.randomUUID()}`
        updateTab(chatTabId, (current) => ({
          ...current,
          agentInput: '',
          agentBusy: true,
          agentThinking: false,
          thinkingMessage: undefined,
          pendingClarification: retainSettledClarification(current.pendingClarification)
        }))
        activeRunCanceledRef.current.delete(chatTabId)
        activeRunIdRef.current.set(chatTabId, runId)
        activeRunInputRef.current.set(chatTabId, displayInput)
        const matchStep = {
          id: 'match',
          kind: 'status' as const,
          title: t.terminal.connectionMatched,
          detail: matchDetail
        }
        const runLogId = appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [],
                steps: [matchStep],
                startedAt
              },
              t
            )
          },
          chatTabId
        )
        activeAgentRunRef.current.set(chatTabId, {
          logId: runLogId,
          runId,
          actions: [],
          steps: [matchStep],
          startedAt,
          loginMeta: {
            connectionName: matchedConnection.name,
            host: matchedConnection.host,
            port: matchedConnection.port,
            user: matchedConnection.user,
            actionCount: buildConnectionLoginActions(matchedConnection).length
          }
        })
        updateAgentRun(chatTabId, (run) => run)
        void persistAgentRun({
          runId,
          tabId: chatTabId,
          input: displayInput,
          status: 'running',
          connectionId: matchedConnection.id
        })

        if (isPasswordChangedReconnectRequest(intentSourceInput)) {
          skipStoredPasswordTabsRef.current.add(matchedConnection.id)
        }

        const targetTabId = await connectToConnection(
          matchedConnection,
          buildPostLoginAgentInput(taskInput, matchedConnection, t),
          formatVisibleInputWithReferences(
            displayInput,
            skillRefs,
            pathRefs,
            toolRefs,
            wikiRefs,
            t
          ),
          conversationContext,
          false,
          startedAt,
          { logId: runLogId, runId },
          { activeWikiIds: wikiIds, activeSkillPaths: skillPaths }
        )
        setActiveExecutionTerminal(chatTabId, targetTabId)
        return
      }

      // Pure login (no follow-up task) still gets an assistant-run card so the
      // connection flow steps land inside it instead of scattered system rows.
      const loginRunId = `run-${crypto.randomUUID()}`
      updateTab(chatTabId, (current) => ({
        ...current,
        agentInput: '',
        agentBusy: true,
        agentThinking: false,
        thinkingMessage: undefined,
        pendingClarification: retainSettledClarification(current.pendingClarification)
      }))
      activeRunCanceledRef.current.delete(chatTabId)
      activeRunIdRef.current.set(chatTabId, loginRunId)
      activeRunInputRef.current.set(chatTabId, displayInput)
      const loginMatchStep = {
        id: 'match',
        kind: 'status' as const,
        title: t.terminal.connectionMatched,
        detail: matchDetail
      }
      const loginRunLogId = appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [loginMatchStep],
              startedAt
            },
            t
          )
        },
        chatTabId
      )
      activeAgentRunRef.current.set(chatTabId, {
        logId: loginRunLogId,
        runId: loginRunId,
        actions: [],
        steps: [loginMatchStep],
        startedAt,
        loginMeta: {
          connectionName: matchedConnection.name,
          host: matchedConnection.host,
          port: matchedConnection.port,
          user: matchedConnection.user,
          actionCount: buildConnectionLoginActions(matchedConnection).length
        }
      })
      lastLoginRunLogIdRef.current.set(chatTabId, loginRunLogId)
      updateAgentRun(chatTabId, (run) => run)
      void persistAgentRun({
        runId: loginRunId,
        tabId: chatTabId,
        input: displayInput,
        status: 'running',
        connectionId: matchedConnection.id
      })

      if (isPasswordChangedReconnectRequest(intentSourceInput)) {
        skipStoredPasswordTabsRef.current.add(matchedConnection.id)
      }

      void connectToConnection(matchedConnection)
      updateTab(chatTabId, (current) => ({
        ...current,
        pendingClarification: retainSettledClarification(current.pendingClarification)
      }))
      return
    }

    setThinking(t.input.thinkingPreparingRun)
    const resolvedInput =
      intentSourceInput === displayInput
        ? input
        : buildAgentInputWithReferences(
            intentSourceInput,
            skillRefs,
            pathRefs,
            toolRefs,
            wikiRefs,
            t
          )
    const runInput = shouldUseCurrentTerminal
      ? buildCurrentTerminalAgentInput(resolvedInput, terminalContext, t)
      : resolvedInput
    const executionTab =
      tabsRef.current.find((candidate) => candidate.id === executionTerminalId) ?? terminalTab

    if (isRemoteExecutionTab(executionTab)) {
      const liveContext = await terminalClient.getContext(executionTerminalId)
      if (!hasLiveTerminalSession(liveContext.mode)) {
        const connection = connections.find(
          (candidate) => candidate.id === executionTab?.connectionId
        )
        if (connection) {
          clearThinking()
          updateTab(chatTabId, (current) => ({
            ...current,
            agentInput: '',
            agentBusy: true,
            agentThinking: false,
            thinkingMessage: undefined
          }))
          const targetTabId = await connectToConnection(
            connection,
            buildPostLoginAgentInput(resolvedInput, connection, t),
            formatVisibleInputWithReferences(
              displayInput,
              skillRefs,
              pathRefs,
              toolRefs,
              wikiRefs,
              t
            ),
            conversationContext,
            false,
            startedAt,
            undefined,
            { activeWikiIds: wikiIds, activeSkillPaths: skillPaths }
          )
          setActiveExecutionTerminal(chatTabId, targetTabId)
          return
        }
      }
    }

    // Gate: ensure local PTY exists even when the terminal pane is hidden (xterm never mounted).
    const ensureResult = await ensureLocalTerminalStarted({
      tab: executionTab ?? createTerminalTab({ id: executionTerminalId, title: 'Terminal' }),
      getContext: async () => terminalClient.getContext(executionTerminalId),
      start: async () => {
        const dimensions =
          executionTerminalId === activeTabIdRef.current
            ? fitAddonRef.current?.proposeDimensions()
            : undefined
        return terminalClient.start({
          cols: dimensions?.cols ?? 80,
          rows: dimensions?.rows ?? 24,
          tabId: executionTerminalId
        })
      }
    })
    updateTab(executionTerminalId, () => ensureResult.tab)
    if (executionTerminalId === activeTabIdRef.current && ensureResult.ok) {
      terminalSessionIdRef.current = ensureResult.tab.sessionId ?? null
      terminalModeRef.current = ensureResult.tab.terminalMode
      terminalCwdRef.current = ensureResult.tab.terminalCwd
      pipePromptRef.current = formatPipePrompt(ensureResult.tab.terminalCwd)
    }

    const executionTabAfterEnsure =
      tabsRef.current.find((candidate) => candidate.id === executionTerminalId) ?? ensureResult.tab
    const isRemote = isRemoteExecutionTab(executionTabAfterEnsure)
    // Local non-SSH: skip long SSH wait — snapshot ready check only.
    const waitedOk = isRemote
      ? await waitForTerminalReadyForAgent(executionTerminalId, {
          getTab: () => tabsRef.current.find((candidate) => candidate.id === executionTerminalId)
        })
      : true
    const executionContext = await terminalClient.getContext(executionTerminalId)
    const readyTab = tabsRef.current.find((candidate) => candidate.id === executionTerminalId)
    const gate = resolveTerminalReadyGateOutcome({
      ensureOk: ensureResult.ok,
      ensureError: ensureResult.error,
      tab: readyTab,
      terminalMode: executionContext.mode,
      waitedOk:
        waitedOk &&
        isTerminalSnapshotReadyForAgent({
          tab: readyTab,
          terminalMode: executionContext.mode,
          output: executionContext.output
        }),
      failedToStartShellNotReady: t.terminal.failedToStartShellNotReady
    })
    if (gate.kind !== 'ready') {
      clearThinking()
      if (gate.kind === 'clarify') {
        const currentConnection =
          connections.find((candidate) => candidate.id === readyTab?.connectionId) ??
          connections.find((candidate) => candidate.id === executionTabAfterEnsure.connectionId)
        const clarifyOptions = buildTerminalNotReadyClarifyOptions({
          connections: currentConnection
            ? [{ id: currentConnection.id, label: currentConnection.name }]
            : [],
          currentConnectionId: currentConnection?.id,
          retryCurrentLabel: currentConnection
            ? t.terminal.clarifyRetryCurrent.replace('{label}', currentConnection.name)
            : undefined,
          manualContinueLabel: t.terminal.clarifyManualContinue,
          openConnectionsLabel: t.terminal.clarifyOpenConnections
        })
        const question = t.terminal.connectionNotReadyClarify
        appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [],
                steps: [
                  {
                    id: 'terminal-not-ready-clarify',
                    kind: 'status',
                    title: t.terminal.connectionClarifyTitle,
                    detail: question
                  }
                ],
                result: question,
                elapsedMs: Date.now() - startedAt
              },
              t
            )
          },
          chatTabId
        )
        updateTab(chatTabId, (current) => ({
          ...current,
          pendingClarification: {
            kind: 'connection-intent',
            routeId: `clarify-${crypto.randomUUID()}`,
            originalInput: displayInput,
            question,
            options: clarifyOptions,
            defaultOptionId: currentConnection?.id ?? CLARIFY_MANUAL_CONTINUE_ID
          }
        }))
        pendingAttentionNotifierRef.current.notifyIfUnfocused(
          `clarify:${chatTabId}`,
          t.notifications.clarifyTitle,
          t.notifications.clarifyBody,
          { tabId: chatTabId, chatTabId }
        )
        return
      }

      const reason = gate.reason
      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'terminal-not-ready',
                  kind: 'status',
                  title: t.terminal.failedToStartShell,
                  detail: reason
                }
              ],
              error: t.terminal.failedToStartShellReason.replace('{reason}', reason),
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )
      return
    }

    await runAgentConversation(
      runInput,
      executionTerminalId,
      readyTab?.connectionId || terminalTab?.connectionId || undefined,
      displayInput,
      false,
      startedAt,
      {
        conversationContext,
        chatTabId,
        connectionRouteLabel: route.label,
        activeWikiIds: wikiIds,
        activeSkillPaths: skillPaths
      }
    )
  }

  async function runAgentConversation(
    input: string,
    terminalTabId: string,
    connectionId?: string,
    displayInput = input,
    appendUserLog = true,
    startedAt = Date.now(),
    options: {
      conversationContext?: string
      chatTabId?: string
      reuseRun?: ReuseAgentRun
      connectionRouteLabel?: string
      activeWikiIds?: string[]
      activeSkillPaths?: string[]
    } = {}
  ): Promise<void> {
    const chatTabId = options.chatTabId ?? resolveSessionChatTabId(tabsRef.current, terminalTabId)
    // Merge supplements that were queued while no agent session was active
    // (e.g. typed during connection login) into the task that starts now.
    const pendingSupplements = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
    if (pendingSupplements.length > 0) {
      pendingPostLoginSupplementsRef.current.delete(chatTabId)
      input = mergePostLoginSupplements(input, pendingSupplements)
    }
    const reuseRun = options.reuseRun
    const existingReuse =
      reuseRun && activeAgentRunRef.current.get(chatTabId)?.logId === reuseRun.logId
        ? activeAgentRunRef.current.get(chatTabId)
        : undefined

    updateTab(chatTabId, (current) => ({
      ...current,
      agentInput: '',
      agentBusy: true,
      agentThinking: false,
      thinkingMessage: undefined,
      pendingClarification: retainSettledClarification(current.pendingClarification)
    }))
    activeRunCanceledRef.current.delete(chatTabId)
    const runId = existingReuse?.runId ?? reuseRun?.runId ?? `run-${crypto.randomUUID()}`
    activeRunIdRef.current.set(chatTabId, runId)
    activeRunInputRef.current.set(chatTabId, displayInput)
    setActiveExecutionTerminal(chatTabId, terminalTabId)
    void persistAgentRun({
      runId,
      tabId: chatTabId,
      input: displayInput,
      status: 'running',
      connectionId
    })
    if (existingReuse) {
      activeAgentRunRef.current.set(chatTabId, {
        ...existingReuse,
        runId,
        startedAt: existingReuse.startedAt ?? startedAt,
        error: undefined,
        elapsedMs: undefined
      })
      updateAgentRun(chatTabId, (run) => run)
    } else {
      if (appendUserLog) appendLog({ kind: 'user', text: displayInput }, chatTabId)
      const runLogId = appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: []
            },
            t
          )
        },
        chatTabId
      )
      activeAgentRunRef.current.set(chatTabId, {
        logId: runLogId,
        runId,
        actions: [],
        steps: [],
        startedAt
      })

      // Publish the initial structured run so the timeline renders immediately.
      updateAgentRun(chatTabId, (run) => run)
    }

    try {
      const runTab = tabsRef.current.find((candidate) => candidate.id === terminalTabId)
      const chatTab = tabsRef.current.find((candidate) => candidate.id === chatTabId)
      const runModelSelection = resolveTabModelSelection(chatTab ?? runTab, config, visibleModels)
      const executionTabId = activeExecutionTabIdRef.current.get(chatTabId) ?? terminalTabId
      const executionTabForRun =
        tabsRef.current.find((candidate) => candidate.id === executionTabId) ?? runTab
      const executionConnectionId =
        executionTabForRun?.isSsh && executionTabForRun.connectionId
          ? executionTabForRun.connectionId
          : undefined
      let terminalContext = ''
      try {
        const context = await terminalClient.getContext(executionTabId)
        const executionTab =
          tabsRef.current.find((candidate) => candidate.id === executionTabId) ?? runTab
        const executionConnection = connections.find(
          (candidate) => candidate.id === executionTab?.connectionId
        )
        const loggedIn = isActiveLoggedInTerminal(executionTab)
        const routeLine = options.connectionRouteLabel?.trim()
          ? `当前终端/连接：${options.connectionRouteLabel.trim()}`
          : ''
        terminalContext = [
          routeLine,
          `tabId: ${executionTabId}`,
          executionTab?.connectionId ? `connectionId: ${executionTab.connectionId}` : '',
          executionTab?.connectionName ? `connectionName: ${executionTab.connectionName}` : '',
          executionConnection?.host ? `host: ${executionConnection.host}` : '',
          `loggedIn: ${loggedIn ? 'yes' : 'no'}`,
          `alignment: ${context.alignment ?? 'unknown'}`,
          `ready: ${context.ready ? 'yes' : 'no'}`,
          `promptHost: ${context.promptHost ?? '-'}`,
          `aliases: ${(context.aliases ?? []).join(',') || '-'}`,
          `terminalReady: ${executionTab?.terminalReady ? 'yes' : 'no'}`,
          `mode: ${context.mode}`,
          `cwd: ${context.cwd || '-'}`,
          `shell: ${context.shell || '-'}`,
          '',
          (context.output || '').slice(-8000)
        ]
          .filter(Boolean)
          .join('\n')
      } catch {
        terminalContext = options.connectionRouteLabel?.trim()
          ? `当前终端/连接：${options.connectionRouteLabel.trim()}`
          : ''
      }
      const result = await agentClient.run({
        runId,
        input,
        skillInput: displayInput,
        conversationContext:
          options.conversationContext ?? buildRecentConversationContext(chatTab, displayInput, t),
        providerId: runModelSelection.providerId,
        model: runModelSelection.model,
        tabId: chatTabId,
        executionTabId,
        executionConnectionId,
        terminalContext,
        locale,
        agentStyle: normalizeAgentStyle(sessionAgentStyle),
        executionMode: normalizeExecutionMode(chatTab?.executionMode),
        activeWikiIds: options.activeWikiIds ?? chatTab?.activeWikiIds ?? [],
        activeSkillPaths:
          options.activeSkillPaths ??
          (chatTab?.skillRefs ?? []).map((skill) => skill.path).filter(Boolean)
      })

      if (activeRunCanceledRef.current.has(chatTabId)) return

      const notifyRunOutcome = (outcome: 'success' | 'error', summaryText: string): void => {
        if (activeRunCanceledRef.current.has(chatTabId)) return
        const title =
          outcome === 'success' ? t.notifications.runCompleteTitle : t.notifications.runFailedTitle
        const body =
          summarizeNotificationBody(summaryText) ||
          (outcome === 'success' ? t.input.done : t.input.failed)
        pendingAttentionNotifierRef.current.notifyRunComplete(runId, title, body, {
          tabId: executionTabId,
          chatTabId
        })
      }

      if (result.ok) {
        const resolved = resolveSuccessfulAgentResult({
          text: result.text,
          run: activeAgentRunRef.current.get(chatTabId),
          doneFallback: t.input.done
        })
        const elapsedMs = Date.now() - startedAt
        if (!resolved.ok) {
          updateAgentRun(chatTabId, (run) => ({
            ...run,
            steps: closeStreamingOpenSteps(run.steps ?? []),
            error: resolved.error,
            elapsedMs
          }))
          void persistAgentRun({
            runId,
            tabId: chatTabId,
            input: displayInput,
            status: 'error',
            connectionId,
            error: resolved.error,
            startedAt: new Date(startedAt).toISOString(),
            elapsedMs,
            trace: buildTraceFromAgentRunView({
              runId,
              tabId: chatTabId,
              displayInput,
              status: 'error',
              connectionId,
              run: activeAgentRunRef.current.get(chatTabId),
              startedAt,
              error: resolved.error
            })
          })
          notifyRunOutcome('error', resolved.error)
        } else {
          updateAgentRun(chatTabId, (run) => ({
            ...run,
            steps: closeStreamingOpenSteps(run.steps ?? []),
            result: resolved.text ?? '',
            elapsedMs
          }))
          void persistAgentRun({
            runId,
            tabId: chatTabId,
            input: displayInput,
            status: 'success',
            connectionId,
            output: resolved.text,
            startedAt: new Date(startedAt).toISOString(),
            elapsedMs,
            trace: buildTraceFromAgentRunView({
              runId,
              tabId: chatTabId,
              displayInput,
              status: 'success',
              connectionId,
              run: activeAgentRunRef.current.get(chatTabId),
              startedAt,
              output: resolved.text
            })
          })
          notifyRunOutcome('success', resolved.text)
        }
      } else {
        const elapsedMs = Date.now() - startedAt
        const humanError = localizeAgentEventMessage(result.error || t.input.failed, t)
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: closeStreamingOpenSteps(run.steps ?? []),
          error: humanError,
          elapsedMs
        }))
        void persistAgentRun({
          runId,
          tabId: chatTabId,
          input: displayInput,
          status: 'error',
          connectionId,
          error: humanError,
          startedAt: new Date(startedAt).toISOString(),
          elapsedMs,
          trace: buildTraceFromAgentRunView({
            runId,
            tabId: chatTabId,
            displayInput,
            status: 'error',
            connectionId,
            run: activeAgentRunRef.current.get(chatTabId),
            startedAt,
            error: humanError
          })
        })
        notifyRunOutcome('error', humanError)
      }
    } catch (error) {
      if (activeRunCanceledRef.current.has(chatTabId)) return

      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = localizeAgentEventMessage(rawMessage, t)
      const elapsedMs = Date.now() - startedAt
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        steps: closeStreamingOpenSteps(run.steps ?? []),
        error: message,
        elapsedMs
      }))
      void persistAgentRun({
        runId,
        tabId: chatTabId,
        input: displayInput,
        status: 'error',
        connectionId,
        error: message,
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs,
        trace: buildTraceFromAgentRunView({
          runId,
          tabId: chatTabId,
          displayInput,
          status: 'error',
          connectionId,
          run: activeAgentRunRef.current.get(chatTabId),
          startedAt,
          error: message
        })
      })
      pendingAttentionNotifierRef.current.notifyRunComplete(
        runId,
        t.notifications.runFailedTitle,
        summarizeNotificationBody(message) || t.input.failed,
        {
          tabId: activeExecutionTabIdRef.current.get(chatTabId) ?? terminalTabId,
          chatTabId
        }
      )
    } finally {
      // Only tear down if this run is still the active one (stop→resubmit race).
      if (activeRunIdRef.current.get(chatTabId) === runId) {
        const finishedRun = activeAgentRunRef.current.get(chatTabId)
        const finishedLogId = finishedRun?.logId
        // Persist the full compact document to SQLite; updateLogEntryText
        // structure-clamps only the in-memory agentLog copy for OOM safety.
        if (finishedRun && typeof finishedLogId === 'number') {
          try {
            updateLogEntryText(chatTabId, finishedLogId, buildFinishPersistText(finishedRun))
          } catch (error) {
            console.warn('[crescent] finish snapshot write failed; continuing teardown', error)
          }
        }
        activeAgentRunRef.current.delete(chatTabId)
        activeRunCanceledRef.current.delete(chatTabId)
        activeRunIdRef.current.delete(chatTabId)
        activeRunInputRef.current.delete(chatTabId)
        if (typeof finishedLogId === 'number') pruneLiveRuns([finishedLogId])
        updateTab(chatTabId, (current) => ({
          ...current,
          agentInput: '',
          agentBusy: false,
          agentThinking: false,
          thinkingMessage: undefined
        }))
      }
    }
  }
  return { submitAgent, submitAgentMessage, runAgentConversation }
}
