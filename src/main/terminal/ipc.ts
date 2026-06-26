import { ipcMain, type WebContents } from 'electron'
import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import { spawn as spawnPty } from 'node-pty'

import { resolveShellLaunchConfig } from './shell'

interface TerminalSession {
  id: number
  mode: 'pty' | 'pipe'
  pid: number
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  clear: () => void
  kill: () => void
}

const sessions = new Map<number, TerminalSession>()
let nextSessionId = 1
const PIPE_PROMPT_PREFIX = '__TERMINAL_AGENT_PROMPT__'

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:start', (event, options?: { cols?: number; rows?: number }) => {
    const senderId = event.sender.id
    stopSession(senderId)

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
      senderId
    })

    sessions.set(senderId, session)

    return {
      sessionId: session.id,
      mode: session.mode,
      pid: session.pid,
      shell: launchConfig.shell,
      cwd: launchConfig.cwd
    }
  })

  ipcMain.on('terminal:write', (event, data: string) => {
    if (typeof data !== 'string') return
    sessions.get(event.sender.id)?.write(data)
  })

  ipcMain.on('terminal:resize', (event, dimensions: { cols?: number; rows?: number }) => {
    const session = sessions.get(event.sender.id)
    if (!session) return

    session.resize(sanitizeDimension(dimensions?.cols, 80), sanitizeDimension(dimensions?.rows, 24))
  })

  ipcMain.on('terminal:stop', (event) => {
    stopSession(event.sender.id)
  })

  ipcMain.on('terminal:clear', (event) => {
    sessions.get(event.sender.id)?.clear()
  })
}

export function stopAllTerminalSessions(): void {
  for (const senderId of sessions.keys()) {
    stopSession(senderId)
  }
}

function stopSession(senderId: number): void {
  const session = sessions.get(senderId)
  if (!session) return

  session.kill()
  sessions.delete(senderId)
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
  senderId: number
}): TerminalSession {
  try {
    return createPtySession(input)
  } catch (error) {
    sendIfAlive(
      input.webContents,
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
  senderId: number
}): TerminalSession {
  const pty = spawnPty(input.shell, input.args, {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env
  })
  const dataDisposable = pty.onData((data) => {
    sendIfAlive(input.webContents, 'terminal:data', data)
  })
  const exitDisposable = pty.onExit(({ exitCode, signal }) => {
    sendIfAlive(input.webContents, 'terminal:exit', { sessionId: input.sessionId, exitCode, signal })
    deleteIfCurrent(input.senderId, input.sessionId)
  })

  return {
    id: input.sessionId,
    mode: 'pty',
    pid: pty.pid,
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
  senderId: number
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
        sendIfAlive(input.webContents, 'terminal:prompt', { cwd: currentCwd })
      } else {
        sendIfAlive(input.webContents, 'terminal:data', `${line}\r\n`)
      }
    }
  })
  child.stderr.on('data', (data: Buffer) => {
    sendIfAlive(input.webContents, 'terminal:data', data.toString())
  })
  child.on('exit', (exitCode, signal) => {
    sendIfAlive(input.webContents, 'terminal:exit', {
      sessionId: input.sessionId,
      exitCode: exitCode ?? 0,
      signal: signal ?? undefined
    })
    deleteIfCurrent(input.senderId, input.sessionId)
  })
  sendIfAlive(input.webContents, 'terminal:data', '\x1b[33mLine-mode shell fallback active.\x1b[0m\r\n')
  sendIfAlive(input.webContents, 'terminal:prompt', { cwd: currentCwd })

  return {
    id: input.sessionId,
    mode: 'pipe',
    pid: child.pid ?? -1,
    write: (data) => {
      const command = data.replace(/\r?\n$/, '')

      if (!command.trim()) {
        sendIfAlive(input.webContents, 'terminal:prompt', { cwd: currentCwd })
        return
      }

      child.stdin.write(`${command}\nprintf '\\n${PIPE_PROMPT_PREFIX}%s\\n' "$PWD"\n`)
    },
    resize: () => undefined,
    clear: () => undefined,
    kill: () => child.kill()
  }
}

function deleteIfCurrent(senderId: number, sessionId: number): void {
  if (sessions.get(senderId)?.id === sessionId) {
    sessions.delete(senderId)
  }
}

function sanitizeDimension(value: unknown, fallback: number): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.round(numeric))
}

function sendIfAlive(webContents: WebContents, channel: string, payload: unknown): void {
  if (!webContents.isDestroyed()) {
    webContents.send(channel, payload)
  }
}
