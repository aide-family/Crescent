export const TERMINAL_EXCLUSIVE_BUSY_ERROR =
  'Terminal is already running an agent command. Wait for it to finish, interrupt it (Ctrl+C), or open_subterminal for a separate pane.'

export interface TerminalExclusiveBusyResult {
  ok: false
  command: string
  mode?: 'pty' | 'pipe'
  cwd?: string
  output: ''
  error: string
}

/** Pure helper for exclusive per-tab agent writes (testable without Electron session maps). */
export function buildTerminalExclusiveBusyResult(
  command: string,
  session?: { mode: 'pty' | 'pipe'; cwd: string }
): TerminalExclusiveBusyResult {
  return {
    ok: false,
    command,
    mode: session?.mode,
    cwd: session?.cwd,
    output: '',
    error: TERMINAL_EXCLUSIVE_BUSY_ERROR
  }
}
