/** OS attention notification payload (renderer → main). */
export interface AttentionNotifyPayload {
  title: string
  body: string
  pendingId?: string
  /** Preferred terminal tab to focus on click. */
  tabId?: string
  /** Session/chat owner tab; used when tabId is missing or closed. */
  chatTabId?: string
}

/** Main → renderer after the user clicks an OS attention notification. */
export interface AttentionClickedPayload {
  pendingId?: string
  tabId?: string
  chatTabId?: string
}

const MAX_FIELD = 200

function trimId(value: unknown, max = MAX_FIELD): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

export function normalizeAttentionClickedPayload(input: unknown): AttentionClickedPayload {
  if (!input || typeof input !== 'object') return {}
  const record = input as Record<string, unknown>
  return {
    pendingId: trimId(record.pendingId),
    tabId: trimId(record.tabId),
    chatTabId: trimId(record.chatTabId)
  }
}

export function normalizeAttentionNotifyPayload(input: unknown): AttentionNotifyPayload {
  if (!input || typeof input !== 'object') {
    return { title: 'Crescent', body: '' }
  }
  const record = input as Record<string, unknown>
  const title = trimId(record.title, 120) || 'Crescent'
  const body = typeof record.body === 'string' ? record.body.trim().slice(0, 280) : ''
  return {
    title,
    body,
    ...normalizeAttentionClickedPayload(record)
  }
}

/** Prefer execution tab, then chat/session tab, if still open. */
export function resolveAttentionJumpTabId(
  target: AttentionClickedPayload,
  existingTabIds: ReadonlySet<string> | readonly string[]
): string | null {
  const ids = existingTabIds instanceof Set ? existingTabIds : new Set(existingTabIds)
  const tabId = target.tabId?.trim()
  if (tabId && ids.has(tabId)) return tabId
  const chatTabId = target.chatTabId?.trim()
  if (chatTabId && ids.has(chatTabId)) return chatTabId
  return null
}

export function collectAttentionTabIds(input: {
  passwordTabIds: readonly string[]
  pendingApprovalTabIds: readonly string[]
  clarifyTabIds?: readonly string[]
}): string[] {
  const out = new Set<string>()
  for (const id of input.passwordTabIds) {
    const trimmed = id.trim()
    if (trimmed) out.add(trimmed)
  }
  for (const id of input.pendingApprovalTabIds) {
    const trimmed = id.trim()
    if (trimmed) out.add(trimmed)
  }
  for (const id of input.clarifyTabIds ?? []) {
    const trimmed = id.trim()
    if (trimmed) out.add(trimmed)
  }
  return [...out]
}

export function pendingApprovalTabIdsFromRuns(
  runs: Iterable<{ steps?: readonly { kind: string; phase?: string; tabId?: string }[] }>
): string[] {
  const ids: string[] = []
  for (const run of runs) {
    for (const step of run.steps ?? []) {
      if (step.kind !== 'approval' || step.phase !== 'pending') continue
      const tabId = step.tabId?.trim()
      if (tabId) ids.push(tabId)
    }
  }
  return ids
}
