import { spawn as spawnPty } from 'node-pty'
import type { TerminalSession, TerminalSessionEvents, TerminalTransportInput } from './types'
export function createPtySession(
  input: TerminalTransportInput,
  events: TerminalSessionEvents
): TerminalSession {
  const pty = spawnPty(input.shell, input.args, {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env
  })
  const dataDisposable = pty.onData((data) => {
    events.onData(data)
  })
  const exitDisposable = pty.onExit(({ exitCode, signal }) => {
    events.onExit({ exitCode, signal })
  })

  return {
    id: input.sessionId,
    mode: 'pty',
    pid: pty.pid,
    cwd: input.cwd,
    shell: input.shell,
    write: (data) => pty.write(data),
    display: (data) => events.onDisplay(data),
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
