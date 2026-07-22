import { promises as fs } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, resolve } from 'path'

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron'

import { generateTerminalCommand } from './command'
import { CommandAuditor } from './command-auditor'
import { matchCommandWhitelist } from './command-whitelist'
import {
  buildLocalInstructionContext,
  listEditableInstructionFiles,
  saveEditableInstructionFile
} from './instruction-files'
import { AgentMemory } from './memory'
import { getAgentProviders } from './model-provider-config'
import { AgentBrain } from './brain'
import { BUILT_IN_TOOL_CATALOG } from '../../shared/agent-tool-catalog'
import {
  buildAgentSkillContext,
  deleteAgentSkill,
  installAgentSkill,
  listAgentSkills,
  readAgentSkillContent,
  searchAgentSkills,
  startAgentSkillInstall
} from './skills'
import { runTerminalAgent } from './runner'
import { loadOpenApiToolRegistry } from './tool-registry'
import { loadMcpToolRegistry } from './mcp-runtime'
import {
  formatWikiContext,
  getWikiDocument,
  listWikiDocuments,
  saveWikiDocument,
  searchWikiDocuments
} from './wiki'
import {
  executeCommandInTemporaryTerminal,
  executeCommandInTerminal,
  executeCommandInTerminalWithPermissionRequest
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
  WikiSaveInput
} from './types'

interface ActiveAgentRun {
  controller: AbortController
  supplements: string[]
}

const activeRuns = new Map<string, ActiveAgentRun>()
const activeSkillInstalls = new Map<string, { cancel: () => void }>()
const pendingCommandApprovals = new Map<
  string,
  {
    resolve: (decision: CommandApprovalDecisionResult) => void
    timeout: NodeJS.Timeout
  }
>()

interface CommandApprovalDecisionResult {
  approved: boolean
  rejectionReason?: string
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
          if (!webContents.isDestroyed()) {
            webContents.send('agent:skill-install-event', {
              installId,
              type: 'log',
              data
            })
          }
        }
      )

      activeSkillInstalls.set(installId, { cancel: session.cancel })
      session.promise
        .then((result) => {
          if (!webContents.isDestroyed()) {
            webContents.send('agent:skill-install-event', {
              installId,
              type: 'done',
              result
            })
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (!webContents.isDestroyed()) {
            webContents.send('agent:skill-install-event', {
              installId,
              type: 'error',
              error: message,
              canceled: /canceled/i.test(message)
            })
          }
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
    activeRuns.get(runId)?.controller.abort()
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

    const pending = pendingCommandApprovals.get(requestId)
    if (!pending) return { ok: false }

    clearTimeout(pending.timeout)
    pendingCommandApprovals.delete(requestId)
    pending.resolve({
      approved: Boolean(payload.approved),
      rejectionReason: typeof payload.rejectionReason === 'string' ? payload.rejectionReason : ''
    })
    return { ok: true }
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

      const connections = [...loadSshConfigConnections(), ...readCustomConnections()]
      if (connections.length === 0) return { ok: false, reason: 'No configured connections.' }

      try {
        const completion = await new AgentBrain(readAgentConfig()).chat({
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'You analyze a user request before any terminal or connection action. Decide whether the request needs opening one configured SSH connection, which configured connection best matches, and whether work must continue after login. Return strict JSON only: {"shouldConnect":true|false,"connectionId":"..."|null,"confidence":0-100,"executeAfterLogin":true|false,"userGoal":"...","matchBasis":"name|host|user|description|none","reason":"..."}. Set shouldConnect=false for general chat, local-only work, or ambiguous requests that do not clearly require a configured connection. Set executeAfterLogin=true when the user asks for any concrete task beyond merely logging in or opening the connection, including inspection, troubleshooting, file work, configuration changes, account/user/permission operations, service operations, or reporting. Matching priority is strict: exact connection name or name-contained request wins first; then host/alias/user-visible identifier; description is only weak context and must never override a plausible name match. If the request names a cluster/environment and a connection name contains that name, choose that connection even if another connection description mentions it. If only descriptions match and names conflict or are ambiguous, lower confidence below 60. Do not invent ids.'
            },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  request: input,
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
      event.sender.send('agent:event', {
        type: 'done',
        message: 'Saved to long-term memory.',
        runId,
        tabId: payload?.tabId
      })
      return { ok: true, text: 'Saved to long-term memory.' }
    }

    try {
      const controller = new AbortController()
      activeRuns.set(runId, { controller, supplements: [] })
      const connection = findConnection(payload?.connectionId)
      const instructionContext = buildLocalInstructionContext()
      const wikiContext = formatWikiContext(await searchWikiDocuments(input, 5))
      const agentConfig = normalizeAgentConfig({
        ...readAgentConfig(),
        providerId: payload?.providerId,
        model: payload?.model
      })
      const skillContext = buildAgentSkillContext(input, agentConfig.skillRoot)
      const commandAuditor = new CommandAuditor(agentConfig)
      const executeReviewedCommand = async (
        command: string,
        timeoutMs: number | undefined,
        execute: (command: string) => ReturnType<typeof executeCommandInTerminal>
      ): ReturnType<typeof executeCommandInTerminal> => {
        const executableCommand = normalizeInteractivePrivilegeCommand(command)
        const whitelistRule = matchCommandWhitelist(executableCommand, agentConfig.commandWhitelist)
        if (whitelistRule) {
          event.sender.send('agent:event', {
            type: 'status',
            message: `Command matched whitelist: ${whitelistRule}`,
            runId,
            tabId: payload?.tabId
          })
          return execute(executableCommand)
        }

        event.sender.send('agent:event', {
          type: 'status',
          message: 'Command review subprocess is analyzing risk.',
          runId,
          tabId: payload?.tabId
        })
        const audit = await commandAuditor.audit({
          command: executableCommand,
          userInput: input,
          terminalContext: payload?.terminalContext ?? '',
          locale: payload?.locale
        })
        event.sender.send('agent:event', {
          type: 'command-review',
          command: executableCommand,
          audit,
          runId,
          tabId: payload?.tabId
        })
        if (!audit.requiresApproval) {
          event.sender.send('agent:event', {
            type: 'status',
            message: 'Command audit classified this as read-only inspection.',
            runId,
            tabId: payload?.tabId
          })
          return execute(executableCommand)
        }

        const approval = await requestCommandApproval({
          webContents: event.sender,
          runId,
          tabId: payload?.tabId,
          command: executableCommand,
          timeoutMs,
          audit,
          signal: controller.signal
        })

        if (!approval.approved) {
          const rejectionReason = approval.rejectionReason?.trim()
          event.sender.send('agent:event', {
            type: 'status',
            message: 'Command rejected by user.',
            runId,
            tabId: payload?.tabId
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

        event.sender.send('agent:event', {
          type: 'status',
          message: 'Command approved by user.',
          runId,
          tabId: payload?.tabId
        })
        return execute(executableCommand)
      }
      const text = await runTerminalAgent(
        agentConfig,
        input,
        createIsolatedMemory(),
        payload?.terminalContext ?? '',
        (agentEvent) => {
          event.sender.send('agent:event', { ...agentEvent, runId, tabId: payload?.tabId })
        },
        {
          executeCommand: async (command, timeoutMs) => {
            return executeReviewedCommand(command, timeoutMs, (executableCommand) =>
              executeCommandInTerminalWithPermissionRequest(
                event.sender,
                executableCommand,
                timeoutMs,
                payload?.tabId
              )
            )
          }
        },
        {
          executeCommand: async (command, options) => {
            return executeReviewedCommand(command, options.timeoutMs, (executableCommand) =>
              executeCommandInTemporaryTerminal(
                event.sender,
                payload?.tabId,
                options.terminalName,
                executableCommand,
                options.timeoutMs
              )
            )
          }
        },
        createLocalFileWriter(event.sender),
        {
          signal: controller.signal,
          instructionContext,
          skillContext: skillContext.promptBlock,
          wikiContext,
          consumeSupplementalInputs: () => {
            const run = activeRuns.get(runId)
            if (!run?.supplements.length) return []

            return run.supplements.splice(0)
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
      event.sender.send('agent:event', { type: 'error', message, runId, tabId: payload?.tabId })
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
        pendingCommandApprovals.delete(requestId)
        finish({ approved: false })
      },
      10 * 60 * 1000
    )
    const onAbort = (): void => {
      clearTimeout(timeout)
      pendingCommandApprovals.delete(requestId)
      finish({ approved: false })
    }

    pendingCommandApprovals.set(requestId, { resolve: finish, timeout })
    input.signal?.addEventListener('abort', onAbort, { once: true })
    input.webContents.send('agent:command-approval-request', request)
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
    const parsed = JSON.parse(content) as {
      shouldConnect?: unknown
      connectionId?: unknown
      confidence?: unknown
      executeAfterLogin?: unknown
      userGoal?: unknown
      matchBasis?: unknown
      reason?: unknown
    }
    const shouldConnect = parsed.shouldConnect === true
    const connectionId = typeof parsed.connectionId === 'string' ? parsed.connectionId : undefined
    const confidence = Number(parsed.confidence)
    const executeAfterLogin = parsed.executeAfterLogin === true
    const knownIds = new Set(connections.map((connection) => connection.id))
    const userGoal = typeof parsed.userGoal === 'string' ? parsed.userGoal : undefined
    const matchBasis = parseConnectionMatchBasis(parsed.matchBasis)

    if (!shouldConnect) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'no connection needed'
      }
    }

    if (!connectionId || !knownIds.has(connectionId) || !Number.isFinite(confidence)) {
      return {
        ok: false,
        shouldConnect: true,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin,
        userGoal,
        matchBasis,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'no match'
      }
    }

    return {
      ok: confidence >= 60,
      shouldConnect: true,
      connectionId,
      confidence,
      executeAfterLogin,
      userGoal,
      matchBasis,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined
    }
  } catch {
    return { ok: false, shouldConnect: false, confidence: 0, reason: 'invalid model response' }
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

function normalizeInteractivePrivilegeCommand(command: string): string {
  return command.replace(/(^|[;&|]\s*)sudo\s+(?:-n|--non-interactive)\s+/g, '$1sudo ')
}
