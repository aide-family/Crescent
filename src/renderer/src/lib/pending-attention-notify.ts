/**
 * Deduped OS attention notifications for pending user interventions.
 * Same pendingId notifies at most once until cleared.
 */
export function createPendingAttentionNotifier(input?: {
  isWindowFocused?: () => boolean
  notify?: (payload: { title: string; body: string }) => void | Promise<unknown>
}): {
  notifyIfUnfocused: (pendingId: string, title: string, body: string) => void
  clear: (pendingId: string) => void
  clearAll: () => void
} {
  const notified = new Set<string>()
  const isWindowFocused = input?.isWindowFocused ?? (() => {
    if (typeof document === 'undefined') return true
    return document.hasFocus()
  })
  const notify =
    input?.notify ??
    ((payload: { title: string; body: string }) => {
      void window.api.app.notifyAttention(payload)
    })

  return {
    notifyIfUnfocused(pendingId, title, body) {
      const id = pendingId.trim()
      if (!id || notified.has(id)) return
      if (isWindowFocused()) return
      notified.add(id)
      void notify({ title, body })
    },
    clear(pendingId) {
      notified.delete(pendingId.trim())
    },
    clearAll() {
      notified.clear()
    }
  }
}
