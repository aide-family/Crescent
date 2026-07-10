import { promises as fs } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, resolve } from 'path'

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
import { getAgentProviders } from './openclaw-config'
import { AgentBrain } from './brain'
import {
  buildAgentSkillContext,
  deleteAgentSkill,
  installAgentSkill,
  listAgentSkills,
  searchAgentSkills
} from './skills'
import { runTerminalAgent } from './runner'
import { loadOpenApiToolRegistry } from './tool-registry'
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
  AgentRunInput,
  CommandApprovalDecision,
  CommandApprovalRequest,
  CommandAuditResult,
  ConnectionConfig,
  LocalFileWriter,
  LocalFileWriteResult
} from './types'

interface ActiveAgentRun {
  controller: AbortController
  supplements: string[]
}

const activeRuns = new Map<string, ActiveAgentRun>()
const pendingCommandApprovals = new Map<
  string,
  {
    resolve: (approved: boolean) => void
    timeout: NodeJS.Timeout
  }
>()

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
    return listAgentSkills()
  })

  ipcMain.handle('agent:search-skills', (_, query: string) => {
    return searchAgentSkills(query ?? '')
  })

  ipcMain.handle(
    'agent:install-skill',
    (_, payload: { installSource?: string; installSkill?: string }) => {
      return installAgentSkill({
        installSource: payload?.installSource ?? '',
        installSkill: payload?.installSkill ?? ''
      })
    }
  )

  ipcMain.handle('agent:delete-skill', (_, path: string) => {
    return deleteAgentSkill(path ?? '')
  })

  ipcMain.handle('agent:list-instruction-files', () => {
    return listEditableInstructionFiles()
  })

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
    if (!hasOpenApiConfig) {
      return {
        ok: true,
        modelOk: true,
        toolCount: 0,
        tools: []
      }
    }

    try {
      const registry = await loadOpenApiToolRegistry(nextConfig)
      return {
        ok: true,
        modelOk: true,
        toolCount: registry.tools.length,
        tools: registry.catalog.slice(0, 8)
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
    pending.resolve(Boolean(payload.approved))
    return { ok: true }
  })

  ipcMain.handle('agent:generate-command', async (_, payload: AgentCommandInput) => {
    const config = readAgentConfig()
    const instruction = payload?.instruction?.trim()

    if (!instruction) return { ok: false, error: 'Command instruction is empty.' }

    try {
      const command = await generateTerminalCommand(new AgentBrain(config), createMemory(), {
        instruction,
        cwd: payload.cwd,
        shell: payload.shell,
        instructionContext: buildLocalInstructionContext(),
        terminalContext: payload.terminalContext
      })

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
                'You analyze a user request before any terminal or connection action. Decide whether the request needs opening one configured SSH connection, which configured connection best matches, and whether work must continue after login. Return strict JSON only: {"shouldConnect":true|false,"connectionId":"..."|null,"confidence":0-100,"executeAfterLogin":true|false,"userGoal":"...","reason":"..."}. Set shouldConnect=false for general chat, local-only work, or ambiguous requests that do not clearly require a configured connection. Set executeAfterLogin=true when the user asks for any concrete task beyond merely logging in or opening the connection, including inspection, troubleshooting, file work, configuration changes, account/user/permission operations, service operations, or reporting. Infer semantically from the full request and current configured connections; do not rely on keywords alone. Prefer exact cluster, environment, host alias, hostname, or description matches. Do not invent ids.'
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
      const runLanguage = resolveRunLanguage(payload?.locale, input)
      const connection = findConnection(payload?.connectionId)
      const skillContext = buildAgentSkillContext(input)
      const instructionContext = buildLocalInstructionContext()
      const agentConfig = readAgentConfig()
      const commandAuditor = new CommandAuditor(agentConfig)
      const executeReviewedCommand = async (
        command: string,
        timeoutMs: number | undefined,
        execute: () => ReturnType<typeof executeCommandInTerminal>
      ): ReturnType<typeof executeCommandInTerminal> => {
        const whitelistRule = matchCommandWhitelist(command, agentConfig.commandWhitelist)
        if (whitelistRule) {
          event.sender.send('agent:event', {
            type: 'status',
            message: `Command matched whitelist: ${whitelistRule}`,
            runId,
            tabId: payload?.tabId
          })
          return execute()
        }

        event.sender.send('agent:event', {
          type: 'status',
          message: 'Command review subprocess is analyzing risk.',
          runId,
          tabId: payload?.tabId
        })
        const audit = await commandAuditor.audit({
          command,
          userInput: input,
          terminalContext: payload?.terminalContext ?? '',
          locale: payload?.locale
        })
        event.sender.send('agent:event', {
          type: 'command-review',
          command,
          audit,
          runId,
          tabId: payload?.tabId
        })
        if (!audit.requiresApproval) {
          event.sender.send('agent:event', {
            type: 'status',
            message: 'Command audit passed without user approval.',
            runId,
            tabId: payload?.tabId
          })
          return execute()
        }

        const approved = await requestCommandApproval({
          webContents: event.sender,
          runId,
          tabId: payload?.tabId,
          command,
          timeoutMs,
          audit,
          signal: controller.signal
        })

        if (!approved) {
          event.sender.send('agent:event', {
            type: 'status',
            message: 'Command rejected by user.',
            runId,
            tabId: payload?.tabId
          })
          return {
            ok: false,
            command,
            output: '',
            error:
              runLanguage === 'zh-CN'
                ? '用户已拒绝执行该命令。请基于这个结果继续处理，不要假设命令已经执行。'
                : 'Command execution was rejected by the user. Continue from this result and do not assume the command ran.'
          }
        }

        event.sender.send('agent:event', {
          type: 'status',
          message: 'Command approved by user.',
          runId,
          tabId: payload?.tabId
        })
        return execute()
      }
      const text = await runTerminalAgent(
        agentConfig,
        input,
        createMemory(),
        payload?.terminalContext ?? '',
        (agentEvent) => {
          event.sender.send('agent:event', { ...agentEvent, runId, tabId: payload?.tabId })
        },
        {
          executeCommand: async (command, timeoutMs) => {
            return executeReviewedCommand(command, timeoutMs, () =>
              executeCommandInTerminalWithPermissionRequest(
                event.sender,
                command,
                timeoutMs,
                payload?.tabId
              )
            )
          }
        },
        {
          executeCommand: async (command, options) => {
            return executeReviewedCommand(command, options.timeoutMs, () =>
              executeCommandInTemporaryTerminal(
                event.sender,
                payload?.tabId,
                options.terminalName,
                command,
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

function resolveLocalArtifactPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  const expanded = trimmed.replace(/^~(?=\/|$)/, homedir()).replace(/^\$HOME(?=\/|$)/, homedir())

  return isAbsolute(expanded) ? resolve(expanded) : resolve(homedir(), expanded)
}

function isLocalFilePermissionError(error: string | undefined): boolean {
  return /(EACCES|EPERM|Permission denied|Operation not permitted|权限不够|没有权限|操作不允许)/i.test(
    error ?? ''
  )
}

function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function resolveRunLanguage(locale: string | undefined, input: string): 'zh-CN' | 'en' {
  if (locale?.toLowerCase().startsWith('zh')) return 'zh-CN'
  if (locale?.toLowerCase().startsWith('en')) return 'en'
  return /[\u3400-\u9fff]/.test(input) ? 'zh-CN' : 'en'
}

function requestCommandApproval(input: {
  webContents: WebContents
  runId: string
  tabId?: string
  command: string
  timeoutMs?: number
  audit: CommandAuditResult
  signal?: AbortSignal
}): Promise<boolean> {
  if (input.webContents.isDestroyed()) return Promise.resolve(false)

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
    const finish = (approved: boolean): void => {
      input.signal?.removeEventListener('abort', onAbort)
      resolve(approved)
    }
    const timeout = setTimeout(
      () => {
        pendingCommandApprovals.delete(requestId)
        finish(false)
      },
      10 * 60 * 1000
    )
    const onAbort = (): void => {
      clearTimeout(timeout)
      pendingCommandApprovals.delete(requestId)
      finish(false)
    }

    pendingCommandApprovals.set(requestId, { resolve: finish, timeout })
    input.signal?.addEventListener('abort', onAbort, { once: true })
    input.webContents.send('agent:command-approval-request', request)
  })
}

function summarizeConnectionForAi(connection: ConnectionConfig): Record<string, unknown> {
  return {
    id: connection.id,
    source: connection.source,
    name: connection.name,
    host: connection.host,
    user: connection.user,
    port: connection.port,
    identityFile: connection.identityFile,
    description: connection.description,
    sshOptions: connection.sshOptions
  }
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
      reason?: unknown
    }
    const shouldConnect = parsed.shouldConnect === true
    const connectionId = typeof parsed.connectionId === 'string' ? parsed.connectionId : undefined
    const confidence = Number(parsed.confidence)
    const executeAfterLogin = parsed.executeAfterLogin === true
    const knownIds = new Set(connections.map((connection) => connection.id))
    const userGoal = typeof parsed.userGoal === 'string' ? parsed.userGoal : undefined

    if (!shouldConnect) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
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
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined
    }
  } catch {
    return { ok: false, shouldConnect: false, confidence: 0, reason: 'invalid model response' }
  }
}

function createMemory(): AgentMemory {
  return new AgentMemory(readCrescentMemory(), (nextMemory) => {
    writeCrescentMemory(nextMemory)
  })
}

async function validateModel(config: AgentConfig): Promise<void> {
  const completion = await new AgentBrain(config).chat({
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: 'Reply with OK.'
      }
    ]
  })

  const text = completion.choices[0]?.message.content?.trim()
  if (!text) throw new Error('Model returned an empty validation response.')
}

function findConnection(id: string | undefined): { id: string; name: string } | undefined {
  if (!id) return undefined

  return [...loadSshConfigConnections(), ...readCustomConnections()].find(
    (connection) => connection.id === id
  )
}
