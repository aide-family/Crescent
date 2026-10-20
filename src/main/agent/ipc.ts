import { grantLocalDocumentPath } from '../local-document-ipc'
import { getPtyBashExecContext, returnToMainTerminal } from './pi-terminal-bash'
import { readTerminalExecutionTarget } from '../terminal/ipc'
import { normalizeApprovalPolicy, normalizeMutationPolicy } from '../../shared/approval-policy'
import { promises as fs } from 'fs'
import {
  importOpenApiDocument,
  savePastedAttachment,
  requestMicrophonePermission,
  transcribeAudioAttachment,
  saveRenderedImage,
  saveSvgAsPng,
  pickSavePath,
  writeDataUrlFile
} from './artifacts'
import { publicAgentConfig, mergeAgentSecrets } from '../renderer-secrets'
import { rendererIpc } from '../ipc-security'
import { normalizeExecutionMode } from '../../shared/execution-plan'
import { revisePendingPlan, resolvePlanApproval, stopPlansForTab } from './change-plan'
import { basename, resolve } from 'path'

import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron'

import { listEditableInstructionFiles, saveEditableInstructionFile } from './instruction-files'
import { AgentMemory } from './memory'
import { AgentBrain } from './brain'
import { checkTranscriptionSupport } from './transcription-support'
import {
  buildLocalOnlyConnectionIntentResult,
  CONNECTION_INTENT_SYSTEM_PROMPT,
  parseConnectionIntentResponse,
  summarizeConnectionForAi
} from './connection-intent'
import {
  deleteAgentSkill,
  importAgentSkillsFromPath,
  installAgentSkill,
  listAgentSkills,
  readAgentSkillContent,
  searchAgentSkills,
  startAgentSkillInstall,
  readCatalogSkillContent
} from './skills'
import { generateAndSaveSop } from './generate-sop'
import {
  commitCaptureDraft,
  generateCaptureDraft,
  normalizeCaptureTimeoutMs
} from './generate-capture'
import {
  cancelPiAgentRun,
  generateHandoffForHostedSession,
  getHostedHandoffStatus,
  cancelHostedHandoff,
  compactHostedSession,
  reloadCrescentRuntime,
  runPiAgent,
  steerPiAgentRun
} from './pi-host'
import {
  listPiAvailableModels,
  resolvePiModel,
  syncCrescentProvidersToModelRuntime
} from './pi-model-runtime'
import { validHandoffInput, validHandoffSession, validHandoffRequestId } from '../../shared/handoff'
import type { AgentCancelHandoffInput } from '../../shared/agent-types'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { BUILT_IN_TOOL_CATALOG } from '../../shared/agent-tool-catalog'
import { listMcpToolCatalog } from './pi-mcp-tools'
import { normalizeAgentStyle } from '../../shared/agent-style'
import { rejectPendingApprovalsForTab, resolveCommandApprovalDecision } from './command-approval'
import { resolveAgentSubterminalReady } from './pi-open-subterminal'
import { safeWebContentsSend } from '../safe-ipc-send'
import {
  getWikiDocument,
  deleteWikiDocument,
  getActiveWikiDirectory,
  listWikiDocuments,
  saveWikiDocument,
  searchWikiDocuments
} from './wiki'
import {
  appendOperationRecord,
  readAgentConfig,
  readCrescentMemory,
  readCustomConnections,
  readWikiDirectory,
  writeAgentConfig,
  writeCrescentMemory,
  writeWikiDirectory,
  normalizeAgentConfig
} from '../crescent-store'
import { loadSshConfigConnections } from '../connections/ssh-config'
import { getCrescentWikiDir } from '../crescent-paths'
import { setSystemLogLevel } from '../logging'
import { traceStartup } from '../startup-trace'
import type {
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentGenerateSopInput,
  AgentGenerateCaptureDraftInput,
  AgentCommitCaptureDraftInput,
  AgentPathReference,
  AgentRunInput,
  AgentCompactInput,
  CommandApprovalDecision,
  PastedAttachmentInput,
  TranscribeAudioInput,
  TranscriptionSupportResult,
  WikiSaveInput
} from './types'

const activeSkillInstalls = new Map<string, { cancel: () => void }>()
const MAX_COMPACT_INSTRUCTIONS = 2_000

export function registerAgentIpc(): void {
  rendererIpc.handle('agent:revise-plan', (event, value: unknown) =>
    revisePendingPlan(event.sender.id, value)
  )
  rendererIpc.handle(
    'agent:execution-target',
    (event, payload?: { sessionKey?: string; tabId?: string }) => {
      if (typeof payload?.sessionKey !== 'string' || typeof payload.tabId !== 'string')
        throw new Error('Invalid target request')
      const context = getPtyBashExecContext(payload.sessionKey)
      const tabId =
        context?.webContents.id === event.sender.id ? context.executionTabId : payload.tabId
      return readTerminalExecutionTarget(event.sender.id, tabId)
    }
  )
  rendererIpc.handle('agent:return-to-main', (event, sessionKey: unknown) => {
    if (
      typeof sessionKey !== 'string' ||
      getPtyBashExecContext(sessionKey)?.webContents.id !== event.sender.id
    )
      return { ok: false, error: 'No owned execution scope' }
    return returnToMainTerminal(sessionKey)
  })
  rendererIpc.handle('agent:get-config', () => {
    const start = traceStartup('ipc:agent:get-config')
    const config = readAgentConfig()
    traceStartup('ipc:agent:get-config:done', start)
    return publicAgentConfig(config)
  })

  rendererIpc.handle('agent:get-models', async () => {
    const start = traceStartup('ipc:agent:get-models')
    const models = await listPiAvailableModels(readAgentConfig())
    traceStartup('ipc:agent:get-models:done', start)
    return models
  })

  rendererIpc.handle('agent:list-skills', () => {
    const config = readAgentConfig()
    return listAgentSkills(config.skillRoot, {
      loadGlobalAgentSkills: Boolean(config.loadGlobalAgentSkills)
    })
  })

  rendererIpc.handle('agent:search-skills', (_, query: string) => {
    return searchAgentSkills(query ?? '')
  })

  rendererIpc.handle(
    'agent:install-skill',
    (_, payload: { installSource?: string; installSkill?: string }) => {
      return installAgentSkill({
        installSource: payload?.installSource ?? '',
        installSkill: payload?.installSkill ?? '',
        skillRoot: readAgentConfig().skillRoot
      })
    }
  )

  rendererIpc.handle(
    'agent:start-skill-install',
    (event, payload: { installSource?: string; installSkill?: string }) => {
      const installId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const webContents = event.sender
      const session = startAgentSkillInstall(
        {
          installSource: payload?.installSource ?? '',
          installSkill: payload?.installSkill ?? '',
          skillRoot: readAgentConfig().skillRoot
        },
        (data) => {
          safeWebContentsSend(webContents, 'agent:skill-install-event', {
            installId,
            type: 'log',
            data
          })
        }
      )

      activeSkillInstalls.set(installId, { cancel: session.cancel })
      session.promise
        .then((result) => {
          safeWebContentsSend(webContents, 'agent:skill-install-event', {
            installId,
            type: 'done',
            result
          })
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          safeWebContentsSend(webContents, 'agent:skill-install-event', {
            installId,
            type: 'error',
            error: message,
            canceled: /canceled/i.test(message)
          })
        })
        .finally(() => {
          activeSkillInstalls.delete(installId)
        })

      return { ok: true, installId }
    }
  )

  rendererIpc.handle('agent:cancel-skill-install', (_, installId: string) => {
    const session = activeSkillInstalls.get(installId)
    if (!session) return { ok: false }

    session.cancel()
    return { ok: true }
  })

  rendererIpc.handle(
    'agent:import-skill',
    (event, payload?: { sourcePath?: string; overwrite?: boolean }) => {
      return importAgentSkillsFromDialog(event.sender, payload)
    }
  )

  rendererIpc.handle('agent:delete-skill', (_, path: string) => {
    const config = readAgentConfig()
    return deleteAgentSkill(path ?? '', config.skillRoot, {
      loadGlobalAgentSkills: Boolean(config.loadGlobalAgentSkills)
    })
  })

  rendererIpc.handle('agent:get-skill-content', (_, path: string) => {
    const config = readAgentConfig()
    return readAgentSkillContent(path ?? '', config.skillRoot, {
      loadGlobalAgentSkills: Boolean(config.loadGlobalAgentSkills)
    })
  })

  rendererIpc.handle(
    'agent:get-catalog-skill-content',
    (_, payload: { installSource?: string; installSkill?: string; name?: string }) => {
      return readCatalogSkillContent(
        {
          installSource: typeof payload?.installSource === 'string' ? payload.installSource : '',
          installSkill: typeof payload?.installSkill === 'string' ? payload.installSkill : '',
          name: typeof payload?.name === 'string' ? payload.name : ''
        },
        readAgentConfig().skillRoot
      )
    }
  )

  rendererIpc.handle('agent:generate-sop', async (_, payload: AgentGenerateSopInput) => {
    return generateAndSaveSop(
      {
        summary: payload?.summary ?? '',
        locale: payload?.locale,
        fallbackTitle: payload?.fallbackTitle,
        fallbackContent: payload?.fallbackContent,
        draft: payload?.draft,
        notes: payload?.notes
      },
      { config: readAgentConfig() }
    )
  })

  rendererIpc.handle('agent:reload-runtime', async (event, payload?: { sessionKey?: string }) => {
    const sessionKey = typeof payload?.sessionKey === 'string' ? payload.sessionKey.trim() : ''
    return reloadCrescentRuntime({
      ownerId: event.sender.id,
      sessionKey: sessionKey || undefined,
      config: readAgentConfig()
    })
  })

  rendererIpc.handle('agent:handoff-status', (event, payload: unknown) => {
    if (!validHandoffSession(payload)) return { available: false, error: 'invalid' }
    return getHostedHandoffStatus(payload, event.sender.id)
  })

  rendererIpc.handle('agent:generate-handoff', (event, payload: unknown) => {
    if (!validHandoffInput(payload)) return { ok: false, error: 'invalid' }
    return generateHandoffForHostedSession(payload, readAgentConfig(), event.sender)
  })

  rendererIpc.handle('agent:cancel-handoff', (event, payload: unknown) => {
    if (
      !validHandoffSession(payload) ||
      !validHandoffRequestId((payload as AgentCancelHandoffInput).requestId)
    )
      return { ok: false }
    return cancelHostedHandoff(payload as AgentCancelHandoffInput, event.sender.id)
  })

  rendererIpc.handle('agent:compact', async (event, payload?: AgentCompactInput) => {
    const sessionKey =
      (typeof payload?.sessionKey === 'string' ? payload.sessionKey.trim() : '') ||
      (typeof payload?.tabId === 'string' ? payload.tabId.trim() : '')
    if (!sessionKey) return { ok: false, error: 'Missing session.' }

    const rawInstructions = typeof payload?.instructions === 'string' ? payload.instructions : ''
    const instructions = rawInstructions.trim().slice(0, MAX_COMPACT_INSTRUCTIONS) || undefined
    const locale = typeof payload?.locale === 'string' ? payload.locale : undefined
    const tabId = typeof payload?.tabId === 'string' ? payload.tabId.trim() : sessionKey

    return compactHostedSession({
      ownerId: event.sender.id,
      sessionKey,
      tabId,
      instructions,
      locale,
      emit: (agentEvent) => {
        safeWebContentsSend(event.sender, 'agent:event', {
          ...agentEvent,
          tabId: agentEvent.tabId ?? tabId
        })
      }
    })
  })

  rendererIpc.handle(
    'agent:generate-capture-draft',
    async (_, payload: AgentGenerateCaptureDraftInput) => {
      const kind = payload?.kind === 'skill' ? 'skill' : 'sop'
      return generateCaptureDraft(
        {
          kind,
          summary: typeof payload?.summary === 'string' ? payload.summary : '',
          locale: typeof payload?.locale === 'string' ? payload.locale : undefined,
          draft: typeof payload?.draft === 'string' ? payload.draft : undefined,
          notes: typeof payload?.notes === 'string' ? payload.notes : undefined,
          timeoutMs: payload?.timeoutMs
        },
        {
          config: readAgentConfig(),
          timeoutMs: normalizeCaptureTimeoutMs(payload?.timeoutMs)
        }
      )
    }
  )

  rendererIpc.handle(
    'agent:commit-capture-draft',
    async (_, payload: AgentCommitCaptureDraftInput) => {
      const kind = payload?.kind === 'skill' ? 'skill' : 'sop'
      return commitCaptureDraft(
        {
          kind,
          title: typeof payload?.title === 'string' ? payload.title : '',
          content: typeof payload?.content === 'string' ? payload.content : '',
          skillName: typeof payload?.skillName === 'string' ? payload.skillName : undefined,
          overwrite: Boolean(payload?.overwrite)
        },
        { skillRoot: readAgentConfig().skillRoot }
      )
    }
  )

  rendererIpc.handle('agent:list-instruction-files', () => {
    return listEditableInstructionFiles()
  })

  rendererIpc.handle('agent:list-wiki-documents', () => {
    return listWikiDocuments()
  })

  rendererIpc.handle('agent:get-wiki-directory', () => ({
    path: getActiveWikiDirectory(),
    isDefault: !readWikiDirectory()
  }))

  rendererIpc.handle('agent:choose-wiki-directory', async (event) => {
    const currentDirectory = getActiveWikiDirectory()
    const options: OpenDialogOptions = {
      title: 'Choose knowledge base folder',
      defaultPath: currentDirectory,
      properties: ['openDirectory', 'createDirectory']
    }
    const browserWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const selection = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) {
      return {
        ok: false,
        canceled: true,
        directory: { path: currentDirectory, isDefault: !readWikiDirectory() }
      }
    }

    const directory = resolve(selection.filePaths[0])
    const stat = await fs.stat(directory)
    if (!stat.isDirectory()) throw new Error('The selected knowledge base path is not a folder.')
    writeWikiDirectory(directory)
    return { ok: true, directory: { path: directory, isDefault: false } }
  })

  rendererIpc.handle('agent:reset-wiki-directory', () => {
    writeWikiDirectory(undefined)
    return { path: getCrescentWikiDir(), isDefault: true }
  })

  rendererIpc.handle('agent:get-wiki-document', (_, id: string) => {
    return getWikiDocument(id ?? '')
  })

  rendererIpc.handle('agent:save-wiki-document', (_, input: WikiSaveInput) => {
    return saveWikiDocument(input)
  })

  rendererIpc.handle('agent:delete-wiki-document', (_, id: string) => {
    return deleteWikiDocument(id ?? '')
  })

  rendererIpc.handle('agent:search-wiki-documents', (_, query: string) => {
    return searchWikiDocuments(query ?? '', 12, 6000)
  })

  rendererIpc.handle(
    'agent:pick-path-reference',
    async (event, payload: { kind?: AgentPathReference['kind'] }) => {
      const kind = payload?.kind === 'directory' ? 'directory' : 'file'
      const selection = await pickAgentPathReference(event.sender, kind)
      if (selection) await grantLocalDocumentPath(event.sender, selection.path)
      return selection
    }
  )

  rendererIpc.handle('agent:import-openapi-document', async (event) => {
    return importOpenApiDocument(event.sender)
  })

  rendererIpc.handle(
    'agent:save-pasted-attachment',
    async (event, payload: PastedAttachmentInput) => {
      const attachment = await savePastedAttachment(payload)
      await grantLocalDocumentPath(event.sender, attachment.path)
      return attachment
    }
  )

  rendererIpc.handle('agent:request-microphone-permission', async () => {
    return requestMicrophonePermission()
  })

  rendererIpc.handle('agent:transcribe-audio', async (_, payload: TranscribeAudioInput) => {
    return transcribeAudioAttachment(payload)
  })

  rendererIpc.handle(
    'agent:check-transcription-support',
    async (
      _,
      payload?: { forceRefresh?: boolean; providerId?: string; model?: string }
    ): Promise<TranscriptionSupportResult> => {
      const config = normalizeAgentConfig({
        ...readAgentConfig(),
        ...(payload?.providerId ? { providerId: payload.providerId } : {}),
        ...(payload?.model ? { model: payload.model } : {})
      })
      return checkTranscriptionSupport(config, {
        forceRefresh: payload?.forceRefresh,
        providerId: payload?.providerId,
        model: payload?.model
      })
    }
  )

  rendererIpc.handle(
    'agent:save-rendered-image',
    async (event, payload: { dataUrl?: string; defaultPath?: string }) => {
      return saveRenderedImage(event.sender, payload)
    }
  )
  rendererIpc.handle(
    'agent:save-svg-as-png',
    async (
      event,
      payload: { svg?: string; defaultPath?: string; width?: number; height?: number }
    ) => {
      return saveSvgAsPng(event.sender, payload)
    }
  )
  rendererIpc.handle(
    'agent:pick-save-path',
    async (
      event,
      payload: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
    ) => {
      return pickSavePath(event.sender, payload)
    }
  )
  rendererIpc.handle(
    'agent:write-data-url-file',
    async (event, payload: { path?: string; dataUrl?: string }) => {
      return writeDataUrlFile(event.sender.id, payload)
    }
  )

  rendererIpc.handle(
    'agent:save-instruction-file',
    (_, payload: { name?: string; content?: string }) => {
      return saveEditableInstructionFile({
        name: payload?.name ?? '',
        content: payload?.content ?? ''
      })
    }
  )

  rendererIpc.handle('agent:save-config', (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig(mergeAgentSecrets(config, readAgentConfig()))

    const saved = writeAgentConfig(nextConfig)
    setSystemLogLevel(saved.logLevel ?? 'info')
    return publicAgentConfig(saved)
  })

  rendererIpc.handle('agent:validate-config', async (_, config: Partial<AgentConfig>) => {
    const start = traceStartup('ipc:agent:validate-config')
    const nextConfig = normalizeAgentConfig(mergeAgentSecrets(config, readAgentConfig()))

    try {
      await validateModel(nextConfig)
      const cwd = resolveAgentWorkspaceCwd(nextConfig)
      const mcpCatalog = await listMcpToolCatalog(nextConfig.mcpServers)
      const builtInTools = BUILT_IN_TOOL_CATALOG.map((tool) =>
        tool.name === 'bash'
          ? {
              ...tool,
              description: `Run a local bash command in ${cwd}.`
            }
          : tool
      )
      const tools = [...builtInTools, ...mcpCatalog.tools]
      traceStartup('ipc:agent:validate-config:done', start)
      return {
        ok: true,
        modelOk: true,
        toolCount: tools.length,
        tools,
        ...(Object.keys(mcpCatalog.errors).length ? { mcpErrors: mcpCatalog.errors } : {})
      }
    } catch (error) {
      traceStartup('ipc:agent:validate-config:failed', start)
      return {
        ok: false,
        modelOk: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  rendererIpc.handle('agent:cancel', async (event, runId: string) => {
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : ''
    if (!normalizedRunId) return { ok: false }
    const ok = await cancelPiAgentRun(normalizedRunId, event.sender.id)
    return { ok }
  })

  rendererIpc.handle('agent:reject-approvals-for-tab', (event, tabId: string) => {
    const normalized = typeof tabId === 'string' ? tabId.trim() : ''
    if (normalized) {
      stopPlansForTab(normalized, event.sender.id)
      rejectPendingApprovalsForTab(normalized, 'Session was closed.', event.sender.id)
    }
    return { ok: true }
  })

  rendererIpc.handle(
    'agent:supplement',
    async (event, payload: { runId?: string; input?: string }) => {
      const runId = payload?.runId?.trim()
      const input = payload?.input?.trim()
      if (!runId || !input) return { ok: false }
      const ok = await steerPiAgentRun(runId, input, event.sender.id)
      return { ok }
    }
  )

  rendererIpc.handle('agent:resolve-plan-approval', (event, decision: unknown) =>
    resolvePlanApproval(event.sender.id, decision)
  )

  rendererIpc.handle(
    'agent:resolve-command-approval',
    (event, decision: CommandApprovalDecision) => {
      return resolveCommandApprovalDecision(decision, event.sender.id)
    }
  )

  rendererIpc.handle(
    'agent:ack-subterminal-opened',
    (event, payload: { tabId?: string; ok?: boolean; error?: string }) => {
      return resolveAgentSubterminalReady(payload, event.sender.id)
    }
  )

  rendererIpc.handle('agent:generate-command', async () => {
    return {
      ok: false,
      error: 'Command generation was removed. Use the Pi coding agent chat instead.'
    }
  })

  rendererIpc.handle(
    'agent:resolve-connection-intent',
    async (_, payload: AgentConnectionIntentInput): Promise<AgentConnectionIntentResult> => {
      const input = payload?.input?.trim()
      if (!input) return { ok: false, error: 'Input is empty.' }
      const localOnlyIntent = buildLocalOnlyConnectionIntentResult(input)
      if (localOnlyIntent) return localOnlyIntent

      const connections = [...loadSshConfigConnections(), ...readCustomConnections()]
      if (connections.length === 0) return { ok: false, reason: 'No configured connections.' }

      try {
        const completion = await new AgentBrain(readAgentConfig()).chat({
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: CONNECTION_INTENT_SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  request: input,
                  conversationContext: payload.conversationContext ?? '',
                  currentConnectionId: payload.currentConnectionId ?? null,
                  currentConnectionName: payload.currentConnectionName ?? null,
                  terminalSummary: payload.terminalSummary ?? '',
                  connections: connections.map(summarizeConnectionForAi)
                },
                null,
                2
              )
            }
          ]
        })
        return parseConnectionIntentResponse(
          completion.choices[0]?.message.content ?? '',
          connections
        )
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  rendererIpc.handle('agent:run', async (event, payload: AgentRunInput) => {
    const input = payload?.input?.trim()
    const runId =
      payload?.runId?.trim() || `run-${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (!input) {
      return { ok: false, error: 'Input is empty.' }
    }

    if (input.startsWith('/remember ')) {
      const memory = createMemory()
      memory.addLongTermNote(input.slice('/remember '.length))
      safeWebContentsSend(event.sender, 'agent:event', {
        type: 'done',
        message: 'Saved to long-term memory.',
        runId,
        tabId: payload?.tabId
      })
      return { ok: true, text: 'Saved to long-term memory.' }
    }

    const agentConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      providerId: payload?.providerId,
      model: payload?.model
    })
    const sessionKey = payload?.tabId?.trim() || 'default'
    const executionTabId = payload?.executionTabId?.trim() || payload?.tabId?.trim() || ''
    const wikiIds = [
      ...new Set((payload?.activeWikiIds ?? []).map((id) => id.trim()).filter(Boolean))
    ]
    const activeWikiDocs = (await Promise.all(wikiIds.map((id) => getWikiDocument(id))))
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
      .map((doc) => ({ title: doc.title, content: doc.content }))

    const skillRoot = agentConfig.skillRoot
    const skillListOptions = {
      loadGlobalAgentSkills: Boolean(agentConfig.loadGlobalAgentSkills)
    }
    const skillPaths = [
      ...new Set((payload?.activeSkillPaths ?? []).map((path) => path.trim()).filter(Boolean))
    ]
    const skillCatalog = skillPaths.length ? listAgentSkills(skillRoot, skillListOptions) : []
    const activeSkillDocs = skillPaths.flatMap((skillPath) => {
      try {
        const content = readAgentSkillContent(skillPath, skillRoot, skillListOptions)
        const resolved = resolve(skillPath)
        const matched = skillCatalog.find((skill) => resolve(skill.path) === resolved)
        return [
          {
            name: matched?.name ?? skillPath.split('/').filter(Boolean).slice(-2, -1)[0] ?? 'Skill',
            path: matched?.path ?? skillPath,
            content
          }
        ]
      } catch {
        return []
      }
    })

    const result = await runPiAgent({
      runId,
      sessionKey,
      input,
      config: agentConfig,
      tabId: payload?.tabId,
      conversationContext: payload?.conversationContext,
      webContents: event.sender,
      executionTabId,
      executionConnectionId: payload?.executionConnectionId?.trim() || undefined,
      terminalContext: payload?.terminalContext,
      locale: payload?.locale,
      agentStyle: normalizeAgentStyle(payload?.agentStyle ?? agentConfig.agentStyle),
      executionMode: normalizeExecutionMode(payload?.executionMode),
      approvalPolicy: normalizeApprovalPolicy(payload?.approvalPolicy),
      mutationPolicy: normalizeMutationPolicy(payload?.mutationPolicy),
      activeWikiDocs,
      activeSkillDocs,
      emit: (agentEvent) => {
        safeWebContentsSend(event.sender, 'agent:event', {
          ...agentEvent,
          runId,
          tabId: agentEvent.tabId ?? payload?.tabId
        })
      }
    })

    appendOperationRecord({
      status: result.ok ? 'success' : 'error',
      summary: input,
      output: result.text || result.error
    })

    return result
  })
}

async function pickAgentPathReference(
  webContents: WebContents,
  kind: AgentPathReference['kind']
): Promise<AgentPathReference | undefined> {
  const options: OpenDialogOptions = {
    properties: [kind === 'directory' ? 'openDirectory' : 'openFile']
  }
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  if (selection.canceled || !selection.filePaths[0]) return undefined

  const path = resolve(selection.filePaths[0])

  return {
    id: `${kind}:${path}`,
    kind,
    path,
    name: basename(path) || path
  }
}

async function importAgentSkillsFromDialog(
  webContents: WebContents,
  payload?: { sourcePath?: string; overwrite?: boolean }
): Promise<ReturnType<typeof importAgentSkillsFromPath> | { ok: false; canceled: true }> {
  let sourcePath = typeof payload?.sourcePath === 'string' ? payload.sourcePath.trim() : ''
  if (!sourcePath) {
    const options: OpenDialogOptions = {
      title: 'Import skill',
      properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openDirectory'],
      filters: [
        { name: 'Skill markdown', extensions: ['md'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
    const selection = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options)

    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: false, canceled: true }
    }
    sourcePath = resolve(selection.filePaths[0])
  }

  try {
    return importAgentSkillsFromPath({
      sourcePath,
      skillRoot: readAgentConfig().skillRoot,
      overwrite: Boolean(payload?.overwrite)
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function createMemory(): AgentMemory {
  return new AgentMemory(readCrescentMemory(), (nextMemory) => {
    writeCrescentMemory(nextMemory)
  })
}

async function validateModel(config: AgentConfig): Promise<void> {
  const runtime = await syncCrescentProvidersToModelRuntime(config)
  const model = await resolvePiModel(config, runtime)
  if (!model) {
    throw new Error('No model configured. Add a provider and model in Settings.')
  }
  if (!config.model?.trim()) {
    throw new Error('Model is required.')
  }
}
