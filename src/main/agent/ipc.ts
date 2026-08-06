import { promises as fs } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, isAbsolute, resolve } from 'path'

import {
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  type OpenDialogOptions,
  type WebContents
} from 'electron'

import { generateTerminalCommand } from './command'
import { CommandAuditor } from './command-auditor'
import { matchCommandWhitelist } from './command-whitelist'
import { buildExternalToolApprovalCommand, buildExternalToolAudit } from './external-tool-approval'
import {
  buildLocalInstructionContext,
  listEditableInstructionFiles,
  saveEditableInstructionFile
} from './instruction-files'
import { AgentMemory } from './memory'
import { getAgentProviders } from './model-provider-config'
import { AgentBrain } from './brain'
import { checkTranscriptionSupport } from './transcription-support'
import { buildLocalOnlyConnectionIntentResult } from './connection-intent'
import { BUILT_IN_TOOL_CATALOG } from '../../shared/agent-tool-catalog'
import { parseJsonFromModelContent } from '../../shared/json-parse'
import { resolveOpsConnectionId } from '../../shared/local-connection'
import { resolveActiveOpenApiProfile } from '../../shared/openapi-profiles'
import {
  buildAgentSkillContext,
  deleteAgentSkill,
  installAgentSkill,
  listAgentSkills,
  readAgentSkillContent,
  searchAgentSkills,
  startAgentSkillInstall
} from './skills'
import { formatOpsHistoryContext } from './ops-history'
import { runTerminalAgent } from './runner'
import { loadOpenApiToolRegistry } from './tool-registry'
import { safeWebContentsSend } from '../safe-ipc-send'
import { loadMcpToolRegistry } from './mcp-runtime'
import {
  formatWikiContext,
  getWikiDocument,
  deleteWikiDocument,
  listWikiDocuments,
  saveWikiDocument,
  searchWikiDocuments
} from './wiki'
import {
  executeCommandInTemporaryTerminal,
  executeCommandInTerminal,
  executeCommandInTerminalWithPermissionRequest,
  interruptTemporarySubterminal,
  readTemporarySubterminalOutput
} from '../terminal/ipc'
import {
  appendOperationRecord,
  readAgentConfig,
  readCrescentMemory,
  readCustomConnections,
  writeAgentConfig,
  writeCrescentMemory,
  normalizeAgentConfig
} from '../crescent-store'
import { listOpsHistoryForConnection } from '../crescent-sqlite'
import { getCrescentAttachmentsDir } from '../crescent-paths'
import { loadSshConfigConnections } from '../connections/ssh-config'
import type {
  AgentCommandInput,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentPathReference,
  AgentRunInput,
  CommandApprovalDecision,
  CommandApprovalRequest,
  CommandAuditResult,
  ConnectionConfig,
  LocalFileWriter,
  LocalFileWriteResult,
  PastedAttachmentInput,
  TranscribeAudioInput,
  TranscribeAudioResult,
  TranscriptionSupportResult,
  WikiSaveInput
} from './types'

interface ActiveAgentRun {
  controller: AbortController
  supplements: string[]
  defaultTabId?: string
  sessionTerminalIds: Set<string>
  lastExecutionTabId?: string
}

const activeRuns = new Map<string, ActiveAgentRun>()
const activeSkillInstalls = new Map<string, { cancel: () => void }>()
const pendingCommandApprovals = new Map<
  string,
  {
    runId: string
    tabId?: string
    webContents: WebContents
    resolve: (decision: CommandApprovalDecisionResult) => void
    timeout: NodeJS.Timeout
  }
>()

interface CommandApprovalDecisionResult {
  approved: boolean
  note?: string
  rejectionReason?: string
}

function dismissCommandApprovalRequest(
  webContents: WebContents,
  requestId: string,
  runId: string
): void {
  safeWebContentsSend(webContents, 'agent:command-approval-dismiss', { requestId, runId })
}

function settlePendingCommandApproval(
  requestId: string,
  decision: CommandApprovalDecisionResult,
  options?: { dismiss?: boolean }
): boolean {
  const pending = pendingCommandApprovals.get(requestId)
  if (!pending) return false

  clearTimeout(pending.timeout)
  pendingCommandApprovals.delete(requestId)
  if (options?.dismiss !== false) {
    dismissCommandApprovalRequest(pending.webContents, requestId, pending.runId)
  }
  pending.resolve(decision)
  return true
}

function rejectPendingApprovalsForRun(
  runId: string,
  rejectionReason = 'Agent run was canceled.'
): void {
  for (const [requestId, pending] of [...pendingCommandApprovals.entries()]) {
    if (pending.runId !== runId) continue
    settlePendingCommandApproval(requestId, { approved: false, rejectionReason })
  }
}

function rejectPendingApprovalsForTab(
  tabId: string,
  rejectionReason = 'Session was closed.'
): void {
  for (const [requestId, pending] of [...pendingCommandApprovals.entries()]) {
    if (pending.tabId !== tabId) continue
    settlePendingCommandApproval(requestId, { approved: false, rejectionReason })
  }
}

function stripSkillContent<T extends { content?: unknown }>(skill: T): Omit<T, 'content'> {
  const next = { ...skill }
  delete next.content
  return next
}

export function registerAgentIpc(): void {
  ipcMain.handle('agent:get-config', () => {
    return readAgentConfig()
  })

  ipcMain.handle('agent:get-models', () => {
    return getAgentProviders(readAgentConfig()).flatMap((provider) =>
      provider.models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        providerId: provider.id,
        providerName: provider.name,
        reasoning: Boolean(model.reasoning)
      }))
    )
  })

  ipcMain.handle('agent:list-skills', () => {
    return listAgentSkills(readAgentConfig().skillRoot)
  })

  ipcMain.handle('agent:search-skills', (_, query: string) => {
    return searchAgentSkills(query ?? '')
  })

  ipcMain.handle(
    'agent:install-skill',
    (_, payload: { installSource?: string; installSkill?: string }) => {
      return installAgentSkill({
        installSource: payload?.installSource ?? '',
        installSkill: payload?.installSkill ?? '',
        skillRoot: readAgentConfig().skillRoot
      })
    }
  )

  ipcMain.handle(
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

  ipcMain.handle('agent:cancel-skill-install', (_, installId: string) => {
    const session = activeSkillInstalls.get(installId)
    if (!session) return { ok: false }

    session.cancel()
    return { ok: true }
  })

  ipcMain.handle('agent:delete-skill', (_, path: string) => {
    return deleteAgentSkill(path ?? '', readAgentConfig().skillRoot)
  })

  ipcMain.handle('agent:get-skill-content', (_, path: string) => {
    return readAgentSkillContent(path ?? '', readAgentConfig().skillRoot)
  })

  ipcMain.handle('agent:list-instruction-files', () => {
    return listEditableInstructionFiles()
  })

  ipcMain.handle('agent:list-wiki-documents', () => {
    return listWikiDocuments()
  })

  ipcMain.handle('agent:get-wiki-document', (_, id: string) => {
    return getWikiDocument(id ?? '')
  })

  ipcMain.handle('agent:save-wiki-document', (_, input: WikiSaveInput) => {
    return saveWikiDocument(input)
  })

  ipcMain.handle('agent:delete-wiki-document', (_, id: string) => {
    return deleteWikiDocument(id ?? '')
  })

  ipcMain.handle('agent:search-wiki-documents', (_, query: string) => {
    return searchWikiDocuments(query ?? '', 12, 6000)
  })

  ipcMain.handle(
    'agent:pick-path-reference',
    async (event, payload: { kind?: AgentPathReference['kind'] }) => {
      const kind = payload?.kind === 'directory' ? 'directory' : 'file'
      const selection = await pickAgentPathReference(event.sender, kind)
      return selection
    }
  )

  ipcMain.handle('agent:import-openapi-document', async (event) => {
    return importOpenApiDocument(event.sender)
  })

  ipcMain.handle('agent:save-pasted-attachment', async (_, payload: PastedAttachmentInput) => {
    return savePastedAttachment(payload)
  })

  ipcMain.handle('agent:request-microphone-permission', async () => {
    return requestMicrophonePermission()
  })

  ipcMain.handle('agent:transcribe-audio', async (_, payload: TranscribeAudioInput) => {
    return transcribeAudioAttachment(payload)
  })

  ipcMain.handle(
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

  ipcMain.handle(
    'agent:save-rendered-image',
    async (event, payload: { dataUrl?: string; defaultPath?: string }) => {
      return saveRenderedImage(event.sender, payload)
    }
  )
  ipcMain.handle(
    'agent:save-svg-as-png',
    async (
      event,
      payload: { svg?: string; defaultPath?: string; width?: number; height?: number }
    ) => {
      return saveSvgAsPng(event.sender, payload)
    }
  )
  ipcMain.handle(
    'agent:pick-save-path',
    async (
      event,
      payload: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
    ) => {
      return pickSavePath(event.sender, payload)
    }
  )
  ipcMain.handle(
    'agent:write-data-url-file',
    async (_, payload: { path?: string; dataUrl?: string }) => {
      return writeDataUrlFile(payload)
    }
  )

  ipcMain.handle(
    'agent:save-instruction-file',
    (_, payload: { name?: string; content?: string }) => {
      return saveEditableInstructionFile({
        name: payload?.name ?? '',
        content: payload?.content ?? ''
      })
    }
  )

  ipcMain.handle('agent:save-config', (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      ...config
    })

    return writeAgentConfig(nextConfig)
  })

  ipcMain.handle('agent:validate-config', async (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      ...config
    })

    try {
      await validateModel(nextConfig)
    } catch (error) {
      return {
        ok: false,
        modelOk: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }

    const hasOpenApiConfig = Boolean(
      nextConfig.openApiBaseUrl.trim() && nextConfig.openApiDocument.trim()
    )
    const hasMcpConfig = nextConfig.mcpServers.some(
      (server) => server.enabled && server.command.trim()
    )
    if (!hasOpenApiConfig && !hasMcpConfig) {
      return {
        ok: true,
        modelOk: true,
        toolCount: BUILT_IN_TOOL_CATALOG.length,
        tools: BUILT_IN_TOOL_CATALOG
      }
    }

    try {
      const openApiRegistry = hasOpenApiConfig
        ? await loadOpenApiToolRegistry(nextConfig)
        : { tools: [], catalog: [] }
      const mcpRegistry = hasMcpConfig
        ? await loadMcpToolRegistry(nextConfig)
        : { tools: [], catalog: [], errors: [] }
      if (mcpRegistry.errors.length > 0) {
        throw new Error(`MCP server load failed: ${mcpRegistry.errors.join('; ')}`)
      }

      return {
        ok: true,
        modelOk: true,
        toolCount:
          BUILT_IN_TOOL_CATALOG.length + openApiRegistry.tools.length + mcpRegistry.tools.length,
        tools: [...BUILT_IN_TOOL_CATALOG, ...openApiRegistry.catalog, ...mcpRegistry.catalog]
      }
    } catch (error) {
      return {
        ok: false,
        modelOk: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:cancel', (_, runId: string) => {
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : ''
    if (!normalizedRunId) return { ok: false }

    activeRuns.get(normalizedRunId)?.controller.abort()
    rejectPendingApprovalsForRun(normalizedRunId)
    return { ok: true }
  })

  ipcMain.handle('agent:reject-approvals-for-tab', (_, tabId: string) => {
    const normalizedTabId = typeof tabId === 'string' ? tabId.trim() : ''
    if (!normalizedTabId) return { ok: false }

    rejectPendingApprovalsForTab(normalizedTabId)
    return { ok: true }
  })

  ipcMain.handle('agent:supplement', (_, payload: { runId?: string; input?: string }) => {
    const runId = payload?.runId?.trim()
    const input = payload?.input?.trim()
    if (!runId || !input) return { ok: false }

    const run = activeRuns.get(runId)
    if (!run) return { ok: false }

    run.supplements.push(input)
    return { ok: true }
  })

  ipcMain.handle('agent:resolve-command-approval', (_, payload: CommandApprovalDecision) => {
    const requestId = payload?.requestId?.trim()
    if (!requestId) return { ok: false }

    return {
      ok: settlePendingCommandApproval(
        requestId,
        {
          approved: Boolean(payload.approved),
          note: typeof payload.note === 'string' ? payload.note : '',
          rejectionReason:
            typeof payload.rejectionReason === 'string' ? payload.rejectionReason : ''
        },
        { dismiss: false }
      )
    }
  })

  ipcMain.handle('agent:generate-command', async (_, payload: AgentCommandInput) => {
    const config = readAgentConfig()
    const instruction = payload?.instruction?.trim()

    if (!instruction) return { ok: false, error: 'Command instruction is empty.' }

    try {
      const command = await generateTerminalCommand(
        new AgentBrain(config),
        createIsolatedMemory(),
        {
          instruction,
          cwd: payload.cwd,
          shell: payload.shell,
          instructionContext: buildLocalInstructionContext(),
          terminalContext: payload.terminalContext
        }
      )

      return { ok: true, ...command }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(
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
              content: [
                'You analyze a user request before any terminal or connection action. Decide whether the request needs opening one configured SSH connection, which configured connection best matches, whether work must continue after login, or whether you must ask the user a clarifying question first.',
                'Return strict JSON only: {"shouldConnect":true|false,"connectionId":"..."|null,"confidence":0-100,"executeAfterLogin":true|false,"userGoal":"...","matchBasis":"name|host|user|description|none","needsClarification":true|false,"clarificationQuestion":"..."|null,"reason":"..."}.',
                'Interpret the user request with the provided conversation context, current terminal summary, and configured connections. Do not rely on fixed business rules for a specific cluster or site.',
                'Set needsClarification=true and provide one short clarificationQuestion when the target connection, whether to login first, or whether to stay in the current terminal is ambiguous. In that case set shouldConnect=false and connectionId=null.',
                'Set shouldConnect=false for general chat, local-only work, or when clarification is required.',
                'Local-only work includes local paths such as /etc/hosts, ~, $HOME, pasted local shell prompts, and requests that explicitly say the work is local/this machine.',
                'IP addresses inside pasted file contents are data to edit, not SSH targets.',
                'Set executeAfterLogin=true when the user asks for any concrete task beyond merely logging in or opening the connection.',
                'Matching priority: a clear unique connection-name match wins first; then host/alias/user when the user clearly asks for a remote connection; description is weak context only.',
                'If multiple connections could match or confidence would be below 60, prefer needsClarification over guessing. Do not invent connection ids.',
                'Write clarificationQuestion in the same language as the user request.'
              ].join('\n')
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
        const parsed = parseConnectionIntentResponse(
          completion.choices[0]?.message.content ?? '',
          connections
        )

        return parsed
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('agent:run', async (event, payload: AgentRunInput) => {
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

    try {
      const controller = new AbortController()
      const connection = findConnection(payload?.connectionId)
      const instructionContext = buildLocalInstructionContext()
      const wikiContext = formatWikiContext(await searchWikiDocuments(input, 5))
      const agentConfig = normalizeAgentConfig({
        ...readAgentConfig(),
        providerId: payload?.providerId,
        model: payload?.model
      })
      const profileContext =
        resolveActiveOpenApiProfile(agentConfig)?.promptTemplate?.trim() || undefined
      const skillInput = getSkillMatchingInput(payload, input)
      const skillContext = buildAgentSkillContext(skillInput, agentConfig.skillRoot)
      if (skillContext.matched.length > 0) {
        safeWebContentsSend(event.sender, 'agent:event', {
          type: 'skills',
          message: `Loaded ${skillContext.matched.length} skills for this request.`,
          skills: skillContext.matched.map(stripSkillContent),
          runId,
          tabId: payload?.tabId
        })
      }
      const commandAuditor = new CommandAuditor(agentConfig)
      const allowTerminalTools = payload?.allowTerminalTools !== false
      const defaultTabId = payload?.tabId?.trim() || ''
      if (defaultTabId === 'default' || defaultTabId.toLowerCase() === 'local') {
        return {
          ok: false,
          error: 'Reserved terminal tab id is not allowed. Each terminal requires a unique tabId.'
        }
      }
      const sessionTerminalIds = new Set(
        (payload?.sessionTerminals ?? [])
          .map((terminal) => terminal.tabId?.trim())
          .filter((tabId): tabId is string => Boolean(tabId))
      )
      if (defaultTabId) sessionTerminalIds.add(defaultTabId)
      activeRuns.set(runId, {
        controller,
        supplements: [],
        defaultTabId: defaultTabId || undefined,
        sessionTerminalIds,
        lastExecutionTabId: defaultTabId || undefined
      })

      const resolveExecutionTabId = (
        targetTerminalId?: string
      ): { ok: true; tabId: string } | { ok: false; error: string } => {
        const requested = targetTerminalId?.trim() || defaultTabId
        if (!requested) {
          return { ok: false, error: 'No terminal is bound to this agent run.' }
        }
        if (sessionTerminalIds.size > 0 && !sessionTerminalIds.has(requested)) {
          return {
            ok: false,
            error: `Terminal "${requested}" is outside the current chat session. Use a tabId from the session terminal inventory.`
          }
        }
        if (sessionTerminalIds.size === 0 && requested !== defaultTabId) {
          return {
            ok: false,
            error: 'Peer terminal targeting requires a session terminal inventory.'
          }
        }
        return { ok: true, tabId: requested }
      }

      const executeReviewedCommand = async (
        command: string,
        timeoutMs: number | undefined,
        execute: (command: string) => ReturnType<typeof executeCommandInTerminal>,
        executionTabId: string
      ): ReturnType<typeof executeCommandInTerminal> => {
        const executableCommand = normalizeInteractivePrivilegeCommand(command)
        const activeRun = activeRuns.get(runId)
        if (activeRun) activeRun.lastExecutionTabId = executionTabId

        const executeWithProgress = async (): ReturnType<typeof executeCommandInTerminal> => {
          const startedAt = Date.now()
          safeWebContentsSend(event.sender, 'agent:event', {
            type: 'command',
            phase: 'started',
            command: executableCommand,
            runId,
            tabId: executionTabId
          })
          const result = await execute(executableCommand)
          if (result.subterminalTabId) {
            activeRuns.get(runId)?.sessionTerminalIds.add(result.subterminalTabId)
          }
          safeWebContentsSend(event.sender, 'agent:event', {
            type: 'command',
            phase: 'finished',
            command: executableCommand,
            result,
            elapsedMs: Date.now() - startedAt,
            runId,
            tabId: result.subterminalTabId || executionTabId
          })

          return result
        }
        const whitelistRule = matchCommandWhitelist(executableCommand, agentConfig.commandWhitelist)
        if (whitelistRule) {
          safeWebContentsSend(event.sender, 'agent:event', {
            type: 'status',
            message: `Command matched whitelist: ${whitelistRule}`,
            runId,
            tabId: executionTabId
          })
          return executeWithProgress()
        }

        safeWebContentsSend(event.sender, 'agent:event', {
          type: 'status',
          message: 'Command review subprocess is analyzing risk.',
          runId,
          tabId: executionTabId
        })
        const audit = await commandAuditor.audit({
          command: executableCommand,
          userInput: input,
          terminalContext: payload?.terminalContext ?? '',
          locale: payload?.locale
        })
        safeWebContentsSend(event.sender, 'agent:event', {
          type: 'command-review',
          command: executableCommand,
          audit,
          runId,
          tabId: executionTabId
        })
        if (!audit.requiresApproval) {
          safeWebContentsSend(event.sender, 'agent:event', {
            type: 'status',
            message: 'Command audit classified this as read-only inspection.',
            runId,
            tabId: executionTabId
          })
          return executeWithProgress()
        }

        const approval = await requestCommandApproval({
          webContents: event.sender,
          runId,
          tabId: executionTabId,
          command: executableCommand,
          timeoutMs,
          audit,
          signal: controller.signal
        })

        if (!approval.approved) {
          const rejectionReason = (approval.rejectionReason || approval.note || '').trim()
          safeWebContentsSend(event.sender, 'agent:event', {
            type: 'status',
            message: rejectionReason
              ? `Command rejected by user.\nUser rejection reason: ${rejectionReason}`
              : 'Command rejected by user.',
            runId,
            tabId: executionTabId
          })
          return {
            ok: false,
            command: executableCommand,
            output: '',
            error: [
              'Command execution was rejected by the user. Continue from this result and do not assume the command ran.',
              rejectionReason ? `User rejection reason: ${rejectionReason}` : ''
            ]
              .filter(Boolean)
              .join('\n')
          }
        }

        safeWebContentsSend(event.sender, 'agent:event', {
          type: 'status',
          message: approval.note?.trim()
            ? `Command approved by user.\nUser approval note: ${approval.note.trim()}`
            : 'Command approved by user.',
          runId,
          tabId: executionTabId
        })
        const approvalNote = approval.note?.trim()
        if (approvalNote) {
          activeRuns
            .get(runId)
            ?.supplements.push(
              [
                'Command execution was approved by the user with an additional note.',
                `Approved command: ${executableCommand}`,
                `User approval note: ${approvalNote}`
              ].join('\n')
            )
        }

        const executionResult = await executeWithProgress()
        if (!approvalNote) return executionResult

        return {
          ...executionResult,
          output: [`User approval note before execution: ${approvalNote}`, executionResult.output]
            .filter(Boolean)
            .join('\n')
        }
      }
      const text = await runTerminalAgent(
        agentConfig,
        input,
        createIsolatedMemory(),
        payload?.terminalContext ?? '',
        (agentEvent) => {
          safeWebContentsSend(event.sender, 'agent:event', {
            ...agentEvent,
            runId,
            tabId: activeRuns.get(runId)?.lastExecutionTabId ?? payload?.tabId
          })
        },
        allowTerminalTools
          ? {
              executeCommand: async (command, timeoutMsOrOptions) => {
                const options =
                  typeof timeoutMsOrOptions === 'number'
                    ? { timeoutMs: timeoutMsOrOptions }
                    : (timeoutMsOrOptions ?? {})
                const resolved = resolveExecutionTabId(options.targetTerminalId)
                if (!resolved.ok) {
                  return {
                    ok: false,
                    command: command.trim(),
                    output: '',
                    error: resolved.error
                  }
                }
                return executeReviewedCommand(
                  command,
                  options.timeoutMs,
                  (executableCommand) =>
                    executeCommandInTerminalWithPermissionRequest(
                      event.sender,
                      executableCommand,
                      options.timeoutMs,
                      resolved.tabId
                    ),
                  resolved.tabId
                )
              }
            }
          : undefined,
        allowTerminalTools
          ? {
              executeCommand: async (command, options) => {
                const parentTabId =
                  activeRuns.get(runId)?.lastExecutionTabId || defaultTabId || payload?.tabId
                return executeReviewedCommand(
                  command,
                  options.timeoutMs,
                  (executableCommand) =>
                    executeCommandInTemporaryTerminal(
                      event.sender,
                      parentTabId,
                      options.terminalName,
                      executableCommand,
                      options.timeoutMs,
                      options.mode
                    ),
                  parentTabId || defaultTabId
                )
              },
              readOutput: async (options) => {
                const parentTabId =
                  activeRuns.get(runId)?.lastExecutionTabId || defaultTabId || payload?.tabId
                return readTemporarySubterminalOutput(
                  event.sender,
                  parentTabId,
                  options.terminalName,
                  options.maxChars
                )
              },
              interrupt: async (options) => {
                const parentTabId =
                  activeRuns.get(runId)?.lastExecutionTabId || defaultTabId || payload?.tabId
                return interruptTemporarySubterminal(
                  event.sender,
                  parentTabId,
                  options.terminalName
                )
              }
            }
          : undefined,
        createLocalFileWriter(event.sender),
        {
          signal: controller.signal,
          instructionContext,
          skillContext: skillContext.promptBlock,
          wikiContext,
          conversationContext: payload?.conversationContext?.trim(),
          profileContext,
          opsHistoryContext: formatOpsHistoryContext(
            listOpsHistoryForConnection(resolveOpsConnectionId(payload?.connectionId), 16)
          ),
          consumeSupplementalInputs: () => {
            const run = activeRuns.get(runId)
            if (!run?.supplements.length) return []

            return run.supplements.splice(0)
          },
          approveTool: async ({ toolName, rawArguments, catalog, userInput }) => {
            const command = buildExternalToolApprovalCommand({
              toolName,
              rawArguments,
              catalog,
              userInput
            })
            const audit = buildExternalToolAudit({
              toolName,
              rawArguments,
              catalog,
              userInput
            })

            safeWebContentsSend(event.sender, 'agent:event', {
              type: 'command-review',
              command,
              audit,
              runId,
              tabId: payload?.tabId
            })

            const approval = await requestCommandApproval({
              webContents: event.sender,
              runId,
              tabId: payload?.tabId,
              command,
              audit,
              signal: controller.signal
            })

            if (approval.approved) {
              safeWebContentsSend(event.sender, 'agent:event', {
                type: 'status',
                message: approval.note?.trim()
                  ? `Tool ${toolName} approved by user.\nUser approval note: ${approval.note.trim()}`
                  : `Tool ${toolName} approved by user.`,
                runId,
                tabId: payload?.tabId
              })
            } else {
              const rejectionReason = (approval.rejectionReason || approval.note || '').trim()
              safeWebContentsSend(event.sender, 'agent:event', {
                type: 'status',
                message: rejectionReason
                  ? `Tool ${toolName} rejected by user.\nUser rejection reason: ${rejectionReason}`
                  : `Tool ${toolName} rejected by user.`,
                runId,
                tabId: payload?.tabId
              })
            }

            return approval
          }
        }
      )
      appendOperationRecord({
        connectionId: payload?.connectionId,
        connectionName: connection?.name,
        status: 'success',
        summary: input,
        output: text
      })

      return { ok: true, text }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const connection = findConnection(payload?.connectionId)
      appendOperationRecord({
        connectionId: payload?.connectionId,
        connectionName: connection?.name,
        status: 'error',
        summary: input,
        output: message
      })
      safeWebContentsSend(event.sender, 'agent:event', {
        type: 'error',
        message,
        runId,
        tabId: payload?.tabId
      })
      return { ok: false, error: message }
    } finally {
      activeRuns.delete(runId)
    }
  })
}

function createLocalFileWriter(webContents: WebContents): LocalFileWriter {
  return {
    writeFile: (path, content, options) =>
      writeLocalArtifactFile(webContents, path, content, {
        overwrite: options?.overwrite === true
      })
  }
}

async function writeLocalArtifactFile(
  webContents: WebContents,
  rawPath: string,
  content: string,
  options: { overwrite: boolean }
): Promise<LocalFileWriteResult> {
  const targetPath = resolveLocalArtifactPath(rawPath)
  if (!targetPath) {
    return { ok: false, path: rawPath, error: 'Local file path is empty.' }
  }

  const parent = dirname(targetPath)
  const firstAttempt = await tryWriteLocalArtifact(targetPath, content, options)
  if (firstAttempt.ok || !isLocalFilePermissionError(firstAttempt.error)) return firstAttempt

  const authorizationPath = await requestLocalWriteAuthorization(webContents, parent)
  if (!authorizationPath) {
    return {
      ...firstAttempt,
      permissionRequested: true,
      error: [
        firstAttempt.error,
        'Local folder access was not granted. Please grant access to the target folder and retry.'
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  const secondAttempt = await tryWriteLocalArtifact(targetPath, content, options)
  return {
    ...secondAttempt,
    permissionRequested: true,
    authorizationPath,
    error: secondAttempt.ok
      ? secondAttempt.error
      : [
          secondAttempt.error,
          `Local folder access was requested for: ${authorizationPath}. Retry if macOS requires confirmation.`
        ]
          .filter(Boolean)
          .join('\n')
  }
}

async function tryWriteLocalArtifact(
  targetPath: string,
  content: string,
  options: { overwrite: boolean }
): Promise<LocalFileWriteResult> {
  try {
    await fs.mkdir(dirname(targetPath), { recursive: true })
    const exists = await pathExists(targetPath)
    if (exists && !options.overwrite) {
      return {
        ok: false,
        path: targetPath,
        error:
          'Target file already exists. Choose a unique filename or set overwrite only when the user explicitly requested replacement.'
      }
    }

    await fs.writeFile(targetPath, content, 'utf-8')
    return {
      ok: true,
      path: targetPath,
      bytes: Buffer.byteLength(content, 'utf-8'),
      overwritten: exists
    }
  } catch (error) {
    return {
      ok: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') return false
    throw error
  }
}

async function requestLocalWriteAuthorization(
  webContents: WebContents,
  defaultPath: string
): Promise<string | undefined> {
  const options: OpenDialogOptions = {
    title: 'Authorize local folder access',
    message:
      'Crescent could not write to the requested local folder. Select the target folder to grant access, then the write will be retried.',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  return selection.canceled ? undefined : selection.filePaths[0]
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

async function importOpenApiDocument(
  webContents: WebContents
): Promise<{ ok: boolean; path?: string; canceled?: boolean }> {
  const options: OpenDialogOptions = {
    title: 'Import OpenAPI document',
    properties: ['openFile'],
    filters: [
      { name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] },
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

  return { ok: true, path: resolve(selection.filePaths[0]) }
}

async function savePastedAttachment(input: PastedAttachmentInput): Promise<AgentPathReference> {
  const attachmentDir = getCrescentAttachmentsDir()
  await fs.mkdir(attachmentDir, { recursive: true })

  const fallbackName = input.mimeType?.startsWith('image/')
    ? 'pasted-image'
    : input.mimeType?.startsWith('audio/')
      ? 'voice-input'
      : 'pasted-file'
  const safeName = sanitizeAttachmentName(input.name || fallbackName)
  const extension = extname(safeName) || extensionFromMimeType(input.mimeType)
  const baseName = sanitizeAttachmentName(
    safeName.slice(0, safeName.length - extname(safeName).length)
  )
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName || fallbackName}${extension}`
  const path = resolve(attachmentDir, filename)

  await fs.writeFile(path, Buffer.from(input.base64 ?? '', 'base64'))

  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    name: basename(path) || path
  }
}

async function requestMicrophonePermission(): Promise<{ ok: boolean; granted: boolean }> {
  if (process.platform !== 'darwin') return { ok: true, granted: true }

  const { systemPreferences } = await import('electron')
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { ok: true, granted: true }
  if (status === 'denied' || status === 'restricted') return { ok: true, granted: false }

  const granted = await systemPreferences.askForMediaAccess('microphone')
  return { ok: true, granted }
}

async function transcribeAudioAttachment(
  input: TranscribeAudioInput
): Promise<TranscribeAudioResult> {
  const base64 = input?.base64?.trim() ?? ''
  if (!base64) return { ok: false, error: 'Audio data is empty.' }

  try {
    const saved = await savePastedAttachment({
      name: input.name || 'voice-input.webm',
      mimeType: input.mimeType || 'audio/webm',
      base64
    })
    const text = (
      await new AgentBrain(readAgentConfig()).transcribeAudio({
        path: saved.path,
        language: input.language
      })
    ).trim()
    if (!text) return { ok: false, error: 'Transcription returned empty text.', path: saved.path }
    return { ok: true, text, path: saved.path }
  } catch (error) {
    return {
      ok: false,
      error: formatTranscriptionError(error)
    }
  }
}

function formatTranscriptionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined

  if (status === 404 || /404|Not Found/i.test(message)) {
    return 'Current model provider does not support audio transcription (/audio/transcriptions). Use an OpenAI-compatible provider that exposes Whisper, or rely on system speech recognition.'
  }

  // OpenAI SDK often includes "404 ... no body" / empty response text.
  if (/no body/i.test(message)) {
    return `${message} (provider likely missing /audio/transcriptions)`
  }

  return message
}

async function saveRenderedImage(
  webContents: WebContents,
  input: { dataUrl?: string; defaultPath?: string }
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const image = nativeImage.createFromDataURL(input.dataUrl ?? '')
  if (image.isEmpty()) return { ok: false, error: 'Image data is empty.' }

  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showSaveDialog(browserWindow, {
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
    : await dialog.showSaveDialog({
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })

  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }

  await fs.writeFile(resolve(selection.filePath), image.toPNG())
  return { ok: true, path: resolve(selection.filePath) }
}

async function saveSvgAsPng(
  webContents: WebContents,
  input: { svg?: string; defaultPath?: string; width?: number; height?: number }
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const svg = input.svg?.trim() ?? ''
  if (!svg.includes('<svg')) return { ok: false, error: 'SVG content is empty.' }

  const width = Math.max(1, Math.ceil(input.width || 1200))
  const height = Math.max(1, Math.ceil(input.height || 800))
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showSaveDialog(browserWindow, {
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
    : await dialog.showSaveDialog({
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })

  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }

  const maxCaptureSide = 8192
  const scale = Math.min(1, maxCaptureSide / width, maxCaptureSide / height)
  const captureWidth = Math.max(1, Math.ceil(width * scale))
  const captureHeight = Math.max(1, Math.ceil(height * scale))
  const exportWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#171717',
    width: captureWidth,
    height: captureHeight,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      javascript: false,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    exportWindow.setContentSize(captureWidth, captureHeight)
    const html = buildSvgExportHtml(svg, width, height, scale)
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const image = await exportWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureWidth,
      height: captureHeight
    })
    if (image.isEmpty()) return { ok: false, error: 'Captured PNG image is empty.' }

    const path = resolve(selection.filePath)
    await fs.writeFile(path, image.toPNG())
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!exportWindow.isDestroyed()) exportWindow.close()
  }
}

function buildSvgExportHtml(svg: string, width: number, height: number, scale: number): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        width: ${Math.ceil(width * scale)}px;
        height: ${Math.ceil(height * scale)}px;
        margin: 0;
        overflow: hidden;
        background: #171717;
      }

      .export-frame {
        width: ${width}px;
        height: ${height}px;
        transform: scale(${scale});
        transform-origin: top left;
        background: #171717;
      }

      svg {
        display: block;
        width: ${width}px !important;
        height: ${height}px !important;
        max-width: none !important;
        max-height: none !important;
        background: #171717;
      }
    </style>
  </head>
  <body>
    <div class="export-frame">${svg}</div>
  </body>
</html>`
}

async function pickSavePath(
  webContents: WebContents,
  input: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
): Promise<{ ok: boolean; path?: string; canceled?: boolean }> {
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const options = {
    defaultPath: input.defaultPath || 'crescent-export',
    filters: input.filters
  }
  const selection = browserWindow
    ? await dialog.showSaveDialog(browserWindow, options)
    : await dialog.showSaveDialog(options)

  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }
  return { ok: true, path: resolve(selection.filePath) }
}

async function writeDataUrlFile(input: {
  path?: string
  dataUrl?: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  const path = input.path ? resolve(input.path) : ''
  const match = input.dataUrl?.match(/^data:[^,]*;base64,(.+)$/)
  if (!path) return { ok: false, error: 'A save path is required.' }
  if (!match) return { ok: false, error: 'A base64 data URL is required.' }

  try {
    await fs.writeFile(path, Buffer.from(match[1], 'base64'))
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function sanitizeAttachmentName(value: string): string {
  const name = basename(value.trim() || 'attachment')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return name.slice(0, 120) || 'attachment'
}

function extensionFromMimeType(mimeType?: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'application/pdf':
      return '.pdf'
    case 'audio/webm':
      return '.webm'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return '.wav'
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3'
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return '.m4a'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/flac':
      return '.flac'
    default:
      return ''
  }
}

function resolveLocalArtifactPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  const expanded = trimmed.replace(/^~(?=\/|$)/, homedir()).replace(/^\$HOME(?=\/|$)/, homedir())

  return isAbsolute(expanded) ? resolve(expanded) : resolve(homedir(), expanded)
}

function isLocalFilePermissionError(error: string | undefined): boolean {
  return /(EACCES|EPERM|Permission denied|Operation not permitted)/i.test(error ?? '')
}

function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function requestCommandApproval(input: {
  webContents: WebContents
  runId: string
  tabId?: string
  command: string
  timeoutMs?: number
  audit: CommandAuditResult
  signal?: AbortSignal
}): Promise<CommandApprovalDecisionResult> {
  if (input.webContents.isDestroyed()) return Promise.resolve({ approved: false })

  const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const request: CommandApprovalRequest = {
    id: requestId,
    runId: input.runId,
    tabId: input.tabId,
    command: input.command,
    timeoutMs: input.timeoutMs,
    audit: input.audit
  }

  return new Promise((resolve) => {
    const finish = (decision: CommandApprovalDecisionResult): void => {
      input.signal?.removeEventListener('abort', onAbort)
      resolve(decision)
    }
    const timeout = setTimeout(
      () => {
        settlePendingCommandApproval(requestId, { approved: false })
      },
      10 * 60 * 1000
    )
    const onAbort = (): void => {
      settlePendingCommandApproval(requestId, {
        approved: false,
        rejectionReason: 'Agent run was canceled.'
      })
    }

    pendingCommandApprovals.set(requestId, {
      runId: input.runId,
      tabId: input.tabId,
      webContents: input.webContents,
      resolve: finish,
      timeout
    })
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) {
      onAbort()
      return
    }
    safeWebContentsSend(input.webContents, 'agent:command-approval-request', request)
  })
}

function summarizeConnectionForAi(connection: ConnectionConfig): Record<string, unknown> {
  return {
    id: connection.id,
    matchingPriority:
      'name is primary; host/user-visible identifiers are secondary; description is weak context only',
    source: connection.source,
    name: connection.name,
    normalizedName: normalizeConnectionIntentText(connection.name),
    host: connection.host,
    user: connection.user,
    port: connection.port,
    identityFile: connection.identityFile,
    description: connection.description,
    normalizedDescription: normalizeConnectionIntentText(connection.description ?? ''),
    sshOptions: connection.sshOptions
  }
}

function normalizeConnectionIntentText(value: string): string {
  return value.toLowerCase().replace(/[\s"'`,.:;/\\|()[\]{}_-]+/g, '')
}

function parseConnectionIntentResponse(
  content: string,
  connections: ConnectionConfig[]
): AgentConnectionIntentResult {
  try {
    const parsed = parseJsonFromModelContent<{
      shouldConnect?: unknown
      connectionId?: unknown
      confidence?: unknown
      executeAfterLogin?: unknown
      userGoal?: unknown
      matchBasis?: unknown
      needsClarification?: unknown
      clarificationQuestion?: unknown
      reason?: unknown
    }>(content)
    const needsClarification = parsed.needsClarification === true
    const clarificationQuestion =
      typeof parsed.clarificationQuestion === 'string' && parsed.clarificationQuestion.trim()
        ? parsed.clarificationQuestion.trim()
        : undefined
    const shouldConnect = parsed.shouldConnect === true && !needsClarification
    const connectionId = typeof parsed.connectionId === 'string' ? parsed.connectionId : undefined
    const confidence = Number(parsed.confidence)
    const executeAfterLogin = parsed.executeAfterLogin === true
    const knownIds = new Set(connections.map((connection) => connection.id))
    const userGoal = typeof parsed.userGoal === 'string' ? parsed.userGoal : undefined
    const matchBasis = parseConnectionMatchBasis(parsed.matchBasis)
    const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined

    if (needsClarification) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        needsClarification: true,
        clarificationQuestion:
          clarificationQuestion ||
          reason ||
          'Please clarify which connection or terminal context to use.',
        reason: reason || 'clarification required'
      }
    }

    if (!shouldConnect) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        reason: reason || 'no connection needed'
      }
    }

    if (!connectionId || !knownIds.has(connectionId) || !Number.isFinite(confidence)) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        needsClarification: true,
        clarificationQuestion:
          clarificationQuestion ||
          'I could not uniquely match a configured SSH connection. Which connection should I use, or should I stay in the current terminal?',
        reason: reason || 'no match'
      }
    }

    if (confidence < 60) {
      return {
        ok: false,
        shouldConnect: false,
        confidence,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        needsClarification: true,
        clarificationQuestion:
          clarificationQuestion ||
          `I am not sure whether to use connection "${connections.find((connection) => connection.id === connectionId)?.name ?? connectionId}". Should I connect to it, or stay in the current terminal?`,
        reason: reason || 'low confidence'
      }
    }

    return {
      ok: true,
      shouldConnect: true,
      connectionId,
      confidence,
      executeAfterLogin,
      userGoal,
      matchBasis,
      reason
    }
  } catch {
    return {
      ok: false,
      shouldConnect: false,
      confidence: 0,
      needsClarification: true,
      clarificationQuestion:
        'I could not determine the target connection from that request. Which configured SSH connection should I use, or should I continue in the current terminal?',
      reason: 'invalid model response'
    }
  }
}

function parseConnectionMatchBasis(value: unknown): AgentConnectionIntentResult['matchBasis'] {
  return value === 'name' ||
    value === 'host' ||
    value === 'user' ||
    value === 'description' ||
    value === 'none'
    ? value
    : undefined
}

function createMemory(): AgentMemory {
  return new AgentMemory(readCrescentMemory(), (nextMemory) => {
    writeCrescentMemory(nextMemory)
  })
}

function createIsolatedMemory(): AgentMemory {
  return new AgentMemory(
    readCrescentMemory(),
    (nextMemory) => {
      writeCrescentMemory(nextMemory)
    },
    {
      includeShortTerm: false,
      includeOperations: false,
      persistShortTerm: false
    }
  )
}

async function validateModel(config: AgentConfig): Promise<void> {
  if (!config.providers.length) throw new Error('Model provider is required.')
  if (!config.model.trim()) throw new Error('Model is required.')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  let completion
  try {
    completion = await new AgentBrain(config).chat(
      {
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: 'Reply with OK.'
          }
        ]
      },
      { signal: controller.signal }
    )
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Model validation timed out after 20 seconds.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const text = completion.choices[0]?.message.content?.trim()
  if (!text) throw new Error('Model returned an empty validation response.')
}

function findConnection(id: string | undefined): { id: string; name: string } | undefined {
  if (!id) return undefined

  return [...loadSshConfigConnections(), ...readCustomConnections()].find(
    (connection) => connection.id === id
  )
}

function getSkillMatchingInput(payload: AgentRunInput, input: string): string {
  const explicitSkillInput = payload?.skillInput?.trim()
  if (explicitSkillInput) return explicitSkillInput

  const originalTask = extractOriginalUserTask(input)
  return originalTask || input
}

function extractOriginalUserTask(input: string): string {
  const lines = input.split(/\r?\n/)
  const markerIndex = lines.findIndex((line) =>
    /^(用户原始任务|Original user task)\s*:?\s*$/i.test(line.trim())
  )
  if (markerIndex < 0) return ''

  return lines
    .slice(markerIndex + 1)
    .join('\n')
    .trim()
}

function normalizeInteractivePrivilegeCommand(command: string): string {
  return command.replace(/(^|[;&|]\s*)sudo\s+(?:-n|--non-interactive)\s+/g, '$1sudo ')
}
