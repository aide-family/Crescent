import { createChangePlanTool } from './pi-change-plan'
import { normalizeExecutionMode, type ExecutionMode } from '../../shared/execution-plan'
import { homedir } from 'os'
import { createHash } from 'node:crypto'
import { writeSystemLog } from '../logging'
import { buildHandoffContext, handoffSystemPrompt } from './handoff-context'
import { redactSensitiveText } from '../../shared/secret-redaction'
import {
  HANDOFF_DRAFT_MAX,
  HANDOFF_TIMEOUT_MS,
  HANDOFF_RETRY_DELAY_MS,
  validHandoffInput,
  validHandoffSession,
  validHandoffRequestId
} from '../../shared/handoff'
import type {
  AgentGenerateHandoffInput,
  AgentGenerateHandoffResult,
  AgentHandoffSessionInput,
  AgentCancelHandoffInput,
  AgentHandoffStatus
} from '../../shared/agent-types'
import { resolve } from 'path'

import type { WebContents } from 'electron'

import { buildLocalInstructionContext } from './instruction-files'
import { mapPiSessionEventToAgentEvents, resolveHostedPromptResult } from './pi-event-bridge'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { getCrescentPiSkillsDir } from './pi-paths'
import { GLOBAL_AGENT_SKILLS_TILDE } from '../crescent-paths'
import {
  resolvePiModel,
  resolveThinkingLevelForModel,
  syncCrescentProvidersToModelRuntime
} from './pi-model-runtime'
import { loadMcpPiTools } from './pi-mcp-tools'
import { loadPiSdk, type PiSdkFacade } from './pi-sdk'
import {
  clearPtyBashExecContext,
  clearPtyBashExecContextsForRun,
  createPtyBashToolDefinition,
  interruptPtyCommandsForRun,
  settlePtyInterruptsBeforeSessionAbort,
  setPtyBashExecContext
} from './pi-terminal-bash'
import {
  createOpenSubterminalToolDefinition,
  OPEN_SUBTERMINAL_DISCIPLINE,
  rejectAllSubterminalReadyWaiters
} from './pi-open-subterminal'
import { CREATE_CAPTURE_DISCIPLINE, createCaptureToolDefinitions } from './pi-create-capture'
import {
  abortChildSessionsForRun,
  createSubagentToolDefinition,
  SUBAGENT_DISCIPLINE
} from './pi-subagent'
import {
  hostedSessionToolProfile,
  needsModelChange,
  shouldReuseHostedSession
} from './pi-host-policy'
import { rejectPendingApprovalsForRun } from './command-approval'
import { createCrescentSettingsManager } from './pi-packages'
import {
  buildQuotaResetHint,
  classifyProviderError,
  isQuotaExhaustedError
} from '../../shared/provider-error'
import { buildPromptText, conversationContextForPrompt } from '../../shared/agent-run-prompt'
import { buildInvariantAgentPrompt } from '../../shared/agent-prompt-discipline'
import { normalizeAgentStyle, type AgentStyle } from '../../shared/agent-style'
import { diffSessionTokenUsage, snapshotSessionTokenUsage } from '../../shared/session-token-usage'
import type { AgentConfig, AgentEvent } from './types'
import type { SkillPromptPart, SopWikiPromptPart } from '../../shared/agent-run-prompt'

type AgentSession = Awaited<ReturnType<PiSdkFacade['createAgentSession']>>['session']

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  toolProfile: string
  immediateTools: string[]
  ownerId?: number
  handoffLastStarted?: number
  unsubscribe?: () => void
  closeMcp?: () => Promise<void>
}

interface ActiveRun {
  runId: string
  sessionKey: string
  abortRequested: boolean
  abortController: AbortController
}

const hostedSessions = new Map<string, HostedSession>()
const activeRuns = new Map<string, ActiveRun>()
const runIdBySessionKey = new Map<string, string>()
/** Manual compaction in flight (serialize against prompt / dispose). */
const compactingBySessionKey = new Set<string>()
/** Serialize ensure/dispose per session key. */
const handoffs = new Map<
  string,
  { requestId: string; ownerId: number; controller: AbortController }
>()
const sessionMutexTails = new Map<string, Promise<unknown>>()

async function withSessionMutex<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionMutexTails.get(sessionKey) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const current = previous.then(() => gate)
  sessionMutexTails.set(sessionKey, current)
  await previous.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (sessionMutexTails.get(sessionKey) === current) {
      sessionMutexTails.delete(sessionKey)
    }
  }
}

export interface PiHostRunInput {
  runId: string
  sessionKey: string
  input: string
  config: AgentConfig
  tabId?: string
  conversationContext?: string
  webContents: WebContents
  executionTabId: string
  /** SSH connection of the current execution pane, if remote. */
  executionConnectionId?: string
  terminalContext?: string
  locale?: string
  agentStyle?: AgentStyle
  executionMode?: ExecutionMode
  activeWikiDocs?: SopWikiPromptPart[]
  activeSkillDocs?: SkillPromptPart[]
  emit: (event: AgentEvent) => void
}

export interface PiHostRunResult {
  ok: boolean
  busy?: boolean
  text?: string
  error?: string
  canceled?: boolean
}

export async function runPiAgent(input: PiHostRunInput): Promise<PiHostRunResult> {
  const { runId, sessionKey, emit } = input
  if (
    runIdBySessionKey.has(sessionKey) ||
    compactingBySessionKey.has(sessionKey) ||
    handoffs.has(sessionKey)
  ) {
    return { ok: false, busy: true, error: 'Wait for the current agent run to finish.' }
  }
  const abortController = new AbortController()
  activeRuns.set(runId, { runId, sessionKey, abortRequested: false, abortController })
  runIdBySessionKey.set(sessionKey, runId)
  let usageBaseline:
    | {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
      }
    | undefined
  let usageSession: AgentSession | undefined

  try {
    if (!input.executionTabId?.trim()) {
      return {
        ok: false,
        error: 'Missing execution terminal tab. Open a terminal pane before running the agent.'
      }
    }

    const hosted = await ensureHostedSession(sessionKey, input.config)
    if (hosted.ownerId !== undefined && hosted.ownerId !== input.webContents.id) {
      return { ok: false, error: 'Session belongs to another window.' }
    }
    hosted.ownerId = input.webContents.id
    const modelRuntime = await syncCrescentProvidersToModelRuntime(input.config)
    const model = await resolvePiModel(input.config, modelRuntime)
    if (!model) {
      return {
        ok: false,
        error: 'No model available. Add an OpenAI-compatible provider with an API key in Settings.'
      }
    }

    if (needsModelChange(hosted.session.model, model)) {
      await hosted.session.setModel(model)
    }

    const thinkingLevel = resolveThinkingLevelForModel(model)
    try {
      hosted.session.setThinkingLevel(thinkingLevel)
    } catch {
      // Older sessions / models may reject unsupported thinking levels.
    }

    hosted.session.setActiveToolsByName(
      input.executionMode === 'planned' ? ['bash', 'submit_change_plan'] : hosted.immediateTools
    )

    setPtyBashExecContext(sessionKey, {
      webContents: input.webContents,
      executionTabId: input.executionTabId.trim(),
      chatTabId: input.tabId,
      runId,
      userInput: input.input,
      terminalContext: input.terminalContext,
      locale: input.locale,
      config: input.config,
      executionMode: normalizeExecutionMode(input.executionMode),
      emit,
      signal: abortController.signal,
      connectionId: input.executionConnectionId?.trim() || undefined,
      isSsh: Boolean(input.executionConnectionId?.trim())
    })

    emit({
      type: 'status',
      message: `Using ${model.provider}/${model.id}; bash runs in the visible terminal pane.`,
      runId,
      tabId: input.tabId
    })

    let collectedText = ''
    let lastRetryError = ''
    let compactedThisTurn = false
    let quotaExceeded:
      | {
          provider?: string
          resetHint: string
          retryAfterMs?: number
        }
      | undefined
    const bridgeLocale = input.locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    hosted.unsubscribe?.()

    const hasLiveSessionMessages = hostedSessionHasMessages(hosted.session)
    const promptText = buildPromptText({
      ...input,
      conversationContext: conversationContextForPrompt(
        input.conversationContext,
        hasLiveSessionMessages
      ),
      agentStyle: normalizeAgentStyle(input.agentStyle ?? input.config.agentStyle)
    })
    // Reused sessions can still be settling after abort; wait before a fresh prompt
    // so the SDK does not throw "Agent is already processing".
    if (hosted.session.isStreaming) {
      try {
        await Promise.race([
          hosted.session.waitForIdle(),
          new Promise<void>((resolve) => setTimeout(resolve, 3_000))
        ])
      } catch {
        // Continue; prompt may still fail and is localized in the renderer.
      }
    }

    const statsBefore = readHostedSessionTokenUsage(hosted.session)
    usageBaseline = statsBefore
    usageSession = hosted.session
    const emitUsageDelta = (): void => {
      emitRunUsageDelta(emit, runId, input.tabId, statsBefore, hosted.session)
    }

    hosted.unsubscribe = hosted.session.subscribe((event) => {
      if (event.type === 'auto_retry_start' && isQuotaExhaustedError(event.errorMessage ?? '')) {
        const classified = classifyProviderError(event.errorMessage ?? '')
        quotaExceeded = {
          provider: classified.provider ?? model.provider,
          resetHint: buildQuotaResetHint(classified.retryAfterMs, bridgeLocale),
          retryAfterMs: classified.retryAfterMs
        }
        // abortRetry() only works after _prepareRetry wires _retryAbortController
        // (created synchronously after this emit returns). Microtask is soon enough.
        queueMicrotask(() => {
          try {
            hosted.session.abortRetry()
          } catch {
            // ignore
          }
        })
      }

      for (const agentEvent of mapPiSessionEventToAgentEvents(event, {
        runId,
        tabId: input.tabId,
        locale: input.locale
      })) {
        if (agentEvent.type === 'token') {
          collectedText += agentEvent.text
        }
        if (
          agentEvent.type === 'status' &&
          typeof agentEvent.message === 'string' &&
          /^Retrying\b/i.test(agentEvent.message)
        ) {
          lastRetryError = agentEvent.message
        }
        if (agentEvent.type === 'error' && agentEvent.kind === 'quota' && !quotaExceeded) {
          quotaExceeded = {
            provider: agentEvent.provider ?? model.provider,
            resetHint:
              agentEvent.resetHint ?? buildQuotaResetHint(agentEvent.retryAfterMs, bridgeLocale),
            retryAfterMs: agentEvent.retryAfterMs
          }
        }
        emit(agentEvent)
      }

      if (
        event.type === 'compaction_end' &&
        (event.reason === 'threshold' || event.reason === 'overflow') &&
        !event.aborted
      ) {
        compactedThisTurn = true
      }

      if (
        event.type === 'compaction_end' ||
        event.type === 'turn_end' ||
        event.type === 'message_end'
      ) {
        emitUsageDelta()
      }
    })

    await hosted.session.prompt(promptText)

    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.', text: collectedText.trim() }
    }

    if (quotaExceeded) {
      const message = 'AccountQuotaExceeded'
      emit({
        type: 'error',
        message,
        kind: 'quota',
        code: 'quota_exceeded',
        provider: quotaExceeded.provider,
        resetHint: quotaExceeded.resetHint,
        retryAfterMs: quotaExceeded.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: message }
    }

    const resolved = resolveHostedPromptResult({
      messages: hosted.session.messages as unknown[],
      collectedText,
      lastRetryError,
      compactedThisTurn,
      locale: input.locale
    })

    if (!resolved.ok) {
      const classified = classifyProviderError(resolved.error)
      if (classified.kind === 'quota_exceeded') {
        emit({
          type: 'error',
          message: 'AccountQuotaExceeded',
          kind: 'quota',
          code: 'quota_exceeded',
          provider: classified.provider ?? model.provider,
          resetHint: buildQuotaResetHint(classified.retryAfterMs, bridgeLocale),
          retryAfterMs: classified.retryAfterMs,
          runId,
          tabId: input.tabId
        })
        return { ok: false, error: 'AccountQuotaExceeded' }
      }
      emit({
        type: 'error',
        message: resolved.error,
        kind:
          classified.kind === 'rate_limit' || classified.kind === 'transient'
            ? 'transient'
            : 'other',
        provider: classified.provider,
        retryAfterMs: classified.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: resolved.error }
    }

    emit({ type: 'done', message: resolved.text, runId, tabId: input.tabId })
    return { ok: true, text: resolved.text }
  } catch (error) {
    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.' }
    }
    const message = error instanceof Error ? error.message : String(error)
    const classified = classifyProviderError(message)
    if (classified.kind === 'quota_exceeded') {
      const locale = input.locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      emit({
        type: 'error',
        message: 'AccountQuotaExceeded',
        kind: 'quota',
        code: 'quota_exceeded',
        provider: classified.provider,
        resetHint: buildQuotaResetHint(classified.retryAfterMs, locale),
        retryAfterMs: classified.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: 'AccountQuotaExceeded' }
    }
    emit({
      type: 'error',
      message,
      kind:
        classified.kind === 'rate_limit' || classified.kind === 'transient' ? 'transient' : 'other',
      provider: classified.provider,
      retryAfterMs: classified.retryAfterMs,
      runId,
      tabId: input.tabId
    })
    return { ok: false, error: message }
  } finally {
    try {
      if (usageBaseline && usageSession) {
        emitRunUsageDelta(emit, runId, input.tabId, usageBaseline, usageSession)
      }
    } catch {
      // Usage is best-effort; never block run teardown.
    }
    clearPtyBashExecContextsForRun(runId)
    const hosted = hostedSessions.get(sessionKey)
    hosted?.unsubscribe?.()
    if (hosted) hosted.unsubscribe = undefined
    activeRuns.delete(runId)
    if (runIdBySessionKey.get(sessionKey) === runId) {
      runIdBySessionKey.delete(sessionKey)
    }
  }
}

export async function cancelPiAgentRun(runId: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  active.abortRequested = true
  // Abort signal settles pending PTY waiters (interrupted); interrupt also writes ^C.
  active.abortController.abort()
  rejectPendingApprovalsForRun(runId, 'Agent run was canceled.')
  rejectAllSubterminalReadyWaiters('Agent run was canceled.')
  await abortChildSessionsForRun(runId)
  const hosted = hostedSessions.get(active.sessionKey)
  try {
    await settlePtyInterruptsBeforeSessionAbort({
      settleInterrupts: () => interruptPtyCommandsForRun(runId),
      abortSession: async () => {
        await hosted?.session.abort()
      }
    })
  } catch {
    // ignore abort errors
  }
  return true
}

export async function steerPiAgentRun(runId: string, text: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  const hosted = hostedSessions.get(active.sessionKey)
  if (!hosted) return false
  try {
    await hosted.session.steer(text)
    return true
  } catch {
    return false
  }
}

export interface ReloadCrescentRuntimeInput {
  sessionKey?: string
  config: AgentConfig
}

export interface ReloadCrescentRuntimeResult {
  ok: boolean
  reloaded: number
  skippedBusy: number
  busySessionKeys: string[]
}

function isHostedSessionBusy(sessionKey: string, hosted: HostedSession): boolean {
  if (runIdBySessionKey.has(sessionKey)) return true
  if (compactingBySessionKey.has(sessionKey) || handoffs.has(sessionKey)) return true
  try {
    return Boolean(hosted.session.isStreaming || hosted.session.isCompacting)
  } catch {
    return false
  }
}

/** Read-only availability uses the same authority as generation, never UI history. */
export function getHostedHandoffStatus(
  input: AgentHandoffSessionInput,
  ownerId: number
): AgentHandoffStatus {
  if (!validHandoffSession(input)) return { available: false, error: 'invalid' }
  const hosted = hostedSessions.get(input.sessionKey)
  if (!hosted || hosted.ownerId !== ownerId) return { available: false, error: 'no_session' }
  if (isHostedSessionBusy(input.sessionKey, hosted)) return { available: false, error: 'busy' }
  const messages = hosted.session.sessionManager.buildSessionContext().messages
  if (
    !messages.some((message) => message.role === 'user' || message.role === 'compactionSummary')
  ) {
    return { available: false, error: 'empty' }
  }
  return {
    available: true,
    cwd: hosted.cwd,
    revision: hosted.session.sessionManager.getLeafId() ?? undefined
  }
}

export function cancelHostedHandoff(
  input: AgentCancelHandoffInput,
  ownerId: number
): { ok: boolean } {
  if (!validHandoffSession(input) || !validHandoffRequestId(input.requestId)) return { ok: false }
  const pending = handoffs.get(input.sessionKey)
  if (!pending || pending.ownerId !== ownerId || pending.requestId !== input.requestId)
    return { ok: false }
  pending.controller.abort()
  return { ok: true }
}

/** Independent completion: no session.prompt(), compact(), tools or original-history writes. */
export async function generateHandoffForHostedSession(
  input: AgentGenerateHandoffInput,
  config: AgentConfig,
  sender: WebContents
): Promise<AgentGenerateHandoffResult> {
  if (!validHandoffInput(input)) return { ok: false, error: 'invalid' }
  const status = getHostedHandoffStatus(input, sender.id)
  if (!status.available) return { ok: false, error: status.error }
  if (input.expectedRevision && input.expectedRevision !== status.revision)
    return { ok: false, error: 'stale' }
  const controller = new AbortController()
  // Reserve synchronously before waiting for the mutex: run/compact cannot slip in.
  handoffs.set(input.sessionKey, { requestId: input.requestId, ownerId: sender.id, controller })
  const started = Date.now()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, HANDOFF_TIMEOUT_MS)
  const onDestroyed = (): void => controller.abort()
  sender.once('destroyed', onDestroyed)
  const tabHash = createHash('sha256').update(input.tabId).digest('hex').slice(0, 8)
  writeSystemLog('info', `handoff start tab=${tabHash}`)
  let result: AgentGenerateHandoffResult = { ok: false, error: 'provider' }
  const canceled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('handoff aborted')), {
      once: true
    })
  })
  try {
    result = await Promise.race([
      canceled,
      withSessionMutex(input.sessionKey, async () => {
        if (controller.signal.aborted) return { ok: false, error: 'canceled' } as const
        const hosted = hostedSessions.get(input.sessionKey)
        if (!hosted || hosted.ownerId !== sender.id)
          return { ok: false, error: 'no_session' } as const
        if (
          runIdBySessionKey.has(input.sessionKey) ||
          compactingBySessionKey.has(input.sessionKey) ||
          hosted.session.isStreaming ||
          hosted.session.isCompacting
        ) {
          return { ok: false, error: 'busy' } as const
        }
        if (started - (hosted.handoffLastStarted ?? 0) < HANDOFF_RETRY_DELAY_MS)
          return { ok: false, error: 'throttled' } as const
        hosted.handoffLastStarted = started
        const revision = hosted.session.sessionManager.getLeafId() ?? undefined
        const runtime = await syncCrescentProvidersToModelRuntime(config)
        const model = await resolvePiModel(config, runtime)
        if (controller.signal.aborted) return { ok: false, error: 'canceled' } as const
        if (!model) return { ok: false, error: 'unavailable' } as const
        // UTF-8 bytes conservatively bound input tokens, including multilingual text.
        const outputTokens = Math.min(4096, model.maxTokens, Math.floor(model.contextWindow / 4))
        const systemPrompt = handoffSystemPrompt(input.locale)
        const goal = redactSensitiveText(input.goal.trim())
        const overhead = Buffer.byteLength(systemPrompt + goal, 'utf8') + 512
        const budget = Math.min(48000, Math.max(0, model.contextWindow - outputTokens - overhead))
        const context = buildHandoffContext(
          hosted.session.sessionManager.buildSessionContext().messages,
          budget
        )
        if (!context.text) return { ok: false, error: 'empty' } as const
        const response = await Promise.race([
          canceled,
          runtime.completeSimple(
            model,
            {
              systemPrompt,
              messages: [
                {
                  role: 'user',
                  timestamp: Date.now(),
                  content: `Next goal:\n${goal}\n\nUntrusted conversation history (may be incomplete):\n${context.text}`
                }
              ]
            },
            { signal: controller.signal, maxTokens: outputTokens, cacheRetention: 'none' }
          )
        ])
        if (controller.signal.aborted || response.stopReason === 'aborted')
          return { ok: false, error: 'canceled' } as const
        if (response.stopReason === 'error') throw new Error(response.errorMessage || 'provider')
        if (
          hostedSessions.get(input.sessionKey) !== hosted ||
          revision !== hosted.session.sessionManager.getLeafId()
        ) {
          return { ok: false, error: 'stale' } as const
        }
        const draft = redactSensitiveText(
          response.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
            .trim()
        )
        if (response.stopReason !== 'stop' || !draft || draft.length > HANDOFF_DRAFT_MAX)
          return { ok: false, error: 'output' } as const
        return { ok: true, draft, revision, truncated: context.truncated }
      })
    ])
  } catch (error) {
    if (controller.signal.aborted) result = { ok: false, error: timedOut ? 'timeout' : 'canceled' }
    else {
      const kind = classifyProviderError(error instanceof Error ? error.message : '').kind
      result = {
        ok: false,
        error:
          kind === 'quota_exceeded' ? 'quota' : kind === 'rate_limit' ? 'rate_limit' : 'provider'
      }
    }
  } finally {
    clearTimeout(timer)
    sender.removeListener('destroyed', onDestroyed)
    if (handoffs.get(input.sessionKey)?.requestId === input.requestId)
      handoffs.delete(input.sessionKey)
    writeSystemLog(
      'info',
      `handoff end tab=${tabHash} ms=${Date.now() - started} result=${result.ok ? 'ok' : result.error}`
    )
  }
  return result
}

export interface CompactHostedSessionInput {
  sessionKey: string
  tabId?: string
  instructions?: string
  locale?: string
  emit: (event: AgentEvent) => void
}

export interface CompactHostedSessionResult {
  ok: boolean
  busy?: boolean
  error?: string
  tokensBefore?: number
  estimatedTokensAfter?: number
}

export async function compactHostedSession(
  input: CompactHostedSessionInput
): Promise<CompactHostedSessionResult> {
  const sessionKey = input.sessionKey.trim()
  if (!sessionKey) return { ok: false, error: 'Missing session.' }
  if (handoffs.has(sessionKey))
    return { ok: false, busy: true, error: 'Wait for handoff generation to finish.' }

  return withSessionMutex(sessionKey, async () => {
    const hosted = hostedSessions.get(sessionKey)
    if (!hosted) {
      return { ok: false, error: 'No live session to compact.' }
    }
    if (isHostedSessionBusy(sessionKey, hosted)) {
      return { ok: false, busy: true, error: 'Wait for the current agent run to finish.' }
    }

    const runId = `compact-${Date.now().toString(36)}`
    const tabId = input.tabId?.trim() || sessionKey
    compactingBySessionKey.add(sessionKey)
    hosted.unsubscribe?.()
    hosted.unsubscribe = hosted.session.subscribe((event) => {
      for (const agentEvent of mapPiSessionEventToAgentEvents(event, {
        runId,
        tabId,
        locale: input.locale
      })) {
        input.emit(agentEvent)
      }
      if (event.type === 'compaction_end') {
        emitContextUsage(input.emit, runId, tabId, hosted.session)
      }
    })

    try {
      const result = await hosted.session.compact(input.instructions)
      emitContextUsage(input.emit, runId, tabId, hosted.session)
      return {
        ok: true,
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter: result.estimatedTokensAfter
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      input.emit({ type: 'error', message, runId, tabId })
      return { ok: false, error: message }
    } finally {
      hosted.unsubscribe?.()
      hosted.unsubscribe = undefined
      compactingBySessionKey.delete(sessionKey)
    }
  })
}

export async function reloadCrescentRuntime(
  input: ReloadCrescentRuntimeInput
): Promise<ReloadCrescentRuntimeResult> {
  const busySessionKeys: string[] = []
  const toDispose: string[] = []
  for (const [sessionKey, hosted] of hostedSessions) {
    if (isHostedSessionBusy(sessionKey, hosted)) {
      busySessionKeys.push(sessionKey)
      continue
    }
    toDispose.push(sessionKey)
  }

  let reloaded = 0
  for (const sessionKey of toDispose) {
    await withSessionMutex(sessionKey, async () => {
      const hosted = hostedSessions.get(sessionKey)
      if (!hosted) return
      if (isHostedSessionBusy(sessionKey, hosted)) {
        busySessionKeys.push(sessionKey)
        return
      }
      await disposeHostedSessionUnlocked(hosted)
      hostedSessions.delete(sessionKey)
      reloaded += 1
    })
  }

  const warmupKey = input.sessionKey?.trim()
  if (warmupKey && !busySessionKeys.includes(warmupKey)) {
    await ensureHostedSession(warmupKey, input.config)
  }

  return {
    ok: true,
    reloaded,
    skippedBusy: busySessionKeys.length,
    busySessionKeys
  }
}

async function ensureHostedSession(
  sessionKey: string,
  config: AgentConfig
): Promise<HostedSession> {
  return withSessionMutex(sessionKey, () => ensureHostedSessionUnlocked(sessionKey, config))
}

async function ensureHostedSessionUnlocked(
  sessionKey: string,
  config: AgentConfig
): Promise<HostedSession> {
  const existing = hostedSessions.get(sessionKey)
  const cwd = resolveAgentWorkspaceCwd(config)
  const toolProfile = hostedSessionToolProfile(config.mcpServers)
  if (shouldReuseHostedSession(existing, { cwd, toolProfile })) {
    return existing as HostedSession
  }
  if (existing) {
    if (runIdBySessionKey.has(sessionKey)) {
      throw new Error('Cannot recreate agent session while a run is active.')
    }
    await disposeHostedSessionUnlocked(existing)
    hostedSessions.delete(sessionKey)
  }

  const pi = await loadPiSdk()
  const { settingsManager, agentDir } = await createCrescentSettingsManager(cwd)
  const modelRuntime = await syncCrescentProvidersToModelRuntime(config)
  const model = await resolvePiModel(config, modelRuntime)

  const instructionContext = buildLocalInstructionContext()
  const additionalSkillPaths = collectSkillRoots(config)
  const ptyBashTool = createPtyBashToolDefinition(pi, cwd, sessionKey)

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths,
    noExtensions: true,
    systemPromptOverride: (base) =>
      buildInvariantAgentPrompt({
        base: base ?? '',
        instructionContext,
        openSubterminalDiscipline: OPEN_SUBTERMINAL_DISCIPLINE,
        createCaptureDiscipline: CREATE_CAPTURE_DISCIPLINE,
        subagentDiscipline: SUBAGENT_DISCIPLINE
      })
  })
  await resourceLoader.reload()

  const openSubterminalTool = await createOpenSubterminalToolDefinition(pi, sessionKey)
  const captureTools = await createCaptureToolDefinitions(pi, sessionKey)
  const subagentTool = await createSubagentToolDefinition(pi, sessionKey)
  const mcp = await loadMcpPiTools(pi, config.mcpServers)

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: resolveThinkingLevelForModel(model ?? undefined),
    modelRuntime,
    resourceLoader,
    customTools: [
      ptyBashTool as never,
      createChangePlanTool(pi, sessionKey) as never,
      openSubterminalTool as never,
      subagentTool as never,
      ...(captureTools as never[]),
      ...(mcp.tools as never[])
    ],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const hosted: HostedSession = {
    sessionKey,
    session,
    cwd,
    toolProfile,
    immediateTools: session.getActiveToolNames().filter((name) => name !== 'submit_change_plan'),
    closeMcp: mcp.close
  }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

async function disposeHostedSessionUnlocked(hosted: HostedSession): Promise<void> {
  clearPtyBashExecContext(hosted.sessionKey)
  try {
    hosted.unsubscribe?.()
    hosted.unsubscribe = undefined
  } catch {
    // ignore unsubscribe errors when recreating
  }
  try {
    await hosted.closeMcp?.()
  } catch {
    // ignore MCP close errors when recreating
  }
  try {
    hosted.session.dispose()
  } catch {
    // ignore dispose errors when recreating for tool profile upgrades
  }
}

function collectSkillRoots(config: AgentConfig): string[] {
  const roots = [getCrescentPiSkillsDir()]
  const configured = config.skillRoot?.trim()
  if (configured) {
    roots.push(resolve(configured.replace(/^~(?=$|[/\\])/, homedir())))
  }
  if (config.loadGlobalAgentSkills) {
    roots.push(resolve(GLOBAL_AGENT_SKILLS_TILDE.replace(/^~(?=$|[/\\])/, homedir())))
  }
  return [...new Set(roots)]
}

function hostedSessionHasMessages(session: AgentSession): boolean {
  try {
    return session.messages.length > 0
  } catch {
    return false
  }
}

function readHostedSessionTokenUsage(session: AgentSession): {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
} {
  try {
    return snapshotSessionTokenUsage(session.getSessionStats())
  } catch {
    return snapshotSessionTokenUsage(undefined)
  }
}

function readHostedSessionContextUsage(session: AgentSession): {
  contextTokens?: number | null
  contextWindow?: number
  contextPercent?: number | null
} {
  try {
    const usage = session.getContextUsage()
    if (!usage || typeof usage.contextWindow !== 'number' || usage.contextWindow <= 0) {
      return {}
    }
    return {
      contextTokens: usage.tokens,
      contextWindow: usage.contextWindow,
      contextPercent: usage.percent
    }
  } catch {
    return {}
  }
}

function emitContextUsage(
  emit: (event: AgentEvent) => void,
  runId: string,
  tabId: string | undefined,
  session: AgentSession
): void {
  const context = readHostedSessionContextUsage(session)
  if (context.contextWindow == null) return
  emit({
    type: 'usage',
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    ...context,
    runId,
    tabId
  })
}

function emitRunUsageDelta(
  emit: (event: AgentEvent) => void,
  runId: string,
  tabId: string | undefined,
  before: { input: number; output: number; cacheRead: number; cacheWrite: number },
  session: AgentSession
): void {
  const delta = diffSessionTokenUsage(before, readHostedSessionTokenUsage(session))
  const context = readHostedSessionContextUsage(session)
  emit({
    type: 'usage',
    input: delta.input,
    output: delta.output,
    cacheRead: delta.cacheRead,
    cacheWrite: delta.cacheWrite,
    ...context,
    runId,
    tabId
  })
}
