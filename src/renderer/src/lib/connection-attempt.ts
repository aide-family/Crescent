/**
 * Single-source connection-attempt state machine for the recovery UI.
 *
 * One card per chat tab; retries are idempotent (a connecting attempt ignores
 * further clicks); failures update the same card; success folds it.
 */

export type ConnectionAttemptPhase = 'idle' | 'connecting' | 'failed' | 'ready'

export interface ConnectionAttemptState {
  phase: ConnectionAttemptPhase
  /** Monotonic attempt id; a connecting attempt ignores new beginRetry calls. */
  attemptId?: string
  /** Human-readable failure reason (from the latest connection failure entry). */
  reason?: string
  /** True when the terminal is in PIPE fallback, so SSH retry is pointless. */
  pipeFallback?: boolean
  canRetry: boolean
  /** Log entry id this failure was derived from (dedupe transitions). */
  failureEntryId?: number
}

export function createIdleConnectionAttempt(): ConnectionAttemptState {
  return { phase: 'idle', canRetry: true }
}

export function beginConnectionRetry(
  state: ConnectionAttemptState,
  attemptId: string
): ConnectionAttemptState {
  // Idempotent: an in-flight attempt ignores repeated clicks.
  if (state.phase === 'connecting') return state
  return {
    ...state,
    phase: 'connecting',
    attemptId,
    reason: undefined,
    pipeFallback: undefined,
    canRetry: false
  }
}

export function markConnectionFailed(
  state: ConnectionAttemptState,
  input: { reason?: string; pipeFallback?: boolean; failureEntryId?: number }
): ConnectionAttemptState {
  if (state.phase === 'idle' || state.phase === 'ready') {
    return {
      phase: 'failed',
      canRetry: true,
      reason: input.reason,
      pipeFallback: input.pipeFallback,
      failureEntryId: input.failureEntryId
    }
  }
  // Same card: keep identity, refresh reason, re-enable retry.
  return {
    ...state,
    phase: 'failed',
    canRetry: true,
    reason: input.reason ?? state.reason,
    pipeFallback: input.pipeFallback ?? state.pipeFallback,
    failureEntryId: input.failureEntryId ?? state.failureEntryId
  }
}

export function markConnectionReady(state: ConnectionAttemptState): ConnectionAttemptState {
  return {
    ...state,
    phase: 'ready',
    attemptId: undefined,
    reason: undefined,
    pipeFallback: undefined,
    canRetry: true
  }
}

/**
 * Feasibility gate: SSH/login requires a PTY. In PIPE fallback mode the retry
 * would always fail, so refuse to start the attempt.
 */
export function canAttemptConnection(input: {
  state: ConnectionAttemptState
  terminalMode?: string
  needsPty: boolean
}): boolean {
  const { state, terminalMode, needsPty } = input
  if (state.phase === 'connecting') return false
  if (needsPty && terminalMode === 'pipe') return false
  return true
}

/** Dedupe consecutive identical "switched to connection" system entries. */
export function shouldAppendSwitchedEntry(
  previousStatusText: string | undefined,
  nextStatusText: string
): boolean {
  return Boolean(nextStatusText.trim()) && previousStatusText?.trim() !== nextStatusText.trim()
}
