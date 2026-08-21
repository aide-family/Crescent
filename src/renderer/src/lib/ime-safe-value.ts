export function shouldCommitImeChange(composing: boolean): boolean {
  return !composing
}

/** Keep the in-progress composition; apply parent value only when idle. */
export function applyExternalImeValue(input: {
  composing: boolean
  local: string
  external: string
}): string {
  return input.composing ? input.local : input.external
}

/**
 * macOS / some IMEs fire compositionend before the Enter keydown that confirms
 * the candidate. isComposing is already false by then, so callers must treat a
 * recent compositionend as still "IME confirm", not "submit".
 */
export const IME_ENTER_CONFIRM_GUARD_MS = 300

export function markImeCompositionEnded(now = performance.now()): number {
  return now
}

export function shouldIgnoreEnterAfterImeConfirm(
  compositionEndedAt: number,
  now = performance.now(),
  guardMs = IME_ENTER_CONFIRM_GUARD_MS
): boolean {
  if (compositionEndedAt <= 0) return false
  const elapsed = now - compositionEndedAt
  return elapsed >= 0 && elapsed < guardMs
}

export function isImeKeyEvent(event: {
  isComposing?: boolean
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
  keyCode?: number
}): boolean {
  const native = event.nativeEvent
  return Boolean(
    event.isComposing || native?.isComposing || event.keyCode === 229 || native?.keyCode === 229
  )
}
