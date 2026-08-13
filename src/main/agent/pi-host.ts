import { homedir } from 'os'
import { resolve } from 'path'

import type { WebContents } from 'electron'

import { buildLocalInstructionContext } from './instruction-files'
import { extractAssistantTextFromMessages, mapPiSessionEventToAgentEvents } from './pi-event-bridge'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { getCrescentPiAgentDir, getCrescentPiSkillsDir } from './pi-paths'
import {
  resolvePiModel,
  resolveThinkingLevelForModel,
  syncCrescentProvidersToModelRuntime
} from './pi-model-runtime'
import { loadPiCodingAgent, type PiCodingAgentModule } from './pi-sdk'
import {
  clearPtyBashExecContext,
  createPtyBashToolDefinition,
  interruptPtyCommandsForRun,
  settlePtyInterruptsBeforeSessionAbort,
  setPtyBashExecContext
} from './pi-terminal-bash'
import {
  createOpenSubterminalToolDefinition,
  OPEN_SUBTERMINAL_DISCIPLINE
} from './pi-open-subterminal'
import {
  HOSTED_SESSION_TOOL_PROFILE,
  needsModelChange,
  shouldReuseHostedSession
} from './pi-host-policy'
import { rejectPendingApprovalsForRun } from './command-approval'
import {
  buildQuotaResetHint,
  classifyProviderError,
  isQuotaExhaustedError
} from '../../shared/provider-error'
import { buildPromptText } from '../../shared/agent-run-prompt'
import { buildInvariantAgentPrompt } from '../../shared/agent-prompt-discipline'
import { normalizeAgentStyle, type AgentStyle } from '../../shared/agent-style'
import type { AgentConfig, AgentEvent } from './types'
import type { SkillPromptPart, SopWikiPromptPart } from '../../shared/agent-run-prompt'

type AgentSession = Awaited<ReturnType<PiCodingAgentModule['createAgentSession']>>['session']

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const
/** Pi `tools` is an allowlist — custom tools must be listed here to be model-callable. */
const ACTIVE_TOOLS = [...DEFAULT_TOOLS, 'open_subterminal'] as const

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  toolProfile: string
  unsubscribe?: () => void
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

export interface PiHostRunInput {
  runId: string
  sessionKey: string
  input: string
  config: AgentConfig
  tabId?: string
  conversationContext?: string
  webContents: WebContents
  executionTabId: string
  terminalContext?: string
  locale?: string
  agentStyle?: AgentStyle
  activeWikiDocs?: SopWikiPromptPart[]
  activeSkillDocs?: SkillPromptPart[]
  emit: (event: AgentEvent) => void
}

export interface PiHostRunResult {
  ok: boolean
  text?: string
  error?: string
  canceled?: boolean
}

export async function runPiAgent(input: PiHostRunInput): Promise<PiHostRunResult> {
  const { runId, sessionKey, emit } = input
  const abortController = new AbortController()
  activeRuns.set(runId, { runId, sessionKey, abortRequested: false, abortController })
  runIdBySessionKey.set(sessionKey, runId)

  try {
    if (!input.executionTabId?.trim()) {
      return {
        ok: false,
        error: 'Missing execution terminal tab. Open a terminal pane before running the agent.'
      }
    }

    const hosted = await ensureHostedSession(sessionKey, input.config)
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

    setPtyBashExecContext(sessionKey, {
      webContents: input.webContents,
      executionTabId: input.executionTabId.trim(),
      chatTabId: input.tabId,
      runId,
      userInput: input.input,
      terminalContext: input.terminalContext,
      locale: input.locale,
      config: input.config,
      emit,
      signal: abortController.signal
    })

    emit({
      type: 'status',
      message: `Using ${model.provider}/${model.id}; bash runs in the visible terminal pane.`,
      runId,
      tabId: input.tabId
    })

    let collectedText = ''
    let lastRetryError = ''
    let quotaExceeded:
      | {
          provider?: string
          resetHint: string
          retryAfterMs?: number
        }
      | undefined
    const bridgeLocale = input.locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    hosted.unsubscribe?.()
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
    })

    const promptText = buildPromptText({
      ...input,
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

    const messages = hosted.session.messages as unknown[]
    const finalText = extractAssistantTextFromMessages(messages).trim() || collectedText.trim()

    if (!finalText && lastRetryError) {
      const classified = classifyProviderError(lastRetryError)
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
        message: lastRetryError,
        kind:
          classified.kind === 'rate_limit' || classified.kind === 'transient'
            ? 'transient'
            : 'other',
        provider: classified.provider,
        retryAfterMs: classified.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: lastRetryError }
    }

    const text = finalText || 'Done.'
    emit({ type: 'done', message: text, runId, tabId: input.tabId })
    return { ok: true, text }
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
    clearPtyBashExecContext(sessionKey)
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

async function ensureHostedSession(
  sessionKey: string,
  config: AgentConfig
): Promise<HostedSession> {
  const existing = hostedSessions.get(sessionKey)
  const cwd = resolveAgentWorkspaceCwd(config)
  if (shouldReuseHostedSession(existing, cwd)) {
    return existing as HostedSession
  }
  if (existing) {
    try {
      existing.unsubscribe?.()
      existing.session.dispose()
    } catch {
      // ignore dispose errors when recreating for tool profile upgrades
    }
    hostedSessions.delete(sessionKey)
  }

  const pi = await loadPiCodingAgent()
  const agentDir = getCrescentPiAgentDir()
  const modelRuntime = await syncCrescentProvidersToModelRuntime(config)
  const model = await resolvePiModel(config, modelRuntime)

  const settingsManager = pi.SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 }
  })

  const instructionContext = buildLocalInstructionContext()
  const additionalSkillPaths = collectSkillRoots(config.skillRoot)
  const ptyBashTool = createPtyBashToolDefinition(pi, cwd, sessionKey)

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths,
    systemPromptOverride: (base) =>
      buildInvariantAgentPrompt({
        base: base ?? '',
        instructionContext,
        openSubterminalDiscipline: OPEN_SUBTERMINAL_DISCIPLINE
      })
  })
  await resourceLoader.reload()

  const openSubterminalTool = await createOpenSubterminalToolDefinition(pi, sessionKey)

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: resolveThinkingLevelForModel(model ?? undefined),
    modelRuntime,
    resourceLoader,
    tools: [...ACTIVE_TOOLS],
    customTools: [ptyBashTool as never, openSubterminalTool as never],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const hosted: HostedSession = {
    sessionKey,
    session,
    cwd,
    toolProfile: HOSTED_SESSION_TOOL_PROFILE
  }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

function collectSkillRoots(skillRoot: string): string[] {
  const roots = [getCrescentPiSkillsDir()]
  const configured = skillRoot?.trim()
  if (configured) {
    roots.push(resolve(configured.replace(/^~(?=$|[/\\])/, homedir())))
  }
  return [...new Set(roots)]
}
