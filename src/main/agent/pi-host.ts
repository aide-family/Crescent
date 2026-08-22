import { homedir } from 'os'
import { resolve } from 'path'

import type { WebContents } from 'electron'

import { buildLocalInstructionContext } from './instruction-files'
import { extractAssistantTextFromMessages, mapPiSessionEventToAgentEvents } from './pi-event-bridge'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { getCrescentPiExtensionsDir, getCrescentPiSkillsDir } from './pi-paths'
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
  createPtyBashToolDefinition,
  interruptPtyCommandsForRun,
  settlePtyInterruptsBeforeSessionAbort,
  setPtyBashExecContext
} from './pi-terminal-bash'
import {
  createOpenSubterminalToolDefinition,
  OPEN_SUBTERMINAL_DISCIPLINE
} from './pi-open-subterminal'
import { CREATE_CAPTURE_DISCIPLINE, createCaptureToolDefinitions } from './pi-create-capture'
import {
  hostedSessionToolProfile,
  needsModelChange,
  shouldReuseHostedSession
} from './pi-host-policy'
import { rejectPendingApprovalsForRun } from './command-approval'
import {
  computeExtensionFingerprint,
  getExtensionLoadSnapshot,
  listEnabledExtensionPaths,
  rememberExtensionLoadSnapshot,
  snapshotFromLoadedExtensions
} from './extensions'
import {
  computePiPackageFingerprint,
  createCrescentSettingsManager,
  listEnabledPiPackageExtensionPaths
} from './pi-packages'
import {
  clearExtensionUiBinding,
  createCrescentExtensionUi,
  rejectPendingExtensionUiForRun,
  setExtensionUiBinding
} from './pi-extension-ui'
import {
  buildQuotaResetHint,
  classifyProviderError,
  isQuotaExhaustedError
} from '../../shared/provider-error'
import { buildPromptText } from '../../shared/agent-run-prompt'
import { buildInvariantAgentPrompt } from '../../shared/agent-prompt-discipline'
import { normalizeAgentStyle, type AgentStyle } from '../../shared/agent-style'
import { diffSessionTokenUsage, snapshotSessionTokenUsage } from '../../shared/session-token-usage'
import type { AgentConfig, AgentEvent } from './types'
import type { SkillPromptPart, SopWikiPromptPart } from '../../shared/agent-run-prompt'

type AgentSession = Awaited<ReturnType<PiSdkFacade['createAgentSession']>>['session']
type LoadExtensionsResult = Awaited<
  ReturnType<PiSdkFacade['createAgentSession']>
>['extensionsResult']

interface HostedExtensionCommand {
  invocationName: string
  description?: string
  handler: (args: string, ctx: unknown) => Promise<void> | void
}

interface HostedExtensionRunner {
  getCommand(name: string): HostedExtensionCommand | undefined
  createCommandContext(): unknown
  getRegisteredCommands(): Array<{ invocationName: string; description?: string }>
}

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  toolProfile: string
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
  let usageBaseline: { input: number; output: number } | undefined
  let usageSession: AgentSession | undefined

  try {
    if (!input.executionTabId?.trim()) {
      return {
        ok: false,
        error: 'Missing execution terminal tab. Open a terminal pane before running the agent.'
      }
    }

    setExtensionUiBinding(sessionKey, {
      webContents: input.webContents,
      runId,
      tabId: input.tabId,
      emit
    })
    const hosted = await ensureHostedSession(sessionKey, input.config)
    emitExtensionLoadErrors(emit, runId, input.tabId)
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

      if (event.type === 'turn_end' || event.type === 'message_end') {
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
    try {
      if (usageBaseline && usageSession) {
        emitRunUsageDelta(emit, runId, input.tabId, usageBaseline, usageSession)
      }
    } catch {
      // Usage is best-effort; never block run teardown.
    }
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
  rejectPendingExtensionUiForRun(runId, 'Agent run was canceled.')
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

export async function runPiExtensionCommand(input: {
  sessionKey: string
  name: string
  args?: string
  config: AgentConfig
  webContents: WebContents
  tabId?: string
}): Promise<{ ok: boolean; busy?: boolean; error?: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Extension command name is empty.' }
  if (runIdBySessionKey.has(input.sessionKey)) {
    return { ok: false, busy: true, error: 'Wait for the current agent run to finish.' }
  }

  setExtensionUiBinding(input.sessionKey, {
    webContents: input.webContents,
    tabId: input.tabId
  })
  const hosted = await ensureHostedSession(input.sessionKey, input.config)
  if (hosted.session.isStreaming) {
    return { ok: false, busy: true, error: 'Wait for the current agent run to finish.' }
  }

  const runner = getHostedExtensionRunner(hosted.session)
  const command = runner?.getCommand(name)
  if (!command || !runner) return { ok: false, error: `Unknown extension command: ${name}` }

  try {
    await command.handler(input.args?.trim() ?? '', runner.createCommandContext())
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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
  try {
    return Boolean(hosted.session.isStreaming)
  } catch {
    return false
  }
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

  for (const sessionKey of toDispose) {
    const hosted = hostedSessions.get(sessionKey)
    if (!hosted) continue
    await disposeHostedSession(hosted)
    hostedSessions.delete(sessionKey)
  }

  const warmupKey = input.sessionKey?.trim()
  if (warmupKey && !busySessionKeys.includes(warmupKey)) {
    await ensureHostedSession(warmupKey, input.config)
  }

  return {
    ok: true,
    reloaded: toDispose.length,
    skippedBusy: busySessionKeys.length,
    busySessionKeys
  }
}

export function listHostedExtensionCommands(
  sessionKey: string
): Array<{ name: string; description: string }> {
  const hosted = hostedSessions.get(sessionKey)
  if (!hosted) return []
  const runner = getHostedExtensionRunner(hosted.session)
  return (runner?.getRegisteredCommands() ?? []).map((command) => ({
    name: command.invocationName,
    description: command.description?.trim() || command.invocationName
  }))
}

async function ensureHostedSession(
  sessionKey: string,
  config: AgentConfig
): Promise<HostedSession> {
  const existing = hostedSessions.get(sessionKey)
  const cwd = resolveAgentWorkspaceCwd(config)
  const extensionFingerprint = computeExtensionFingerprint({
    disabledExtensions: config.disabledExtensions,
    packageFingerprint: computePiPackageFingerprint()
  })
  const toolProfile = hostedSessionToolProfile(config.mcpServers, extensionFingerprint)
  if (shouldReuseHostedSession(existing, { cwd, toolProfile })) {
    return existing as HostedSession
  }
  if (existing) {
    await disposeHostedSession(existing)
    hostedSessions.delete(sessionKey)
  }

  const pi = await loadPiSdk()
  const { settingsManager, agentDir } = await createCrescentSettingsManager(cwd)
  const modelRuntime = await syncCrescentProvidersToModelRuntime(config)
  const model = await resolvePiModel(config, modelRuntime)

  const instructionContext = buildLocalInstructionContext()
  const additionalSkillPaths = collectSkillRoots(config)
  const additionalExtensionPaths = [
    ...listEnabledExtensionPaths({
      disabledExtensions: config.disabledExtensions
    }),
    ...(await listEnabledPiPackageExtensionPaths({
      cwd,
      disabledExtensions: config.disabledExtensions
    }))
  ]
  const ptyBashTool = createPtyBashToolDefinition(pi, cwd, sessionKey)

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths,
    additionalExtensionPaths,
    noExtensions: true,
    systemPromptOverride: (base) =>
      buildInvariantAgentPrompt({
        base: base ?? '',
        instructionContext,
        openSubterminalDiscipline: OPEN_SUBTERMINAL_DISCIPLINE,
        createCaptureDiscipline: CREATE_CAPTURE_DISCIPLINE
      })
  })
  await resourceLoader.reload()

  const openSubterminalTool = await createOpenSubterminalToolDefinition(pi, sessionKey)
  const captureTools = await createCaptureToolDefinitions(pi, sessionKey)
  const mcp = await loadMcpPiTools(pi, config.mcpServers)

  const { session, extensionsResult } = await pi.createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: resolveThinkingLevelForModel(model ?? undefined),
    modelRuntime,
    resourceLoader,
    customTools: [
      ptyBashTool as never,
      openSubterminalTool as never,
      ...(captureTools as never[]),
      ...(mcp.tools as never[])
    ],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  rememberLoadedExtensions(extensionsResult)

  await session.bindExtensions({
    uiContext: createCrescentExtensionUi(sessionKey),
    mode: 'rpc',
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }),
      reload: () => session.reload()
    },
    onError: (error) => {
      rememberLoadedExtensions({
        extensions: extensionsResult.extensions,
        errors: [...extensionsResult.errors, { path: error.extensionPath, error: error.error }],
        runtime: extensionsResult.runtime
      })
    }
  })

  const hosted: HostedSession = {
    sessionKey,
    session,
    cwd,
    toolProfile,
    closeMcp: mcp.close
  }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

async function disposeHostedSession(hosted: HostedSession): Promise<void> {
  clearExtensionUiBinding(hosted.sessionKey)
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

function rememberLoadedExtensions(result: LoadExtensionsResult): void {
  rememberExtensionLoadSnapshot(
    snapshotFromLoadedExtensions({
      extensions: result.extensions,
      errors: result.errors,
      extensionsDir: getCrescentPiExtensionsDir()
    })
  )
}

function emitExtensionLoadErrors(
  emit: (event: AgentEvent) => void,
  runId: string,
  tabId?: string
): void {
  const errors = Object.entries(getExtensionLoadSnapshot().errorsById)
  if (errors.length === 0) return
  const message = errors.map(([id, error]) => `${id}: ${error}`).join('\n')
  emit({
    type: 'status',
    message: `Extension load errors:\n${message}`,
    runId,
    tabId
  })
}

function getHostedExtensionRunner(session: AgentSession): HostedExtensionRunner | undefined {
  const runner = (session as unknown as { _extensionRunner?: HostedExtensionRunner })
    ._extensionRunner
  return runner
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

function readHostedSessionTokenUsage(session: AgentSession): { input: number; output: number } {
  try {
    return snapshotSessionTokenUsage(session.getSessionStats())
  } catch {
    return snapshotSessionTokenUsage(undefined)
  }
}

function emitRunUsageDelta(
  emit: (event: AgentEvent) => void,
  runId: string,
  tabId: string | undefined,
  before: { input: number; output: number },
  session: AgentSession
): void {
  const delta = diffSessionTokenUsage(before, readHostedSessionTokenUsage(session))
  emit({
    type: 'usage',
    input: delta.input,
    output: delta.output,
    runId,
    tabId
  })
}
