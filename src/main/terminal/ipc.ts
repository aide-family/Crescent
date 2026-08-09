import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron'
import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import { dirname, resolve } from 'path'
import { homedir, hostname, userInfo } from 'os'
import { spawn as spawnPty } from 'node-pty'

import { safeWebContentsSend } from '../safe-ipc-send'
import { resolveShellLaunchConfig } from './shell'
import { hasUnterminatedSecretPrompt } from '../../shared/terminal-password-prompt'
import { createPendingCommandController } from './pending-command'

interface TerminalSession {
  id: number
  mode: 'pty' | 'pipe'
  pid: number
  cwd: string
  shell: string
  write: (data: string) => void
  display: (data: string) => void
  interrupt: () => void
  resize: (cols: number, rows: number) => void
  clear: () => void
  kill: () => void
}

interface TerminalExitNotification {
  exitCode: number
  signal?: number | string
}

export interface TerminalAutomationFilterState {
  startMarker: string
  endMarker: string
  phase: 'before-start' | 'body'
  pending: string
}

export interface TerminalCommandExecutionResult {
  ok: boolean
  command: string
  mode?: 'pty' | 'pipe'
  cwd?: string
  exitCode?: number
  output: string
  error?: string
  timedOut?: boolean
  interrupted?: boolean
  terminalExited?: boolean
  detached?: boolean
  subterminalName?: string
  subterminalTabId?: string
}

export interface TemporarySubterminalOpenOptions {
  cols?: number
  rows?: number
  initialCommand?: string
}

export interface TemporarySubterminalOpenResult {
  ok: boolean
  name?: string
  tabId?: string
  sessionId?: number
  mode?: 'pty' | 'pipe'
  pid?: number
  shell?: string
  cwd?: string
  error?: string
}

export interface TemporarySubterminalSnapshot {
  ok: boolean
  name: string
  tabId: string
  mode: 'pty' | 'pipe' | 'none'
  cwd: string
  shell: string
  output: string
  busy: boolean
  detached: boolean
  error?: string
}

interface TemporarySubterminalEntry {
  name: string
  tabId: string
  busy: boolean
  detached: boolean
  lastUsedAt: number
}

const sessions = new Map<string, TerminalSession>()
let nextSessionId = 1
const PIPE_PROMPT_PREFIX = '__TERMINAL_AGENT_PROMPT__'
const MAX_CONTEXT_BUFFER = 24_000
const TERMINAL_COMMAND_TIMEOUT_MS = 600_000
const TERMINAL_COMMAND_MIN_TIMEOUT_MS = 5_000
const TERMINAL_COMMAND_MAX_TIMEOUT_MS = 600_000
const TERMINAL_COMMAND_INTERRUPT_GRACE_MS = 2_000
const TERMINAL_COMMAND_START_TIMEOUT_MS = 8_000
const TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS = 5_000
/** Extra wait window while sudo/SSH/OTP secret prompts are visible for the user. */
const TERMINAL_COMMAND_SECRET_PROMPT_TIMEOUT_MS = 300_000
const terminalOutputBuffers = new Map<string, string>()
const terminalDataWaiters = new Map<string, Set<(data: string) => void>>()
const terminalExitWaiters = new Map<string, Set<(event: TerminalExitNotification) => void>>()
const terminalUserInterruptNotifiers = new Map<string, Set<() => void>>()
/** In-flight automated command waiters (Stop / Ctrl+C can await settle). */
const pendingCommandPromises = new Map<string, Promise<TerminalCommandExecutionResult>>()
const terminalAutomationFilterStates = new Map<string, TerminalAutomationFilterState>()
const MAX_TEMPORARY_SUBTERMINALS = 3
const temporarySubterminals = new Map<string, TemporarySubterminalEntry[]>()

export function executeCommandInTerminal(
  senderId: number,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  tabId?: string,
  signal?: AbortSignal
): Promise<TerminalCommandExecutionResult> {
  const normalizedTabId = normalizeTabId(tabId)
  const normalizedCommand = command.trim()
  if (!normalizedTabId) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      error: 'Missing terminal tab id. Refusing to execute on a shared default terminal.'
    })
  }
  if (!isUsableTerminalTabId(normalizedTabId)) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      error: `Reserved terminal tab id "${normalizedTabId}" is not allowed. Use a unique tabId.`
    })
  }
  const key = getSessionKey(senderId, normalizedTabId)
  const session = sessions.get(key)
  const effectiveTimeoutMs = normalizeCommandTimeout(timeoutMs)

  if (!session) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      error: 'No active terminal session.'
    })
  }

  if (!normalizedCommand) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error: 'Command is empty.'
    })
  }

  if (session.mode === 'pipe' && isInteractiveCommand(normalizedCommand)) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error:
        'Interactive commands such as ssh require PTY mode. Current terminal is pipe fallback, so this command was blocked to avoid corrupting password input. Restart the app or rebuild node-pty.'
    })
  }

  const commandId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const startMarker = `__CRESCENT_CMD_START_${commandId}__`
  const endMarker = `__CRESCENT_CMD_END_${commandId}__`

  const pending = createPendingCommandController({
    command: normalizedCommand,
    mode: session.mode,
    cwd: session.cwd,
    startMarker,
    endMarker,
    timeoutMs: effectiveTimeoutMs,
    signal,
    interruptGraceMs: TERMINAL_COMMAND_INTERRUPT_GRACE_MS,
    startTimeoutMs: TERMINAL_COMMAND_START_TIMEOUT_MS,
    continuationPromptTimeoutMs: TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS,
    secretPromptTimeoutMs: TERMINAL_COMMAND_SECRET_PROMPT_TIMEOUT_MS,
    interruptSession: () => interruptCommandSession(key, session),
    display: (message) => session.display(message),
    hasUnterminatedSecretPrompt,
    hasShellContinuationPrompt,
    parseCommandBuffer,
    extractPartialCommandOutput
  })

  const onData = (data: string): void => {
    pending.onData(data)
  }
  const onExit = (event: TerminalExitNotification): void => {
    pending.onExit(event)
  }
  const onUserInterrupt = (): void => {
    pending.notifyUserInterrupt()
  }

  const waiters = terminalDataWaiters.get(key) ?? new Set<(data: string) => void>()
  waiters.add(onData)
  terminalDataWaiters.set(key, waiters)
  const exitWaiters =
    terminalExitWaiters.get(key) ?? new Set<(event: TerminalExitNotification) => void>()
  exitWaiters.add(onExit)
  terminalExitWaiters.set(key, exitWaiters)
  const interruptNotifiers = terminalUserInterruptNotifiers.get(key) ?? new Set<() => void>()
  interruptNotifiers.add(onUserInterrupt)
  terminalUserInterruptNotifiers.set(key, interruptNotifiers)

  pendingCommandPromises.set(key, pending.promise)

  void pending.promise.finally(() => {
    if (pendingCommandPromises.get(key) === pending.promise) {
      pendingCommandPromises.delete(key)
    }
    const dataWaiters = terminalDataWaiters.get(key)
    dataWaiters?.delete(onData)
    if (dataWaiters?.size === 0) terminalDataWaiters.delete(key)
    const exits = terminalExitWaiters.get(key)
    exits?.delete(onExit)
    if (exits?.size === 0) terminalExitWaiters.delete(key)
    const interrupts = terminalUserInterruptNotifiers.get(key)
    interrupts?.delete(onUserInterrupt)
    if (interrupts?.size === 0) terminalUserInterruptNotifiers.delete(key)
    terminalAutomationFilterStates.delete(key)
  })

  void pending.promise.then((result) => {
    const readableResult = formatReadableCommandResult(result)
    if (readableResult) session.display(readableResult)
  })

  if (session.mode === 'pty') {
    terminalAutomationFilterStates.set(key, {
      startMarker,
      endMarker,
      phase: 'before-start',
      pending: ''
    })
    session.display(formatReadableCommandInput(normalizedCommand))
    session.write(
      createPtyScriptRunner(createCommandWrapper(normalizedCommand, startMarker, endMarker))
    )
  } else {
    session.display(formatReadableCommandInput(normalizedCommand))
    session.write(`${createCommandWrapper(normalizedCommand, startMarker, endMarker)}\n`)
  }

  return pending.promise
}

/** Interrupt any in-flight automated command on a tab (Ctrl+C + settle interrupted). */
export function interruptPendingTerminalCommands(senderId: number, tabId?: string): boolean {
  const normalizedTabId = normalizeTabId(tabId)
  if (!normalizedTabId) return false
  const key = getSessionKey(senderId, normalizedTabId)
  const session = sessions.get(key)
  if (!session) return false
  interruptCommandSession(key, session)
  const notifiers = terminalUserInterruptNotifiers.get(key)
  if (!notifiers || notifiers.size === 0) return false
  ;[...notifiers].forEach((notify) => notify())
  return true
}

/**
 * Interrupt in-flight automated commands and wait until the pending waiter settles.
 * Callers that emit agent `command/finished` after the waiter can then flush before run abort.
 */
export async function interruptAndAwaitPendingTerminalCommands(
  senderId: number,
  tabId?: string
): Promise<boolean> {
  const normalizedTabId = normalizeTabId(tabId)
  if (!normalizedTabId) return false
  const key = getSessionKey(senderId, normalizedTabId)
  const pending = pendingCommandPromises.get(key)
  const interrupted = interruptPendingTerminalCommands(senderId, normalizedTabId)
  if (pending) {
    try {
      await pending
    } catch {
      // settle errors are surfaced via the command result / agent emit path
    }
  }
  return interrupted || Boolean(pending)
}

export async function executeCommandInTerminalWithPermissionRequest(
  webContents: WebContents,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  tabId?: string,
  signal?: AbortSignal
): Promise<TerminalCommandExecutionResult> {
  let result = await executeCommandInTerminal(webContents.id, command, timeoutMs, tabId, signal)

  if (isLocalFilePermissionFailure(result)) {
    result = await requestLocalFileAccessAndAnnotateResult(webContents, command, result)
  }

  return result
}

export async function executeCommandInTemporaryTerminal(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  mode: 'wait' | 'detach' = 'wait',
  signal?: AbortSignal
): Promise<TerminalCommandExecutionResult> {
  const parent = normalizeTabId(parentTabId)
  const normalizedCommand = command.trim()
  if (!parent) {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: 'Missing parent terminal tab id for temporary sub-terminal.'
    }
  }
  const name = normalizeTemporaryTerminalName(terminalName)
  const slot = ensureTemporarySubterminal(webContents, parent, name)

  if (!slot.ok) {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: slot.error
    }
  }

  const entry = slot.entry
  if (entry.busy) {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: `Temporary sub-terminal "${name}" is already running a command.`
    }
  }
  if (entry.detached && mode === 'wait') {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: `Temporary sub-terminal "${name}" is running a detached watch command. Interrupt it first, or use mode=detach only after clearing the pane.`,
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  if (mode === 'detach') {
    return executeDetachedCommandInTemporaryTerminal(webContents, entry, name, normalizedCommand)
  }

  entry.busy = true
  entry.lastUsedAt = Date.now()

  try {
    let result = await executeCommandInTerminal(
      webContents.id,
      command,
      timeoutMs,
      entry.tabId,
      signal
    )

    if (isLocalFilePermissionFailure(result)) {
      result = await requestLocalFileAccessAndAnnotateResult(webContents, command, result)
    }

    return {
      ...result,
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  } finally {
    entry.busy = false
    entry.lastUsedAt = Date.now()
  }
}

export function openTemporarySubterminal(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string,
  options?: TemporarySubterminalOpenOptions
): TemporarySubterminalOpenResult {
  const parent = normalizeTabId(parentTabId)
  if (!parent) {
    return { ok: false, error: 'Missing parent terminal tab id for temporary sub-terminal.' }
  }

  const name = normalizeTemporaryTerminalName(terminalName)
  const slot = ensureTemporarySubterminal(webContents, parent, name, options)
  if (!slot.ok) return { ok: false, error: slot.error }

  const key = getSessionKey(webContents.id, slot.entry.tabId)
  const session = sessions.get(key)
  if (!session) {
    return {
      ok: false,
      name,
      tabId: slot.entry.tabId,
      error: 'Failed to start temporary sub-terminal session.'
    }
  }

  return {
    ok: true,
    name,
    tabId: slot.entry.tabId,
    sessionId: session.id,
    mode: session.mode,
    pid: session.pid,
    shell: session.shell,
    cwd: session.cwd
  }
}

export function readTemporarySubterminalOutput(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string,
  maxChars = 12_000
): TemporarySubterminalSnapshot {
  const parent = normalizeTabId(parentTabId)
  const name = normalizeTemporaryTerminalName(terminalName)
  if (!parent) {
    return {
      ok: false,
      name,
      tabId: '',
      mode: 'none',
      cwd: '',
      shell: '',
      output: '',
      busy: false,
      detached: false,
      error: 'Missing parent terminal tab id for temporary sub-terminal.'
    }
  }

  const poolKey = getSessionKey(webContents.id, parent)
  const entry = (temporarySubterminals.get(poolKey) ?? []).find((item) => item.name === name)
  if (!entry) {
    return {
      ok: false,
      name,
      tabId: createTemporarySubterminalTabId(parent, name),
      mode: 'none',
      cwd: '',
      shell: '',
      output: '',
      busy: false,
      detached: false,
      error: `Temporary sub-terminal "${name}" is not open.`
    }
  }

  const key = getSessionKey(webContents.id, entry.tabId)
  const session = sessions.get(key)
  const output = (terminalOutputBuffers.get(key) ?? '').slice(-Math.max(1_000, maxChars))

  return {
    ok: true,
    name,
    tabId: entry.tabId,
    mode: session?.mode ?? 'none',
    cwd: session?.cwd ?? '',
    shell: session?.shell ?? '',
    output,
    busy: entry.busy,
    detached: entry.detached
  }
}

export function interruptTemporarySubterminal(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string
): { ok: boolean; name: string; tabId?: string; error?: string } {
  const parent = normalizeTabId(parentTabId)
  const name = normalizeTemporaryTerminalName(terminalName)
  if (!parent) {
    return { ok: false, name, error: 'Missing parent terminal tab id for temporary sub-terminal.' }
  }

  const poolKey = getSessionKey(webContents.id, parent)
  const entry = (temporarySubterminals.get(poolKey) ?? []).find((item) => item.name === name)
  if (!entry) {
    return { ok: false, name, error: `Temporary sub-terminal "${name}" is not open.` }
  }

  const key = getSessionKey(webContents.id, entry.tabId)
  const session = sessions.get(key)
  if (!session) {
    entry.detached = false
    entry.busy = false
    return {
      ok: false,
      name,
      tabId: entry.tabId,
      error: 'No active terminal session for this sub-terminal.'
    }
  }

  interruptCommandSession(key, session)
  entry.detached = false
  entry.lastUsedAt = Date.now()
  return { ok: true, name, tabId: entry.tabId }
}

function executeDetachedCommandInTemporaryTerminal(
  webContents: WebContents,
  entry: TemporarySubterminalEntry,
  name: string,
  command: string
): TerminalCommandExecutionResult {
  const key = getSessionKey(webContents.id, entry.tabId)
  const session = sessions.get(key)
  if (!session) {
    return {
      ok: false,
      command,
      output: '',
      error: 'No active terminal session.',
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  if (!command) {
    return {
      ok: false,
      command,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error: 'Command is empty.',
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  if (session.mode === 'pipe' && isInteractiveCommand(command)) {
    return {
      ok: false,
      command,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error:
        'Interactive commands such as ssh require PTY mode. Current terminal is pipe fallback, so this command was blocked to avoid corrupting password input. Restart the app or rebuild node-pty.',
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  entry.detached = true
  entry.lastUsedAt = Date.now()
  session.display(formatReadableCommandInput(command))
  session.write(session.mode === 'pty' ? `${command}\r` : `${command}\n`)

  return {
    ok: true,
    command,
    mode: session.mode,
    cwd: session.cwd,
    output: '',
    detached: true,
    subterminalName: name,
    subterminalTabId: entry.tabId
  }
}

async function requestLocalFileAccessAndAnnotateResult(
  webContents: WebContents,
  command: string,
  result: TerminalCommandExecutionResult
): Promise<TerminalCommandExecutionResult> {
  const defaultPath = extractLikelyLocalDirectory(command)
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const options: OpenDialogOptions = {
    title: 'Authorize local folder access',
    message:
      'Crescent could not access a local folder used by this command. Select the target folder to grant access, then retry the operation.',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  const note = selection.canceled
    ? 'Local folder access was not granted. Please grant access to the target folder and retry.'
    : `Local folder access was requested for: ${selection.filePaths[0]}. Retry the command after authorization.`

  return {
    ...result,
    error: [result.error, note].filter(Boolean).join('\n'),
    output: [result.output, note].filter(Boolean).join('\n')
  }
}

function isLocalFilePermissionFailure(result: TerminalCommandExecutionResult): boolean {
  const text = `${result.error ?? ''}\n${result.output}`

  return !result.ok && /(EACCES|EPERM|Permission denied|Operation not permitted)/i.test(text)
}

function extractLikelyLocalDirectory(command: string): string | undefined {
  const candidates = [
    command.match(/\$HOME\/([^\s'"<>|;&]+)/)?.[1],
    command.match(/~\/([^\s'"<>|;&]+)/)?.[1],
    command
      .match(/Path\.home\(\)\s*\/\s*['"]([^'"]+)['"]\s*\/\s*['"]([^'"]+)['"]/)
      ?.slice(1)
      .join('/'),
    command.match(/["'](\/[^"']+)["']/)?.[1]
  ].filter((value): value is string => Boolean(value))

  const candidate = candidates[0]
  if (!candidate) return undefined

  const expanded = candidate.startsWith('/')
    ? candidate
    : resolve(homedir(), candidate.replace(/^~\//, ''))

  return /\.[A-Za-z0-9]{1,8}$/.test(expanded) ? dirname(expanded) : expanded
}

export function registerTerminalIpc(): void {
  ipcMain.handle(
    'terminal:start',
    (
      event,
      options?: { cols?: number; rows?: number; tabId?: string; initialCommand?: string }
    ) => {
      const senderId = event.sender.id
      const tabId = normalizeTabId(options?.tabId)
      if (!isUsableTerminalTabId(tabId)) {
        throw new Error(
          'Missing or reserved terminal tab id. Each terminal session requires a unique tabId.'
        )
      }
      const key = getSessionKey(senderId, tabId)
      stopSession(key)

      const launchConfig = resolveShellLaunchConfig()
      const sessionId = nextSessionId
      nextSessionId += 1
      const session = createTerminalSession({
        sessionId,
        shell: launchConfig.shell,
        args: resolveTerminalArgs(launchConfig.args, options?.initialCommand),
        cwd: launchConfig.cwd,
        env: launchConfig.env,
        cols: sanitizeDimension(options?.cols, 80),
        rows: sanitizeDimension(options?.rows, 24),
        webContents: event.sender,
        tabId,
        key
      })

      terminalOutputBuffers.set(key, '')
      terminalAutomationFilterStates.delete(key)
      sessions.set(key, session)

      return {
        sessionId: session.id,
        tabId,
        mode: session.mode,
        pid: session.pid,
        shell: launchConfig.shell,
        cwd: launchConfig.cwd
      }
    }
  )

  ipcMain.handle(
    'terminal:open-subterminal',
    (
      event,
      options?: {
        parentTabId?: string
        terminalName?: string
        cols?: number
        rows?: number
        initialCommand?: string
      }
    ) => {
      return openTemporarySubterminal(
        event.sender,
        options?.parentTabId,
        options?.terminalName ?? '',
        {
          cols: options?.cols,
          rows: options?.rows,
          initialCommand: options?.initialCommand
        }
      )
    }
  )

  ipcMain.handle(
    'terminal:read-subterminal',
    (event, options?: { parentTabId?: string; terminalName?: string; maxChars?: number }) => {
      return readTemporarySubterminalOutput(
        event.sender,
        options?.parentTabId,
        options?.terminalName ?? '',
        options?.maxChars
      )
    }
  )

  ipcMain.handle(
    'terminal:interrupt-subterminal',
    (event, options?: { parentTabId?: string; terminalName?: string }) => {
      return interruptTemporarySubterminal(
        event.sender,
        options?.parentTabId,
        options?.terminalName ?? ''
      )
    }
  )

  ipcMain.on('terminal:write', (event, payload: { data?: string; tabId?: string } | string) => {
    const data = typeof payload === 'string' ? payload : payload?.data
    if (typeof data !== 'string') return

    const tabId = normalizeTabId(typeof payload === 'string' ? undefined : payload?.tabId)
    if (!tabId) return
    const session = sessions.get(getSessionKey(event.sender.id, tabId))
    if (!session) {
      sendIfAlive(
        event.sender,
        tabId,
        getSessionKey(event.sender.id, tabId),
        'terminal:data',
        '\r\n\x1b[31mTerminal session is not active. Command input was blocked.\x1b[0m\r\n'
      )
      return
    }

    if (session.mode === 'pipe' && isInteractiveCommand(data)) {
      sendIfAlive(
        event.sender,
        tabId,
        getSessionKey(event.sender.id, tabId),
        'terminal:data',
        '\r\n\x1b[31mInteractive commands such as ssh require PTY mode. Current terminal is pipe fallback, so this command was blocked to avoid corrupting password input. Restart the app or rebuild node-pty.\x1b[0m\r\n'
      )
      return
    }

    session.write(data)
    if (data.includes('\x03')) {
      clearTemporarySubterminalDetached(event.sender.id, tabId)
      const key = getSessionKey(event.sender.id, tabId)
      const notifiers = terminalUserInterruptNotifiers.get(key)
      if (notifiers) {
        ;[...notifiers].forEach((notify) => notify())
      }
    }
  })

  ipcMain.on(
    'terminal:paste-command',
    (event, payload: { command?: string; execute?: boolean; tabId?: string }) => {
      const command = sanitizeCommand(payload?.command)
      if (!command) return

      const tabId = normalizeTabId(payload?.tabId)
      if (!tabId) return
      const key = getSessionKey(event.sender.id, tabId)
      const session = sessions.get(key)
      if (!session) {
        sendIfAlive(
          event.sender,
          tabId,
          key,
          'terminal:data',
          '\r\n\x1b[31mTerminal session is not active. Command paste was blocked.\x1b[0m\r\n'
        )
        return
      }

      if (!payload?.execute && session.mode === 'pipe') {
        sendIfAlive(
          event.sender,
          tabId,
          key,
          'terminal:data',
          '\r\n\x1b[33mPipe fallback cannot paste without executing. Press Run SSH/Execute instead.\x1b[0m\r\n'
        )
        return
      }

      if (session.mode === 'pipe' && isInteractiveCommand(command)) {
        sendIfAlive(
          event.sender,
          tabId,
          key,
          'terminal:data',
          '\r\n\x1b[31mSSH and other interactive commands require PTY mode. Current terminal is pipe fallback; command not executed.\x1b[0m\r\n'
        )
        return
      }

      session.write(`${command}${payload?.execute ? '\r' : ''}`)
    }
  )

  ipcMain.handle('terminal:get-context', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) {
      return { mode: 'none', output: '', cwd: '', shell: '' }
    }
    const key = getSessionKey(event.sender.id, tabId)
    const session = sessions.get(key)
    if (!session) {
      return { mode: 'none', output: terminalOutputBuffers.get(key) ?? '', cwd: '', shell: '' }
    }

    return {
      mode: session.mode,
      pid: session.pid,
      cwd: session.cwd,
      shell: session.shell,
      output: terminalOutputBuffers.get(key) ?? ''
    }
  })

  ipcMain.on(
    'terminal:resize',
    (event, dimensions: { cols?: number; rows?: number; tabId?: string }) => {
      const tabId = normalizeTabId(dimensions?.tabId)
      if (!tabId) return
      const session = sessions.get(getSessionKey(event.sender.id, tabId))
      if (!session) return

      session.resize(
        sanitizeDimension(dimensions?.cols, 80),
        sanitizeDimension(dimensions?.rows, 24)
      )
    }
  )

  ipcMain.on('terminal:stop', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) return
    stopSession(getSessionKey(event.sender.id, tabId))
    releaseTemporarySubterminalByTabId(event.sender.id, tabId)
  })

  ipcMain.on('terminal:clear', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) return
    sessions.get(getSessionKey(event.sender.id, tabId))?.clear()
  })
}

export function stopAllTerminalSessions(): void {
  for (const key of sessions.keys()) {
    stopSession(key)
  }
  temporarySubterminals.clear()
}

function stopSession(key: string): void {
  const session = sessions.get(key)
  if (!session) return

  session.kill()
  sessions.delete(key)
  terminalDataWaiters.delete(key)
  terminalExitWaiters.delete(key)
  terminalOutputBuffers.delete(key)
  terminalAutomationFilterStates.delete(key)
}

function ensureTemporarySubterminal(
  webContents: WebContents,
  parentTabId: string,
  terminalName: string,
  options?: TemporarySubterminalOpenOptions
): { ok: true; entry: TemporarySubterminalEntry } | { ok: false; error: string } {
  const poolKey = getSessionKey(webContents.id, parentTabId)
  const pool = temporarySubterminals.get(poolKey) ?? []
  const existing = pool.find((entry) => entry.name === terminalName)

  if (existing) {
    if (!sessions.has(getSessionKey(webContents.id, existing.tabId))) {
      startTemporaryTerminalSession(webContents, existing.tabId, options)
      existing.detached = false
      existing.busy = false
    }
    existing.lastUsedAt = Date.now()
    return { ok: true, entry: existing }
  }

  if (pool.length >= MAX_TEMPORARY_SUBTERMINALS) {
    return {
      ok: false,
      error: `At most ${MAX_TEMPORARY_SUBTERMINALS} temporary sub-terminals can run under one terminal. Reuse one of: ${pool
        .map((entry) => entry.name)
        .join(', ')}.`
    }
  }

  const entry: TemporarySubterminalEntry = {
    name: terminalName,
    tabId: createTemporarySubterminalTabId(parentTabId, terminalName),
    busy: false,
    detached: false,
    lastUsedAt: Date.now()
  }
  pool.push(entry)
  temporarySubterminals.set(poolKey, pool)
  startTemporaryTerminalSession(webContents, entry.tabId, options)

  return { ok: true, entry }
}

function startTemporaryTerminalSession(
  webContents: WebContents,
  tabId: string,
  options?: TemporarySubterminalOpenOptions
): void {
  const key = getSessionKey(webContents.id, tabId)
  stopSession(key)

  const launchConfig = resolveShellLaunchConfig()
  const sessionId = nextSessionId
  nextSessionId += 1
  const session = createTerminalSession({
    sessionId,
    shell: launchConfig.shell,
    args: resolveTerminalArgs(launchConfig.args, options?.initialCommand),
    cwd: launchConfig.cwd,
    env: launchConfig.env,
    cols: sanitizeDimension(options?.cols, 100),
    rows: sanitizeDimension(options?.rows, 24),
    webContents,
    tabId,
    key
  })

  terminalOutputBuffers.set(key, '')
  terminalAutomationFilterStates.delete(key)
  sessions.set(key, session)
}

function releaseTemporarySubterminalByTabId(senderId: number, tabId: string): void {
  const parsed = parseTemporarySubterminalTabId(tabId)
  if (!parsed) return

  const poolKey = getSessionKey(senderId, parsed.parentTabId)
  const pool = temporarySubterminals.get(poolKey)
  if (!pool) return

  const next = pool.filter((entry) => entry.tabId !== tabId)
  if (next.length === 0) temporarySubterminals.delete(poolKey)
  else temporarySubterminals.set(poolKey, next)
}

function clearTemporarySubterminalDetached(senderId: number, tabId: string): void {
  const parsed = parseTemporarySubterminalTabId(tabId)
  if (!parsed) return

  const poolKey = getSessionKey(senderId, parsed.parentTabId)
  const entry = (temporarySubterminals.get(poolKey) ?? []).find((item) => item.tabId === tabId)
  if (!entry) return
  entry.detached = false
  entry.lastUsedAt = Date.now()
}

function normalizeTemporaryTerminalName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, '-').slice(0, 40)

  return normalized || 'temporary'
}

function createTemporarySubterminalTabId(parentTabId: string, terminalName: string): string {
  return `${parentTabId}::subterminal::${encodeURIComponent(terminalName)}`
}

function parseTemporarySubterminalTabId(
  tabId: string
): { parentTabId: string; name: string } | undefined {
  const marker = '::subterminal::'
  const markerIndex = tabId.indexOf(marker)
  if (markerIndex === -1) return undefined

  const parentTabId = tabId.slice(0, markerIndex)
  const encodedName = tabId.slice(markerIndex + marker.length)
  try {
    return { parentTabId, name: decodeURIComponent(encodedName) }
  } catch {
    return { parentTabId, name: encodedName }
  }
}

function createTerminalSession(input: {
  sessionId: number
  shell: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
  webContents: WebContents
  tabId: string
  key: string
}): TerminalSession {
  try {
    return createPtySession(input)
  } catch (error) {
    sendIfAlive(
      input.webContents,
      input.tabId,
      input.key,
      'terminal:data',
      `\r\n\x1b[33mPTY unavailable (${error instanceof Error ? error.message : String(error)}). Falling back to shell pipes.\x1b[0m\r\n`
    )
    return createPipeSession(input)
  }
}

function resolveTerminalArgs(defaultArgs: string[], initialCommand: string | undefined): string[] {
  const command = initialCommand?.trim()
  if (!command) return defaultArgs

  return process.platform === 'win32' ? [command] : ['-lc', command]
}

function createPtySession(input: {
  sessionId: number
  shell: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
  webContents: WebContents
  tabId: string
  key: string
}): TerminalSession {
  const pty = spawnPty(input.shell, input.args, {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env
  })
  const dataDisposable = pty.onData((data) => {
    sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:data', data)
  })
  const exitDisposable = pty.onExit(({ exitCode, signal }) => {
    notifyTerminalExit(input.key, { exitCode, signal })
    sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:exit', {
      tabId: input.tabId,
      sessionId: input.sessionId,
      exitCode,
      signal
    })
    deleteIfCurrent(input.key, input.sessionId)
  })

  return {
    id: input.sessionId,
    mode: 'pty',
    pid: pty.pid,
    cwd: input.cwd,
    shell: input.shell,
    write: (data) => pty.write(data),
    display: (data) => sendVisibleTerminalData(input.webContents, input.tabId, input.key, data),
    interrupt: () => pty.write('\x03'),
    resize: (cols, rows) => pty.resize(cols, rows),
    clear: () => pty.clear(),
    kill: () => {
      dataDisposable.dispose()
      exitDisposable.dispose()
      pty.kill()
    }
  }
}

function createPipeSession(input: {
  sessionId: number
  shell: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  webContents: WebContents
  tabId: string
  key: string
}): TerminalSession {
  const shell = process.platform === 'win32' ? input.shell : '/bin/sh'
  const args = process.platform === 'win32' ? input.args : []
  const child = spawnProcess(shell, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: 'pipe'
  }) as ChildProcessWithoutNullStreams
  let currentCwd = input.cwd
  let stdoutBuffer = ''

  child.stdout.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith(PIPE_PROMPT_PREFIX)) {
        currentCwd = line.slice(PIPE_PROMPT_PREFIX.length) || currentCwd
        const session = sessions.get(input.key)
        if (session) session.cwd = currentCwd
        sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:prompt', {
          tabId: input.tabId,
          cwd: currentCwd,
          prompt: formatPipePrompt(currentCwd)
        })
      } else {
        sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:data', `${line}\r\n`)
      }
    }
  })
  child.stderr.on('data', (data: Buffer) => {
    sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:data', data.toString())
  })
  child.on('exit', (exitCode, signal) => {
    notifyTerminalExit(input.key, {
      exitCode: exitCode ?? 0,
      signal: signal ?? undefined
    })
    sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:exit', {
      tabId: input.tabId,
      sessionId: input.sessionId,
      exitCode: exitCode ?? 0,
      signal: signal ?? undefined
    })
    deleteIfCurrent(input.key, input.sessionId)
  })
  sendIfAlive(
    input.webContents,
    input.tabId,
    input.key,
    'terminal:data',
    '\x1b[33mLine-mode shell fallback active.\x1b[0m\r\n'
  )
  sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:prompt', {
    tabId: input.tabId,
    cwd: currentCwd,
    prompt: formatPipePrompt(currentCwd)
  })

  return {
    id: input.sessionId,
    mode: 'pipe',
    pid: child.pid ?? -1,
    cwd: currentCwd,
    shell,
    display: (data) => sendVisibleTerminalData(input.webContents, input.tabId, input.key, data),
    interrupt: () => interruptPipeProcess(child),
    write: (data) => {
      const command = data.replace(/\r?\n$/, '')

      if (!command.trim()) {
        sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:prompt', {
          tabId: input.tabId,
          cwd: currentCwd,
          prompt: formatPipePrompt(currentCwd)
        })
        return
      }

      child.stdin.write(`${command}\nprintf '\\n${PIPE_PROMPT_PREFIX}%s\\n' "$PWD"\n`)
    },
    resize: () => undefined,
    clear: () => undefined,
    kill: () => child.kill()
  }
}

function deleteIfCurrent(key: string, sessionId: number): void {
  if (sessions.get(key)?.id === sessionId) {
    sessions.delete(key)
    terminalAutomationFilterStates.delete(key)
  }
}

function notifyTerminalExit(key: string, event: TerminalExitNotification): void {
  const waiters = terminalExitWaiters.get(key)
  if (!waiters) return

  terminalExitWaiters.delete(key)
  waiters.forEach((listener) => listener(event))
}

function interruptCommandSession(key: string, session: TerminalSession): void {
  if (sessions.get(key)?.id !== session.id) return

  session.interrupt()
}

function interruptPipeProcess(child: ChildProcessWithoutNullStreams): void {
  if (child.killed) return

  try {
    child.kill('SIGINT')
  } catch {
    try {
      child.stdin.write('\x03')
    } catch {
      // Best effort interruption for pipe fallback.
    }
  }
}

function normalizeCommandTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return TERMINAL_COMMAND_TIMEOUT_MS
  return Math.max(
    TERMINAL_COMMAND_MIN_TIMEOUT_MS,
    Math.min(TERMINAL_COMMAND_MAX_TIMEOUT_MS, Math.round(timeoutMs))
  )
}

export function isInteractiveCommand(data: string): boolean {
  const command = data.trim()

  if (/^sudo\s*(?:$|-i\b|-s\b|su\b)/.test(command)) return true

  return /^(ssh|sftp|scp|su\b|passwd\b|mysql\b|psql\b)/.test(command)
}

function sanitizeCommand(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.replace(/[\r\n]+/g, ' && ').trim()
}

function createCommandWrapper(command: string, startMarker: string, endMarker: string): string {
  return [
    `printf '\\n${startMarker}\\n'`,
    command,
    '__crescent_status=$?',
    `printf '\\n${endMarker}:%s\\n' "$__crescent_status"`,
    'unset __crescent_status'
  ].join('\n')
}

function createPtyScriptRunner(script: string): string {
  const encodedScript = Buffer.from(script, 'utf8').toString('base64')

  return (
    [
      '__crescent_script=$(mktemp "${TMPDIR:-/tmp}/crescent.XXXXXX")',
      '&&',
      `{ printf %s '${encodedScript}' | base64 -d > "$__crescent_script" 2>/dev/null || printf %s '${encodedScript}' | base64 -D > "$__crescent_script"; }`,
      '&&',
      '. "$__crescent_script"',
      ';',
      'rm -f "$__crescent_script"',
      ';',
      'stty echo 2>/dev/null',
      ';',
      'unset __crescent_script __crescent_status'
    ].join(' ') + '\r'
  )
}

function parseCommandBuffer(
  buffer: string,
  startMarker: string,
  endMarker: string
): { done: boolean; exitCode?: number; output: string } {
  const normalized = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const startIndex = normalized.indexOf(startMarker)
  const endIndex = normalized.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1) return { done: false, output: '' }

  const statusMatch = normalized
    .slice(endIndex)
    .match(new RegExp(`${escapeRegExp(endMarker)}:(\\d+)`))
  if (!statusMatch) return { done: false, output: '' }

  return {
    done: true,
    exitCode: Number(statusMatch[1]),
    output: removeAutomationNoise(
      normalized.slice(startIndex + startMarker.length, endIndex)
    ).trim()
  }
}

function extractPartialCommandOutput(buffer: string, startMarker: string): string {
  const normalized = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const startIndex = normalized.indexOf(startMarker)

  if (startIndex === -1) return removeAutomationNoise(normalized).trim()
  return removeAutomationNoise(normalized.slice(startIndex + startMarker.length)).trim()
}

function stripAnsi(value: string): string {
  let output = ''

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27) {
      output += value[index]
      continue
    }

    index += 1
    if (value[index] !== '[') {
      index -= 1
      continue
    }

    while (index + 1 < value.length) {
      index += 1
      const code = value.charCodeAt(index)
      if (code >= 64 && code <= 126) break
    }
  }

  return output
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeDimension(value: unknown, fallback: number): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.round(numeric))
}

function appendTerminalContext(key: string, data: string): void {
  const current = terminalOutputBuffers.get(key) ?? ''
  const next = `${current}${data}`
  terminalOutputBuffers.set(key, next.slice(-MAX_CONTEXT_BUFFER))
}

function sendVisibleTerminalData(
  webContents: WebContents,
  tabId: string,
  key: string,
  data: string
): void {
  if (!data) return

  appendTerminalContext(key, data)
  safeWebContentsSend(webContents, 'terminal:data', { tabId, data })
}

function sendIfAlive(
  webContents: WebContents,
  tabId: string,
  key: string,
  channel: string,
  payload: unknown
): void {
  if (channel === 'terminal:data' && typeof payload === 'string') {
    const visiblePayload = filterAutomationControlOutput(key, payload)
    if (visiblePayload) sendVisibleTerminalData(webContents, tabId, key, visiblePayload)

    terminalDataWaiters.get(key)?.forEach((listener) => listener(payload))
    return
  }

  safeWebContentsSend(webContents, channel, payload)
}

function filterAutomationControlOutput(key: string, data: string): string {
  const state = terminalAutomationFilterStates.get(key)
  if (state) return filterAutomationControlOutputWithState(data, state)

  return filterAutomationControlLines(data)
}

function filterAutomationControlLines(data: string): string {
  const parts = removeAutomationNoise(data).split(/(\r?\n)/)
  let output = ''
  let skippedControlLine = false

  for (const part of parts) {
    if (/^\r?\n$/.test(part)) {
      if (skippedControlLine) {
        skippedControlLine = false
        continue
      }
      output += part
      continue
    }

    if (isAutomationControlOutput(part)) {
      skippedControlLine = true
      continue
    }

    skippedControlLine = false
    output += part
  }

  return output
}

export function filterAutomationControlOutputWithState(
  data: string,
  state: TerminalAutomationFilterState
): string {
  state.pending += removeAutomationNoise(data)

  if (state.phase === 'before-start') {
    const startIndex = state.pending.indexOf(state.startMarker)
    if (startIndex === -1) {
      state.pending = keepMarkerTail(state.pending, state.startMarker)
      return ''
    }

    state.pending = state.pending.slice(startIndex + state.startMarker.length)
    state.pending = state.pending.replace(/^(\r\n|\n|\r)/, '')
    state.phase = 'body'
  }

  const endIndex = state.pending.indexOf(state.endMarker)
  if (endIndex !== -1) {
    const beforeEndMarker = state.pending.slice(0, endIndex)
    const afterEndMarker = state.pending.slice(endIndex)
    const afterEndLine = afterEndMarker.replace(
      new RegExp(`${escapeRegExp(state.endMarker)}:?\\d*\\r?\\n?`),
      ''
    )
    state.pending = ''
    return stripAutomationDisplayNoise(beforeEndMarker) + filterAutomationControlLines(afterEndLine)
  }

  const holdLength = Math.max(state.endMarker.length - 1, 0)
  if (hasUnterminatedSecretPrompt(state.pending)) {
    const output = state.pending
    state.pending = ''
    return stripAutomationDisplayNoise(output)
  }

  if (state.pending.length <= holdLength) return ''

  const safeLength = state.pending.length - holdLength
  const candidate = state.pending.slice(0, safeLength)
  const lastNewlineIndex = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('\r'))
  if (lastNewlineIndex === -1) return ''

  const emitLength = lastNewlineIndex + 1
  const output = state.pending.slice(0, emitLength)
  state.pending = state.pending.slice(emitLength)

  return stripAutomationDisplayNoise(output)
}

function keepMarkerTail(value: string, marker: string): string {
  const maxLength = Math.max(marker.length - 1, 0)
  if (value.length <= maxLength) return value

  return value.slice(-maxLength)
}

function stripAutomationDisplayNoise(value: string): string {
  return value
    .split(/(\r?\n|\r)/)
    .filter((part) => !isAutomationControlOutput(part))
    .map((part) => (/^\r?\n$|^\r$/.test(part) ? part : stripPromptPrefix(part)))
    .join('')
}

export function formatReadableCommandInput(command: string): string {
  return `${command.replace(/\r?\n/g, '\r\n')}\r\n`
}

function stripPromptPrefix(value: string): string {
  return value
    .replace(/^\s*(?:[\w.-]+@[\w.-]+(?:\[[^\]]+\])?:[^\r\n#$>]*[#$]|[$#]|➜\s+\S+)\s+/, '')
    .replace(/^\s*(?:>\s*)+/, '')
}

function formatReadableCommandResult(result: TerminalCommandExecutionResult): string {
  if (result.ok && !result.timedOut && !result.interrupted && !result.terminalExited) return ''

  const status = result.interrupted
    ? 'interrupted (Ctrl+C)'
    : result.timedOut
      ? 'timeout'
      : result.terminalExited
        ? `terminal exited: ${result.exitCode ?? 'unknown'}`
        : `command failed: exit code ${result.exitCode ?? 'unknown'}`

  return `\r\n\x1b[33m[Crescent] ${status}\x1b[0m\r\n`
}

function formatPipePrompt(cwd: string): string {
  const username = userInfo().username || 'user'
  const host = hostname() || 'localhost'
  const home = homedir()
  const displayCwd =
    cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd

  return `\x1b[38;5;45m${username}@${host}\x1b[0m:\x1b[38;5;111m${displayCwd}\x1b[0m $ `
}

function isAutomationControlOutput(value: string): boolean {
  const normalized = stripAnsi(value)

  return (
    normalized.includes('__CRESCENT_CMD_START_') ||
    normalized.includes('__CRESCENT_CMD_END_') ||
    normalized.includes('__crescent_script=$(mktemp') ||
    normalized.includes('__crescent_status=') ||
    normalized.includes('unset __crescent_status') ||
    /printf\s+['"]?\\n__CRESCENT_CMD_(START|END)_/.test(normalized) ||
    /printf\s+%s\s+'[A-Za-z0-9+/=]{80,}'/.test(normalized) ||
    /base64\s+-[dD]\s+>/.test(normalized) ||
    /^[A-Za-z0-9+/=]{100,}$/.test(normalized.trim())
  )
}

function removeAutomationNoise(value: string): string {
  const parts = value.split(/(\r\n|\n|\r)/)
  let output = ''
  let skippedLine = false

  for (const part of parts) {
    if (/^(\r\n|\n|\r)$/.test(part)) {
      if (!skippedLine) output += part
      skippedLine = false
      continue
    }

    if (
      /_zsh_autosuggest_highlight_apply:\d+: POSTDISPLAY: parameter not set/.test(stripAnsi(part))
    ) {
      skippedLine = true
      continue
    }

    output += part
  }

  return output
}

function hasShellContinuationPrompt(value: string): boolean {
  const normalized = stripAnsi(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const tail = normalized.slice(-800)
  const lines = tail.split('\n')
  const lastLine = lines[lines.length - 1] ?? ''
  const promptPattern =
    /^\s*(>|quote>|dquote>|bquote>|cmdand\s+cursh\s+cmdor\s+quote>|heredoc>)\s*$/

  if (promptPattern.test(lastLine)) return true

  const previousLine = lines[lines.length - 2] ?? ''
  return promptPattern.test(previousLine) && lastLine.trim() === ''
}

function normalizeTabId(tabId: string | undefined): string {
  return tabId?.trim() ?? ''
}

const RESERVED_TERMINAL_TAB_IDS = new Set(['default', 'local'])

function isUsableTerminalTabId(tabId: string): boolean {
  if (!tabId) return false
  return !RESERVED_TERMINAL_TAB_IDS.has(tabId.toLowerCase())
}

function getSessionKey(senderId: number, tabId: string): string {
  return `${senderId}:${tabId}`
}
