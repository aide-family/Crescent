import { ipcMain, type WebContents } from 'electron'
import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import { spawn as spawnPty } from 'node-pty'

import { resolveShellLaunchConfig } from './shell'

interface TerminalSession {
  id: number
  mode: 'pty' | 'pipe'
  pid: number
  cwd: string
  shell: string
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  clear: () => void
  kill: () => void
}

interface TerminalExitNotification {
  exitCode: number
  signal?: number | string
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
}

const sessions = new Map<string, TerminalSession>()
let nextSessionId = 1
const DEFAULT_TAB_ID = 'default'
const PIPE_PROMPT_PREFIX = '__TERMINAL_AGENT_PROMPT__'
const MAX_CONTEXT_BUFFER = 24_000
const TERMINAL_COMMAND_TIMEOUT_MS = 120_000
const TERMINAL_COMMAND_MIN_TIMEOUT_MS = 5_000
const TERMINAL_COMMAND_MAX_TIMEOUT_MS = 600_000
const terminalOutputBuffers = new Map<string, string>()
const terminalDataWaiters = new Map<string, Set<(data: string) => void>>()
const terminalExitWaiters = new Map<string, Set<(event: TerminalExitNotification) => void>>()

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

    const settle = (result: TerminalCommandExecutionResult): void => {
      if (settled) return

      settled = true
      clearTimeout(timeout)
      const waiters = terminalDataWaiters.get(key)
      waiters?.delete(onData)
      if (waiters?.size === 0) terminalDataWaiters.delete(key)
      const exitWaiters = terminalExitWaiters.get(key)
      exitWaiters?.delete(onExit)
      if (exitWaiters?.size === 0) terminalExitWaiters.delete(key)
      resolve(result)
    }

    const onData = (data: string): void => {
      buffer += data
      const parsed = parseCommandBuffer(buffer, startMarker, endMarker)

      if (!parsed.done) return

      settle({
        ok: parsed.exitCode === 0,
        command: normalizedCommand,
        mode: session.mode,
        cwd: session.cwd,
        exitCode: parsed.exitCode,
        output: parsed.output
      })
    }

    const timeout = setTimeout(() => {
      interruptCommandSession(key, session)
      settle({
        ok: false,
        command: normalizedCommand,
        mode: session.mode,
        cwd: session.cwd,
        output: extractPartialCommandOutput(buffer, startMarker),
        error: `Command timed out after ${effectiveTimeoutMs}ms and was interrupted.`,
        timedOut: true
      })
    }, effectiveTimeoutMs)

    const onExit = (event: TerminalExitNotification): void => {
      settle({
        ok: false,
        command: normalizedCommand,
        mode: session.mode,
        cwd: session.cwd,
        exitCode: event.exitCode,
        output: extractPartialCommandOutput(buffer, startMarker),
        error: `Terminal session exited while the command was running. Exit code: ${event.exitCode}.`,
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
      session.write('stty -echo\r')
      setTimeout(() => {
        if (settled || sessions.get(key)?.id !== session.id) return
        session.write(createCommandWrapper(normalizedCommand, startMarker, endMarker, session.mode))
      }, 40)
      return
    }

    session.write(createCommandWrapper(normalizedCommand, startMarker, endMarker, session.mode))
  })
}

export function registerTerminalIpc(): void {
  ipcMain.handle(
    'terminal:start',
    (event, options?: { cols?: number; rows?: number; tabId?: string }) => {
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
        args: launchConfig.args,
        cwd: launchConfig.cwd,
        env: launchConfig.env,
        cols: sanitizeDimension(options?.cols, 80),
        rows: sanitizeDimension(options?.rows, 24),
        webContents: event.sender,
        tabId,
        key
      })

      terminalOutputBuffers.set(key, '')
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
          cwd: currentCwd
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
    cwd: currentCwd
  })

  return {
    id: input.sessionId,
    mode: 'pipe',
    pid: child.pid ?? -1,
    cwd: currentCwd,
    shell,
    write: (data) => {
      const command = data.replace(/\r?\n$/, '')

      if (!command.trim()) {
        sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:prompt', {
          tabId: input.tabId,
          cwd: currentCwd
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

  if (session.mode === 'pty') {
    session.write('\x03')
    setTimeout(() => {
      if (sessions.get(key)?.id === session.id) session.write('stty echo 2>/dev/null\r')
    }, 80)
  }
}

function normalizeCommandTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return TERMINAL_COMMAND_TIMEOUT_MS
  return Math.max(
    TERMINAL_COMMAND_MIN_TIMEOUT_MS,
    Math.min(TERMINAL_COMMAND_MAX_TIMEOUT_MS, Math.round(timeoutMs))
  )
}

function isInteractiveCommand(data: string): boolean {
  const command = data.trim()

  return /^(ssh|sftp|scp|sudo\b|su\b|passwd\b|mysql\b|psql\b)/.test(command)
}

function sanitizeCommand(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.replace(/[\r\n]+/g, ' && ').trim()
}

function createCommandWrapper(
  command: string,
  startMarker: string,
  endMarker: string,
  mode: 'pty' | 'pipe'
): string {
  const wrapper = [
    `printf '\\n${startMarker}\\n'`,
    command,
    '__crescent_status=$?',
    `printf '\\n${endMarker}:%s\\n' "$__crescent_status"`,
    'unset __crescent_status'
  ].join('\n')

  if (mode === 'pipe') return `${wrapper}\n`

  return `${createPtyScriptRunner(wrapper)}\r`
}

function createPtyScriptRunner(script: string): string {
  const encodedScript = Buffer.from(script, 'utf8').toString('base64')

  return [
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
  ].join(' ')
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

function sendIfAlive(
  webContents: WebContents,
  tabId: string,
  key: string,
  channel: string,
  payload: unknown
): void {
  if (webContents.isDestroyed()) return

  if (channel === 'terminal:data' && typeof payload === 'string') {
    terminalDataWaiters.get(key)?.forEach((listener) => listener(payload))
    const visiblePayload = filterAutomationControlOutput(payload)
    if (!visiblePayload) return

    appendTerminalContext(key, visiblePayload)
    webContents.send(channel, { tabId, data: visiblePayload })
    return
  }

  webContents.send(channel, payload)
}

function filterAutomationControlOutput(data: string): string {
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

function isAutomationControlOutput(value: string): boolean {
  const normalized = stripAnsi(value)

  return (
    normalized.includes('__CRESCENT_CMD_START_') ||
    normalized.includes('__CRESCENT_CMD_END_') ||
    normalized.includes('__crescent_script=$(mktemp') ||
    normalized.includes('__crescent_status=') ||
    normalized.includes('stty -echo') ||
    normalized.includes('stty echo 2>/dev/null') ||
    normalized.includes('unset __crescent_status') ||
    /printf\s+['"]?\\n__CRESCENT_CMD_(START|END)_/.test(normalized)
  )
}

function removeAutomationNoise(value: string): string {
  return value
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/_zsh_autosuggest_highlight_apply:\d+: POSTDISPLAY: parameter not set/.test(
          stripAnsi(line)
        )
    )
    .join('\n')
}

function normalizeTabId(tabId: string | undefined): string {
  const trimmed = tabId?.trim()
  return trimmed || DEFAULT_TAB_ID
}

function getSessionKey(senderId: number, tabId: string): string {
  return `${senderId}:${normalizeTabId(tabId)}`
}
