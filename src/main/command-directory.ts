import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getCrescentDir } from './crescent-paths'
import { rendererIpc } from './ipc-security'
import {
  DEFAULT_COMMAND_CATEGORIES,
  validateCommandDirectory,
  renderCommandTemplate,
  type CommandDirectory
} from '../shared/command-directory'
import { readTerminalPlanIdentity, readTerminalExecutionTarget } from './terminal/ipc'
import { normalizeExecutionMode } from '../shared/execution-plan'
import { normalizeMutationPolicy } from '../shared/approval-policy'
import { redactSensitiveText } from '../shared/secret-redaction'
import { classifyByStaticRules } from '../shared/command-guard'
import { executeReviewedPtyCommand } from './agent/pi-terminal-bash'
import { readAgentConfig } from './crescent-store'
import { safeWebContentsSend } from './safe-ipc-send'
let mutations: Promise<unknown> = Promise.resolve()
const directoryPath = (): string => join(getCrescentDir(), 'command-directory.json')
async function requireRegular(path: string): Promise<void> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('Command directory must be a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
export async function readCommandDirectory(): Promise<CommandDirectory> {
  await requireRegular(directoryPath())
  try {
    return validateCommandDirectory(JSON.parse(await readFile(directoryPath(), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, revision: 0, categories: DEFAULT_COMMAND_CATEGORIES, entries: [] }
    throw error
  }
}
export function writeCommandDirectory(value: unknown): Promise<CommandDirectory> {
  const next = validateCommandDirectory(value)
  const task = mutations
    .catch(() => {})
    .then(async () => {
      const current = await readCommandDirectory()
      if (next.revision !== current.revision)
        throw new Error('Directory changed in another window; reload before saving')
      await mkdir(getCrescentDir(), { recursive: true, mode: 0o700 })
      await requireRegular(directoryPath())
      const revision = current.revision + 1
      // One previous snapshot for undo; credentials are never stored here.
      await requireRegular(`${directoryPath()}.previous`)
      await writeFile(`${directoryPath()}.previous`, JSON.stringify(current), {
        mode: 0o600,
        flag: 'w'
      })
      const temporary = `${directoryPath()}.${randomUUID()}`
      await writeFile(temporary, JSON.stringify({ ...next, revision }), { mode: 0o600, flag: 'wx' })
      await rename(temporary, directoryPath())
      return { ...next, revision }
    })
  mutations = task
  return task
}
const activeReviews = new Map<string, AbortController>()
export function registerCommandDirectoryIpc(): void {
  rendererIpc.handle('commands:cancel', (event, tabId: unknown) => {
    if (typeof tabId === 'string') activeReviews.get(`${event.sender.id}:${tabId}`)?.abort()
    return { ok: true }
  })
  rendererIpc.handle('commands:list', () => readCommandDirectory())
  rendererIpc.handle('commands:save', (_event, value) => writeCommandDirectory(value))
  rendererIpc.handle('commands:undo', async () => {
    await requireRegular(`${directoryPath()}.previous`)
    const previous = validateCommandDirectory(
      JSON.parse(await readFile(`${directoryPath()}.previous`, 'utf8'))
    )
    return writeCommandDirectory({ ...previous, revision: (await readCommandDirectory()).revision })
  })
  rendererIpc.handle(
    'commands:preview',
    async (event, payload: { entryId: string; values: Record<string, string>; tabId: string }) => {
      const entry = (await readCommandDirectory()).entries.find(
        (item) => item.id === payload?.entryId
      )
      if (
        !entry ||
        typeof payload.tabId !== 'string' ||
        !payload.values ||
        typeof payload.values !== 'object'
      )
        throw new Error('Invalid command selection')
      const target = readTerminalExecutionTarget(event.sender.id, payload.tabId)
      if (entry.scope !== 'global' && entry.scopeId !== target.connectionId)
        throw new Error('Template scope does not match this target connection ID')
      const command = renderCommandTemplate(entry, payload.values)
      const binding = readTerminalPlanIdentity(event.sender.id, payload.tabId)
      if (!binding) throw new Error('Target is unverified')
      return {
        command,
        binding,
        target: readTerminalExecutionTarget(event.sender.id, payload.tabId),
        risk: classifyByStaticRules(command)
      }
    }
  )
  rendererIpc.handle(
    'commands:execute',
    async (
      event,
      payload: {
        entryId: string
        values: Record<string, string>
        tabId: string
        binding: string
        command: string
        chatTabId: string
        executionMode?: unknown
        mutationPolicy?: unknown
      }
    ) => {
      const entry = (await readCommandDirectory()).entries.find(
        (item) => item.id === payload?.entryId
      )
      if (
        !entry ||
        !payload.binding ||
        !payload.values ||
        typeof payload.tabId !== 'string' ||
        typeof payload.chatTabId !== 'string'
      )
        throw new Error('Invalid execution request')
      const target = readTerminalExecutionTarget(event.sender.id, payload.tabId)
      if (entry.scope !== 'global' && entry.scopeId !== target.connectionId)
        throw new Error('Template scope does not match this target connection ID')
      const command = renderCommandTemplate(entry, payload.values)
      if (
        command !== payload.command ||
        readTerminalPlanIdentity(event.sender.id, payload.tabId) !== payload.binding
      )
        throw new Error('Command or target changed; preview again')
      const key = `${event.sender.id}:${payload.tabId}`
      if (activeReviews.has(key)) throw new Error('A review is already active for this terminal')
      const controller = new AbortController()
      activeReviews.set(key, controller)
      const abort = (): void => controller.abort()
      event.sender.once('destroyed', abort)
      event.sender.once('did-start-navigation', abort)
      try {
        const result = await executeReviewedPtyCommand({
          sessionKey: `catalog:${key}`,
          command,
          signal: controller.signal,
          context: {
            webContents: event.sender,
            executionTabId: payload.tabId,
            executionTargetIdentity: payload.binding,
            chatTabId: payload.chatTabId,
            runId: `catalog-${randomUUID()}`,
            userInput: 'User selected review and execute for this exact template and target.',
            config: readAgentConfig(),
            executionMode: normalizeExecutionMode(payload.executionMode),
            mutationPolicy: normalizeMutationPolicy(payload.mutationPolicy),
            isSsh:
              readTerminalExecutionTarget(event.sender.id, payload.tabId).executionMode === 'ssh',
            emit: (message) => safeWebContentsSend(event.sender, 'agent:event', message)
          }
        })
        return {
          ...result,
          output: redactSensitiveText(result.output),
          error: result.error ? redactSensitiveText(result.error) : undefined
        }
      } finally {
        activeReviews.delete(key)
        event.sender.removeListener('destroyed', abort)
        event.sender.removeListener('did-start-navigation', abort)
      }
    }
  )
}
