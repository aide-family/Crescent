/** Logout nested SSH (exit / EOF) before killing the local PTY. */
export const GRACEFUL_TEARDOWN_TIMEOUT_MS = 2500
export const GRACEFUL_TEARDOWN_STEP_MS = 400

/** Two exits cover jump-then-target; EOT closes a leftover local shell. */
export const GRACEFUL_TEARDOWN_WRITES = ['exit\r', 'exit\r', '\x04'] as const

export interface GracefulTeardownStep {
  write: string
  waitMs: number
}

export function listGracefulTeardownSteps(
  timeoutMs = GRACEFUL_TEARDOWN_TIMEOUT_MS,
  stepMs = GRACEFUL_TEARDOWN_STEP_MS
): GracefulTeardownStep[] {
  const waitMs = Math.max(
    50,
    Math.min(stepMs, Math.floor(timeoutMs / GRACEFUL_TEARDOWN_WRITES.length))
  )
  return GRACEFUL_TEARDOWN_WRITES.map((write) => ({ write, waitMs }))
}
