/** Structured error when the main pane is dead or the host is restoring it. */
export const MAIN_TERMINAL_RESTORING_ERROR =
  'Main terminal is restoring. Do not open_subterminal or subagent for this connection. Retry bash on the current pane after reconnect.'

export interface MainTerminalHealth {
  hasSession: boolean
  restoring: boolean
  alignment?: 'aligned' | 'drifted' | 'unknown' | string
  ready?: boolean
}

/** Same-connection child SSH is allowed only for true parallel fan-out. */
export function isMainTerminalHealthyForFanout(input: MainTerminalHealth): boolean {
  return (
    input.hasSession && !input.restoring && input.alignment === 'aligned' && input.ready === true
  )
}

/** Any extra pane while the main PTY is gone or being rebuilt is a workaround. */
export function shouldBlockToolsWhileMainRestoring(input: {
  hasSession: boolean
  restoring: boolean
}): boolean {
  return input.restoring || !input.hasSession
}
