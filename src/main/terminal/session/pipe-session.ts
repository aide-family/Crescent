import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import type { TerminalSession, TerminalSessionEvents, TerminalTransportInput } from './types'
const PIPE_PROMPT_PREFIX = '__TERMINAL_AGENT_PROMPT__'
export function createPipeSession(
  input: TerminalTransportInput,
  events: TerminalSessionEvents
): TerminalSession {
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
        events.onPrompt(currentCwd)
      } else {
        events.onData(`${line}\r\n`)
      }
    }
  })
  child.stderr.on('data', (data: Buffer) => {
    events.onData(data.toString())
  })
  child.on('exit', (exitCode, signal) => {
    events.onExit({ exitCode: exitCode ?? 0, signal: signal ?? undefined })
  })
  events.onData('\x1b[33mLine-mode shell fallback active.\x1b[0m\r\n')
  events.onPrompt(currentCwd)

  return {
    id: input.sessionId,
    mode: 'pipe',
    pid: child.pid ?? -1,
    cwd: currentCwd,
    shell,
    display: (data) => events.onDisplay(data),
    interrupt: () => interruptPipeProcess(child),
    write: (data) => {
      const command = data.replace(/\r?\n$/, '')

      if (!command.trim()) {
        events.onPrompt(currentCwd)
        return
      }

      child.stdin.write(`${command}\nprintf '\\n${PIPE_PROMPT_PREFIX}%s\\n' "$PWD"\n`)
    },
    resize: () => undefined,
    clear: () => undefined,
    kill: () => child.kill()
  }
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
