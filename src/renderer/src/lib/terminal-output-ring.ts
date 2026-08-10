/** Soft caps for renderer-side PTY ring buffers (not React state). */
export const TERMINAL_RING_MAX_BYTES = 2 * 1024 * 1024
export const TERMINAL_RING_MAX_LINES = 5_000

export function appendTerminalRingText(
  current: string,
  chunk: string,
  maxBytes = TERMINAL_RING_MAX_BYTES,
  maxLines = TERMINAL_RING_MAX_LINES
): string {
  if (!chunk) return current
  let next = current + chunk
  if (next.length > maxBytes) {
    next = next.slice(-maxBytes)
  }
  if (maxLines > 0) {
    const lines = next.split('\n')
    if (lines.length > maxLines) {
      next = lines.slice(-(maxLines)).join('\n')
    }
  }
  return next
}

const ringsByTabId = new Map<string, string>()

export function appendTerminalOutputRing(tabId: string, chunk: string): string {
  const id = tabId.trim()
  if (!id || !chunk) return ringsByTabId.get(id) ?? ''
  const next = appendTerminalRingText(ringsByTabId.get(id) ?? '', chunk)
  ringsByTabId.set(id, next)
  return next
}

export function readTerminalOutputRing(tabId: string): string {
  return ringsByTabId.get(tabId.trim()) ?? ''
}

export function clearTerminalOutputRing(tabId: string): void {
  ringsByTabId.delete(tabId.trim())
}

export function clearAllTerminalOutputRings(): void {
  ringsByTabId.clear()
}
