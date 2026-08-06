import { homedir } from 'os'
import { resolve } from 'path'

import type { WebContents } from 'electron'

import { buildLocalInstructionContext } from './instruction-files'
import {
  extractAssistantTextFromMessages,
  mapPiSessionEventToAgentEvents
} from './pi-event-bridge'
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
  setPtyBashExecContext
} from './pi-terminal-bash'
import { rejectPendingApprovalsForRun } from './command-approval'
import type { AgentConfig, AgentEvent } from './types'

type AgentSession = Awaited<ReturnType<PiCodingAgentModule['createAgentSession']>>['session']

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  toolProfile: string
  unsubscribe?: () => void
}

const TOOL_PROFILE = 'pty-bash-v1'

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
        error:
          'No model available. Add an OpenAI-compatible provider with an API key in Settings.'
      }
    }

    if (hosted.session.model?.id !== model.id || hosted.session.model?.provider !== model.provider) {
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
    hosted.unsubscribe?.()
    hosted.unsubscribe = hosted.session.subscribe((event) => {
      for (const agentEvent of mapPiSessionEventToAgentEvents(event, {
        runId,
        tabId: input.tabId
      })) {
        if (agentEvent.type === 'token') {
          collectedText += agentEvent.text
        }
        emit(agentEvent)
      }
    })

    const promptText = buildPromptText(input)
    await hosted.session.prompt(promptText)

    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.', text: collectedText.trim() }
    }

    const messages = hosted.session.messages as unknown[]
    const finalText =
      extractAssistantTextFromMessages(messages).trim() || collectedText.trim() || 'Done.'

    emit({ type: 'done', message: finalText, runId, tabId: input.tabId })
    return { ok: true, text: finalText }
  } catch (error) {
    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.' }
    }
    const message = error instanceof Error ? error.message : String(error)
    emit({ type: 'error', message, runId, tabId: input.tabId })
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
  active.abortController.abort()
  rejectPendingApprovalsForRun(runId, 'Agent run was canceled.')
  const hosted = hostedSessions.get(active.sessionKey)
  try {
    await hosted?.session.abort()
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

async function ensureHostedSession(sessionKey: string, config: AgentConfig): Promise<HostedSession> {
  const existing = hostedSessions.get(sessionKey)
  const cwd = resolveAgentWorkspaceCwd(config)
  if (existing) {
    if (existing.toolProfile === TOOL_PROFILE && existing.cwd === cwd) {
      return existing
    }
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
      [
        base,
        '',
        'You are Crescent, an Electron-hosted coding agent powered by Pi.',
        'File tools (read, write, edit) operate on the agent workspace cwd.',
        'The bash tool executes in the user\'s visible terminal pane (main terminal or a docked subterminal).',
        'Commands are pasted into the terminal so the user can see them; high-risk commands require in-chat approval before execution.',
        'Prefer bash for cluster/host inspection when the user is already in the target environment.',
        instructionContext ? `\n# Local instructions\n${instructionContext}` : ''
      ]
        .filter(Boolean)
        .join('\n')
  })
  await resourceLoader.reload()

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: resolveThinkingLevelForModel(model ?? undefined),
    modelRuntime,
    resourceLoader,
    tools: [...DEFAULT_TOOLS],
    customTools: [ptyBashTool as never],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const hosted: HostedSession = { sessionKey, session, cwd, toolProfile: TOOL_PROFILE }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

function buildPromptText(input: PiHostRunInput): string {
  const parts = [input.input.trim()]
  if (input.terminalContext?.trim()) {
    parts.unshift(`# Current terminal context\n${input.terminalContext.trim()}\n`)
  }
  if (input.conversationContext?.trim()) {
    parts.unshift(`# Recent conversation\n${input.conversationContext.trim()}\n`)
  }
  return parts.join('\n')
}

function collectSkillRoots(skillRoot: string): string[] {
  const roots = [getCrescentPiSkillsDir()]
  const configured = skillRoot?.trim()
  if (configured) {
    roots.push(resolve(configured.replace(/^~(?=$|[/\\])/, homedir())))
  }
  return [...new Set(roots)]
}
