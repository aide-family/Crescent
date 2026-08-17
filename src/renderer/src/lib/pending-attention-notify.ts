import type { AttentionNotifyPayload } from '../../../shared/attention-notify'

export type AttentionNotifyOptions = {
  runId?: string
  tabId?: string
  chatTabId?: string
}

/**
 * Deduped OS attention notifications for pending user interventions
 * and one-shot run-complete notifications.
 * Same pendingId notifies at most once until cleared.
 */
export function createPendingAttentionNotifier(input?: {
  isWindowFocused?: () => boolean
  notify?: (payload: AttentionNotifyPayload) => void | Promise<unknown>
}): {
  notifyIfUnfocused: (
    pendingId: string,
    title: string,
    body: string,
    options?: AttentionNotifyOptions
  ) => void
  notifyRunComplete: (
    runId: string,
    title: string,
    body: string,
    options?: Omit<AttentionNotifyOptions, 'runId'>
  ) => void
  clear: (pendingId: string) => void
  clearApproval: (requestId: string) => void
  clearRunAttention: (runId: string) => void
  clearAll: () => void
} {
  const notified = new Set<string>()
  /** Runs that already ended — suppress further pending notifies for that run. */
  const completedRuns = new Set<string>()
  /** pendingIds associated with a run (e.g. approval:…). */
  const pendingIdsByRun = new Map<string, Set<string>>()

  const isWindowFocused =
    input?.isWindowFocused ??
    (() => {
      if (typeof document === 'undefined') return true
      return document.hasFocus()
    })
  const notify =
    input?.notify ??
    ((payload: AttentionNotifyPayload) => {
      void window.api.app.notifyAttention(payload)
    })

  function runCompleteId(runId: string): string {
    return `run-complete:${runId.trim()}`
  }

  function trackPendingForRun(runId: string, pendingId: string): void {
    const trimmed = runId.trim()
    if (!trimmed) return
    let set = pendingIdsByRun.get(trimmed)
    if (!set) {
      set = new Set()
      pendingIdsByRun.set(trimmed, set)
    }
    set.add(pendingId)
  }

  function clearPendingForRun(runId: string): void {
    const trimmed = runId.trim()
    const set = pendingIdsByRun.get(trimmed)
    if (set) {
      for (const id of set) notified.delete(id)
    }
    pendingIdsByRun.delete(trimmed)
  }

  function routingFields(
    options?: AttentionNotifyOptions
  ): Pick<AttentionNotifyPayload, 'tabId' | 'chatTabId'> {
    const tabId = options?.tabId?.trim()
    const chatTabId = options?.chatTabId?.trim()
    return {
      ...(tabId ? { tabId } : {}),
      ...(chatTabId ? { chatTabId } : {})
    }
  }

  return {
    notifyIfUnfocused(pendingId, title, body, options) {
      const id = pendingId.trim()
      if (!id || notified.has(id)) return
      const runId = options?.runId?.trim()
      if (runId && completedRuns.has(runId)) return
      if (isWindowFocused()) return
      notified.add(id)
      if (runId) trackPendingForRun(runId, id)
      void notify({
        title,
        body,
        pendingId: id,
        ...routingFields(options)
      })
    },
    notifyRunComplete(runId, title, body, options) {
      const trimmed = runId.trim()
      if (!trimmed) return
      completedRuns.add(trimmed)
      // Ending state wins over pending-class attention for this run.
      clearPendingForRun(trimmed)
      const id = runCompleteId(trimmed)
      if (notified.has(id)) return
      if (isWindowFocused()) {
        // Mark consumed so a later unfocus does not retro-notify.
        notified.add(id)
        return
      }
      notified.add(id)
      void notify({
        title,
        body,
        pendingId: id,
        ...routingFields(options)
      })
    },
    clear(pendingId) {
      notified.delete(pendingId.trim())
    },
    clearApproval(requestId) {
      notified.delete(`approval:${requestId.trim()}`)
    },
    clearRunAttention(runId) {
      const trimmed = runId.trim()
      notified.delete(runCompleteId(trimmed))
      completedRuns.delete(trimmed)
      clearPendingForRun(trimmed)
    },
    clearAll() {
      notified.clear()
      completedRuns.clear()
      pendingIdsByRun.clear()
    }
  }
}

/** First line / sentence summary capped for notification bodies. */
export function summarizeNotificationBody(text: string, maxLength = 80): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const firstLine = normalized.split(/(?<=[.!?。！？])\s+|\n/)[0] ?? normalized
  if (firstLine.length <= maxLength) return firstLine
  return `${firstLine.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}
