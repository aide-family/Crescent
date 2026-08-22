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
 * the candidate. isComposing is already false by then, so callers must treat that
 * immediate follow-up Enter as still "IME confirm", not "submit".
 *
 * Keep this window tight: Space/number confirm + Enter-to-send often follows within
 * a few hundred ms. A long guard (e.g. 300ms) swallows the real send and forces a
 * second Enter.
 */
export const IME_ENTER_CONFIRM_GUARD_MS = 50

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

/** Clear the post-compositionend arm on any non-Enter key (Space confirm, typing, …). */
export function clearImeEnterConfirmGuardUnlessEnter(
  compositionEndedAt: number,
  key: string
): number {
  if (compositionEndedAt <= 0) return compositionEndedAt
  return key === 'Enter' ? compositionEndedAt : 0
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
