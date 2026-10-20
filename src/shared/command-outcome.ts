export type CommandOutcome =
  | 'completed'
  | 'confirmed-exit-nonzero'
  | 'blocked-before-dispatch'
  | 'user-cancelled'
  | 'timeout-unconfirmed'
  | 'completion-unknown'
  | 'session-exited'
  | 'approval-denied'
  | 'SSH_TARGET_UNAVAILABLE'
export function commandOutcome(result: {
  ok: boolean
  dispatched?: boolean
  exitCode?: number
  timedOut?: boolean
  interrupted?: boolean
  terminalExited?: boolean
  outcome?: CommandOutcome
  code?: string
}): CommandOutcome {
  if (result.outcome) return result.outcome
  if (result.code === 'SSH_TARGET_UNAVAILABLE') return 'SSH_TARGET_UNAVAILABLE'
  if (!result.dispatched) return 'blocked-before-dispatch'
  if (result.terminalExited) return 'session-exited'
  if (result.interrupted) return 'user-cancelled'
  if (result.timedOut || result.exitCode === undefined) return 'completion-unknown'
  return result.ok ? 'completed' : 'confirmed-exit-nonzero'
}
