import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dictionary, Locale } from '@renderer/i18n'
import type { AgentHandoffStatus } from '../../../shared/agent-types'
import {
  HANDOFF_DRAFT_MAX,
  HANDOFF_GOAL_MAX,
  HANDOFF_RETRY_DELAY_MS
} from '../../../shared/handoff'

export interface HandoffEditor {
  open: boolean
  goal: string
  draft: string
  generating: boolean
  creating: boolean
  requestId?: string
  sourceRevision?: string
  revision?: string
  error?: string
  lastStarted: number
}

const EMPTY: HandoffEditor = {
  open: false,
  goal: '',
  draft: '',
  generating: false,
  creating: false,
  lastStarted: 0
}

export function useHandoff(input: {
  tabId: string
  tabIds: string[]
  busy: boolean
  contextVersion: number
  locale: Locale
  t: Dictionary
  createDraft: (sourceId: string, goal: string, draft: string) => Promise<void>
}) {
  const { tabId, busy, contextVersion, locale, t, createDraft } = input
  const editors = useRef<Record<string, HandoffEditor>>({})
  const [byTab, setByTab] = useState<Record<string, HandoffEditor>>({})
  const [statuses, setStatuses] = useState<Record<string, AgentHandoffStatus>>({})
  const mounted = useRef(true)
  const liveTabs = useRef(new Set(input.tabIds))

  const update = useCallback((id: string, patch: Partial<HandoffEditor>) => {
    if (!mounted.current || !liveTabs.current.has(id)) return
    editors.current = { ...editors.current, [id]: { ...(editors.current[id] ?? EMPTY), ...patch } }
    setByTab(editors.current)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const [id, editor] of Object.entries(editors.current)) {
        if (editor.requestId)
          void window.api.agent
            .cancelHandoff({ sessionKey: id, tabId: id, requestId: editor.requestId })
            .catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    liveTabs.current = new Set(input.tabIds)
    for (const [id, editor] of Object.entries(editors.current)) {
      if (liveTabs.current.has(id)) continue
      if (editor.requestId)
        void window.api.agent
          .cancelHandoff({ sessionKey: id, tabId: id, requestId: editor.requestId })
          .catch(() => {})
      delete editors.current[id]
    }
  }, [input.tabIds])

  const generating = byTab[tabId]?.generating
  useEffect(() => {
    let current = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const refresh = (): void => {
      void window.api.agent
        .handoffStatus({ sessionKey: tabId, tabId })
        .then((status) => {
          if (!current) return
          setStatuses((old) => ({ ...old, [tabId]: status }))
          if (status.error === 'busy') retry = setTimeout(refresh, 2000)
        })
        .catch(() => {
          if (!current) return
          setStatuses((old) => ({ ...old, [tabId]: { available: false, error: 'unavailable' } }))
          retry = setTimeout(refresh, 2000)
        })
    }
    refresh()
    return () => {
      current = false
      clearTimeout(retry)
    }
  }, [tabId, busy, contextVersion, generating])

  const editor = byTab[tabId] ?? EMPTY
  const status = statuses[tabId]
  const disabledReason =
    busy || editor.generating
      ? t.handoff.errors.busy
      : !status
        ? t.handoff.checking
        : !status.available
          ? t.handoff.errors[status.error ?? 'no_session']
          : undefined

  async function generate(): Promise<void> {
    const sourceId = tabId
    const before = editors.current[sourceId] ?? EMPTY
    if (before.generating || before.creating || busy) return
    if (!before.goal.trim() || before.goal.length > HANDOFF_GOAL_MAX) {
      update(sourceId, { error: t.handoff.errors.invalid })
      return
    }
    if (Date.now() - before.lastStarted < HANDOFF_RETRY_DELAY_MS) {
      update(sourceId, { error: t.handoff.errors.throttled })
      return
    }
    const requestId = crypto.randomUUID()
    update(sourceId, { generating: true, error: undefined, requestId, lastStarted: Date.now() })
    try {
      const result = await window.api.agent.generateHandoff({
        sessionKey: sourceId,
        tabId: sourceId,
        requestId,
        goal: before.goal,
        expectedRevision: before.sourceRevision,
        locale
      })
      if (editors.current[sourceId]?.requestId !== requestId) return
      if (!result?.ok || !result.draft?.trim() || result.draft.length > HANDOFF_DRAFT_MAX) {
        update(sourceId, { error: t.handoff.errors[result?.error ?? 'output'] })
        return
      }
      update(sourceId, { draft: result.draft, revision: result.revision })
    } catch {
      if (editors.current[sourceId]?.requestId === requestId)
        update(sourceId, { error: t.handoff.failed })
    } finally {
      if (editors.current[sourceId]?.requestId === requestId)
        update(sourceId, { generating: false, requestId: undefined })
    }
  }

  function close(): void {
    const current = editors.current[tabId]
    if (current?.creating) return
    if (current?.requestId)
      void window.api.agent
        .cancelHandoff({ sessionKey: tabId, tabId, requestId: current.requestId })
        .catch(() => {})
    // Invalidate before awaiting IPC so late replies cannot reopen/overwrite the editor.
    update(tabId, { open: false, generating: false, requestId: undefined })
  }

  async function confirm(): Promise<void> {
    const sourceId = tabId
    const current = editors.current[sourceId]
    if (
      !current ||
      current.generating ||
      current.creating ||
      !current.draft.trim() ||
      current.draft.length > HANDOFF_DRAFT_MAX
    )
      return
    update(sourceId, { creating: true, error: undefined })
    try {
      const latest = await window.api.agent.handoffStatus({ sessionKey: sourceId, tabId: sourceId })
      if (!latest.available || latest.revision !== current.revision) {
        update(sourceId, { error: t.handoff.errors[latest.error ?? 'stale'] })
        return
      }
      if (!liveTabs.current.has(sourceId)) return
      await createDraft(sourceId, current.goal, current.draft)
      update(sourceId, { ...EMPTY })
    } catch {
      update(sourceId, { error: t.handoff.saveFailed })
    } finally {
      update(sourceId, { creating: false })
    }
  }

  return {
    editor,
    status,
    disabledReason,
    generate,
    close,
    confirm,
    open: () => {
      if (!disabledReason)
        update(tabId, { open: true, error: undefined, sourceRevision: status?.revision })
    },
    setGoal: (goal: string) => update(tabId, { goal }),
    setDraft: (draft: string) => update(tabId, { draft })
  }
}
