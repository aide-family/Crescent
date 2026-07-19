import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron'
import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import { dirname, resolve } from 'path'
import { homedir, hostname, userInfo } from 'os'
import { spawn as spawnPty } from 'node-pty'

import { resolveShellLaunchConfig } from './shell'

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
  terminalExited?: boolean
  subterminalName?: string
  subterminalTabId?: string
}

const sessions = new Map<string, TerminalSession>()
let nextSessionId = 1
const DEFAULT_TAB_ID = 'default'
const PIPE_PROMPT_PREFIX = '__TERMINAL_AGENT_PROMPT__'
const MAX_CONTEXT_BUFFER = 24_000
const TERMINAL_COMMAND_TIMEOUT_MS = 120_000
const TERMINAL_COMMAND_MIN_TIMEOUT_MS = 5_000
const TERMINAL_COMMAND_MAX_TIMEOUT_MS = 600_000
const TERMINAL_COMMAND_INTERRUPT_GRACE_MS = 2_000
const TERMINAL_COMMAND_START_TIMEOUT_MS = 8_000
const TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS = 5_000
const terminalOutputBuffers = new Map<string, string>()
const terminalDataWaiters = new Map<string, Set<(data: string) => void>>()
const terminalExitWaiters = new Map<string, Set<(event: TerminalExitNotification) => void>>()
const terminalAutomationFilterStates = new Map<string, TerminalAutomationFilterState>()
const MAX_TEMPORARY_SUBTERMINALS = 3
const temporarySubterminals = new Map<
  string,
  Array<{ name: string; tabId: string; busy: boolean; lastUsedAt: number }>
>()

export function executeCommandInTerminal(
  senderId: number,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  tabId = DEFAULT_TAB_ID
): Promise<TerminalCommandExecutionResult> {
  const normalizedTabId = normalizeTabId(tabId)
  const key = getSessionKey(senderId, normalizedTabId)
  const session = sessions.get(key)
  const normalizedCommand = command.trim()
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

  if (isInteractiveCommand(normalizedCommand)) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error: 'Interactive commands are not supported for automated execution.'
    })
  }

  return new Promise((resolve) => {
    const commandId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const startMarker = `__CRESCENT_CMD_START_${commandId}__`
    const endMarker = `__CRESCENT_CMD_END_${commandId}__`
    let buffer = ''
    let settled = false
    let timeoutTriggered = false
    let commandStarted = false
    let interruptGraceTimeout: NodeJS.Timeout | undefined
    let continuationPromptTimeout: NodeJS.Timeout | undefined

    const settle = (result: TerminalCommandExecutionResult): void => {
      if (settled) return

      settled = true
      clearTimeout(timeout)
      clearTimeout(startTimeout)
      if (interruptGraceTimeout) clearTimeout(interruptGraceTimeout)
      if (continuationPromptTimeout) clearTimeout(continuationPromptTimeout)
      const waiters = terminalDataWaiters.get(key)
      waiters?.delete(onData)
      if (waiters?.size === 0) terminalDataWaiters.delete(key)
      const exitWaiters = terminalExitWaiters.get(key)
      exitWaiters?.delete(onExit)
      if (exitWaiters?.size === 0) terminalExitWaiters.delete(key)
      terminalAutomationFilterStates.delete(key)
      const readableResult = formatReadableCommandResult(result)
      if (readableResult) session.display(readableResult)
      resolve(result)
    }

    const onData = (data: string): void => {
      buffer += data
      if (buffer.includes(startMarker)) commandStarted = true
      const parsed = parseCommandBuffer(buffer, startMarker, endMarker)

      if (!parsed.done) {
        if (
          commandStarted &&
          !timeoutTriggered &&
          !continuationPromptTimeout &&
          hasShellContinuationPrompt(buffer)
        ) {
          continuationPromptTimeout = setTimeout(
            interruptStalledContinuationPrompt,
            TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS
          )
        }
        return
      }

      settle({
        ok: !timeoutTriggered && parsed.exitCode === 0,
        command: normalizedCommand,
        mode: session.mode,
        cwd: session.cwd,
        exitCode: parsed.exitCode,
        output: parsed.output,
        error: timeoutTriggered
          ? `Command exceeded ${effectiveTimeoutMs}ms and was interrupted with Ctrl+C.`
          : undefined,
        timedOut: timeoutTriggered || undefined
      })
    }

    const interruptStalledContinuationPrompt = (): void => {
      if (!commandStarted || settled) return

      timeoutTriggered = true
      session.display(
        formatReadableContinuationPromptFailure(TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS)
      )
      interruptCommandSession(key, session)
      interruptGraceTimeout = setTimeout(() => {
        settle({
          ok: false,
          command: normalizedCommand,
          mode: session.mode,
          cwd: session.cwd,
          output: extractPartialCommandOutput(buffer, startMarker),
          error:
            'Command appears stuck at a shell continuation prompt; Crescent sent Ctrl+C to recover.',
          timedOut: true
        })
      }, TERMINAL_COMMAND_INTERRUPT_GRACE_MS)
    }

    const timeout = setTimeout(() => {
      timeoutTriggered = true
      session.display(formatReadableCommandInterrupt(effectiveTimeoutMs))
      interruptCommandSession(key, session)
      interruptGraceTimeout = setTimeout(() => {
        settle({
          ok: false,
          command: normalizedCommand,
          mode: session.mode,
          cwd: session.cwd,
          output: extractPartialCommandOutput(buffer, startMarker),
          error: `Command exceeded ${effectiveTimeoutMs}ms and did not finish after Ctrl+C.`,
          timedOut: true
        })
      }, TERMINAL_COMMAND_INTERRUPT_GRACE_MS)
    }, effectiveTimeoutMs)

    const startTimeout = setTimeout(() => {
      if (commandStarted || settled) return

      timeoutTriggered = true
      session.display(formatReadableCommandStartFailure(TERMINAL_COMMAND_START_TIMEOUT_MS))
      interruptCommandSession(key, session)
      interruptGraceTimeout = setTimeout(() => {
        settle({
          ok: false,
          command: normalizedCommand,
          mode: session.mode,
          cwd: session.cwd,
          output: '',
          error:
            'Command did not reach the execution start marker. The shell may be waiting for an unfinished quote or continuation prompt; Crescent sent Ctrl+C to recover.',
          timedOut: true
        })
      }, TERMINAL_COMMAND_INTERRUPT_GRACE_MS)
    }, TERMINAL_COMMAND_START_TIMEOUT_MS)

    const onExit = (event: TerminalExitNotification): void => {
      settle({
        ok: false,
        command: normalizedCommand,
        mode: session.mode,
        cwd: session.cwd,
        exitCode: event.exitCode,
        output: extractPartialCommandOutput(buffer, startMarker),
        error: timeoutTriggered
          ? `Command exceeded ${effectiveTimeoutMs}ms and the terminal exited after Ctrl+C. Exit code: ${event.exitCode}.`
          : `Terminal session exited while the command was running. Exit code: ${event.exitCode}.`,
        timedOut: timeoutTriggered || undefined,
        terminalExited: true
      })
    }

    const waiters = terminalDataWaiters.get(key) ?? new Set<(data: string) => void>()
    waiters.add(onData)
    terminalDataWaiters.set(key, waiters)
    const exitWaiters =
      terminalExitWaiters.get(key) ?? new Set<(event: TerminalExitNotification) => void>()
    exitWaiters.add(onExit)
    terminalExitWaiters.set(key, exitWaiters)

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
      return
    }

    session.display(formatReadableCommandInput(normalizedCommand))
    session.write(`${createCommandWrapper(normalizedCommand, startMarker, endMarker)}\n`)
  })
}

export async function executeCommandInTerminalWithPermissionRequest(
  webContents: WebContents,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  tabId = DEFAULT_TAB_ID
): Promise<TerminalCommandExecutionResult> {
  let result = await executeCommandInTerminal(webContents.id, command, timeoutMs, tabId)

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
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS
): Promise<TerminalCommandExecutionResult> {
  const parent = normalizeTabId(parentTabId)
  const name = normalizeTemporaryTerminalName(terminalName)
  const slot = ensureTemporarySubterminal(webContents, parent, name)

  if (!slot.ok) {
    return {
      ok: false,
      command: command.trim(),
      output: '',
      error: slot.error
    }
  }

  const entry = slot.entry
  if (entry.busy) {
    return {
      ok: false,
      command: command.trim(),
      output: '',
      error: `Temporary sub-terminal "${name}" is already running a command.`
    }
  }

  entry.busy = true
  entry.lastUsedAt = Date.now()

  try {
    let result = await executeCommandInTerminal(webContents.id, command, timeoutMs, entry.tabId)

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

  return (
    !result.ok &&
    /(EACCES|EPERM|Permission denied|Operation not permitted|权限不够|没有权限|操作不允许)/i.test(
      text
    )
  )
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

  ipcMain.on('terminal:write', (event, payload: { data?: string; tabId?: string } | string) => {
    const data = typeof payload === 'string' ? payload : payload?.data
    if (typeof data !== 'string') return

    const tabId = normalizeTabId(typeof payload === 'string' ? undefined : payload?.tabId)
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
  })

  ipcMain.on(
    'terminal:paste-command',
    (event, payload: { command?: string; execute?: boolean; tabId?: string }) => {
      const command = sanitizeCommand(payload?.command)
      if (!command) return

      const tabId = normalizeTabId(payload?.tabId)
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
      const session = sessions.get(getSessionKey(event.sender.id, tabId))
      if (!session) return

      session.resize(
        sanitizeDimension(dimensions?.cols, 80),
        sanitizeDimension(dimensions?.rows, 24)
      )
    }
  )

  ipcMain.on('terminal:stop', (event, payload?: { tabId?: string }) => {
    stopSession(getSessionKey(event.sender.id, normalizeTabId(payload?.tabId)))
  })

  ipcMain.on('terminal:clear', (event, payload?: { tabId?: string }) => {
    sessions.get(getSessionKey(event.sender.id, normalizeTabId(payload?.tabId)))?.clear()
  })
}

export function stopAllTerminalSessions(): void {
  for (const key of sessions.keys()) {
    stopSession(key)
  }
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
  terminalName: string
):
  | { ok: true; entry: { name: string; tabId: string; busy: boolean; lastUsedAt: number } }
  | { ok: false; error: string } {
  const poolKey = getSessionKey(webContents.id, parentTabId)
  const pool = temporarySubterminals.get(poolKey) ?? []
  const existing = pool.find((entry) => entry.name === terminalName)

  if (existing) {
    if (!sessions.has(getSessionKey(webContents.id, existing.tabId))) {
      startTemporaryTerminalSession(webContents, existing.tabId)
    }
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

  const entry = {
    name: terminalName,
    tabId: createTemporarySubterminalTabId(parentTabId, terminalName),
    busy: false,
    lastUsedAt: Date.now()
  }
  pool.push(entry)
  temporarySubterminals.set(poolKey, pool)
  startTemporaryTerminalSession(webContents, entry.tabId)

  return { ok: true, entry }
}

function startTemporaryTerminalSession(webContents: WebContents, tabId: string): void {
  const key = getSessionKey(webContents.id, tabId)
  stopSession(key)

  const launchConfig = resolveShellLaunchConfig()
  const sessionId = nextSessionId
  nextSessionId += 1
  const session = createTerminalSession({
    sessionId,
    shell: launchConfig.shell,
    args: launchConfig.args,
    cwd: launchConfig.cwd,
    env: launchConfig.env,
    cols: 100,
    rows: 24,
    webContents,
    tabId,
    key
  })

  terminalOutputBuffers.set(key, '')
  terminalAutomationFilterStates.delete(key)
  sessions.set(key, session)
}

function normalizeTemporaryTerminalName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, '-').slice(0, 40)

  return normalized || 'temporary'
}

function createTemporarySubterminalTabId(parentTabId: string, terminalName: string): string {
  return `${parentTabId}::subterminal::${encodeURIComponent(terminalName)}`
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
  if (webContents.isDestroyed() || !data) return

  appendTerminalContext(key, data)
  webContents.send('terminal:data', { tabId, data })
}

function sendIfAlive(
  webContents: WebContents,
  tabId: string,
  key: string,
  channel: string,
  payload: unknown
): void {
  if (webContents.isDestroyed()) return

  if (channel === 'terminal:data' && typeof payload === 'string') {
    const visiblePayload = filterAutomationControlOutput(key, payload)
    if (visiblePayload) sendVisibleTerminalData(webContents, tabId, key, visiblePayload)

    terminalDataWaiters.get(key)?.forEach((listener) => listener(payload))
    return
  }

  webContents.send(channel, payload)
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

function hasUnterminatedSecretPrompt(value: string): boolean {
  const lastLine = removeAutomationNoise(value)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()

  if (!lastLine) return false

  return (
    /(?:\[sudo\]\s*)?(?:password|passphrase|verification code|one-time password|otp)\b.*[:：]\s*$/i.test(
      lastLine
    ) || /(?:验证码|动态口令|一次性密码|密码).*[:：]\s*$/i.test(lastLine)
  )
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

function formatReadableCommandInterrupt(timeoutMs: number): string {
  return `\r\n\x1b[33m[Crescent] command exceeded ${formatDuration(timeoutMs)}; sending Ctrl+C.\x1b[0m\r\n`
}

function formatReadableCommandStartFailure(timeoutMs: number): string {
  return `\r\n\x1b[33m[Crescent] command did not start within ${formatDuration(timeoutMs)}; sending Ctrl+C to recover the shell.\x1b[0m\r\n`
}

function formatReadableContinuationPromptFailure(timeoutMs: number): string {
  return `\r\n\x1b[33m[Crescent] shell continuation prompt persisted for ${formatDuration(timeoutMs)}; sending Ctrl+C to recover the shell.\x1b[0m\r\n`
}

function formatReadableCommandResult(result: TerminalCommandExecutionResult): string {
  if (result.ok && !result.timedOut && !result.terminalExited) return ''

  const status = result.timedOut
    ? 'timeout'
    : result.terminalExited
      ? `terminal exited: ${result.exitCode ?? 'unknown'}`
      : `command failed: exit code ${result.exitCode ?? 'unknown'}`

  return `\r\n\x1b[33m[Crescent] ${status}\x1b[0m\r\n`
}

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 1000 && milliseconds % 1000 === 0) return `${milliseconds / 1000}s`
  return `${milliseconds}ms`
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
  const trimmed = tabId?.trim()
  return trimmed || DEFAULT_TAB_ID
}

function getSessionKey(senderId: number, tabId: string): string {
  return `${senderId}:${normalizeTabId(tabId)}`
}
