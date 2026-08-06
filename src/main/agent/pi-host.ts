import { homedir } from 'os'
import { resolve } from 'path'

import { buildLocalInstructionContext } from './instruction-files'
import {
  extractAssistantTextFromMessages,
  mapPiSessionEventToAgentEvents
} from './pi-event-bridge'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { getCrescentPiAgentDir, getCrescentPiSkillsDir } from './pi-paths'
import { resolvePiModel, syncCrescentProvidersToModelRuntime } from './pi-model-runtime'
import { loadPiCodingAgent, type PiCodingAgentModule } from './pi-sdk'
import type { AgentConfig, AgentEvent } from './types'

type AgentSession = Awaited<ReturnType<PiCodingAgentModule['createAgentSession']>>['session']

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  unsubscribe?: () => void
}

interface ActiveRun {
  runId: string
  sessionKey: string
  abortRequested: boolean
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
  activeRuns.set(runId, { runId, sessionKey, abortRequested: false })
  runIdBySessionKey.set(sessionKey, runId)

  try {
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

    emit({
      type: 'status',
      message: `Using ${model.provider}/${model.id} in ${hosted.cwd}`,
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
  const hosted = hostedSessions.get(active.sessionKey)
  if (hosted) {
    await hosted.session.abort()
  }
  return true
}

export async function steerPiAgentRun(runId: string, text: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  const hosted = hostedSessions.get(active.sessionKey)
  if (!hosted) return false
  await hosted.session.steer(text)
  return true
}

export function disposePiSession(sessionKey: string): void {
  const hosted = hostedSessions.get(sessionKey)
  if (!hosted) return
  hosted.unsubscribe?.()
  hosted.session.dispose()
  hostedSessions.delete(sessionKey)
}

export function disposeAllPiSessions(): void {
  for (const key of [...hostedSessions.keys()]) {
    disposePiSession(key)
  }
}

async function ensureHostedSession(
  sessionKey: string,
  config: AgentConfig
): Promise<HostedSession> {
  const cwd = resolveAgentWorkspaceCwd(config)
  const existing = hostedSessions.get(sessionKey)
  if (existing && existing.cwd === cwd) {
    return existing
  }
  if (existing) {
    disposePiSession(sessionKey)
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
        'Use the built-in tools (read, write, edit, bash) against the workspace cwd.',
        'Do not assume access to SSH session terminals; the user manages those panes manually.',
        instructionContext ? `\n# Local instructions\n${instructionContext}` : ''
      ]
        .filter(Boolean)
        .join('\n')
  })
  await resourceLoader.reload()

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model,
    thinkingLevel: 'off',
    modelRuntime,
    resourceLoader,
    tools: [...DEFAULT_TOOLS],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const hosted: HostedSession = { sessionKey, session, cwd }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

function buildPromptText(input: PiHostRunInput): string {
  const parts = [input.input.trim()]
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
