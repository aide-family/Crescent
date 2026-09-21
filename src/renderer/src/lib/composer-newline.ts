import { isImeKeyEvent } from './ime-safe-value'

/** After a programmatic newline, Chromium may deliver the first IME key as a normal input. */
export const COMPOSER_NEWLINE_IME_WARMUP_MS = 80

export type ComposerEnterKeyEvent = {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  isComposing?: boolean
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
  keyCode?: number
}

export function hasComposerNewlineModifier(event: {
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
}): boolean {
  return Boolean(event.shiftKey || event.metaKey || event.ctrlKey)
}

export function isComposerNewlineEnter(event: ComposerEnterKeyEvent): boolean {
  if (event.key !== 'Enter') return false
  if (!hasComposerNewlineModifier(event)) return false
  if (isImeKeyEvent(event)) return false
  return true
}

export function isComposerSubmitEnter(event: ComposerEnterKeyEvent): boolean {
  if (event.key !== 'Enter') return false
  if (hasComposerNewlineModifier(event)) return false
  if (isImeKeyEvent(event)) return false
  return true
}

export function shouldIgnoreComposerInputAfterNewline(
  insertedAt: number,
  now = performance.now(),
  composing = false,
  warmupMs = COMPOSER_NEWLINE_IME_WARMUP_MS
): boolean {
  if (composing) return false
  if (insertedAt <= 0) return false
  const elapsed = now - insertedAt
  return elapsed >= 0 && elapsed < warmupMs
}
