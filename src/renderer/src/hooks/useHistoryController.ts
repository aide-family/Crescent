import { storageClient } from '@renderer/clients'
import type { Dictionary } from '@renderer/i18n'
import { type AgentTerminalTab } from '@renderer/lib/terminal-tabs'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { type StoredSessionHistoryItem } from '../../../shared/agent-types'

interface Parameters {
  t: Dictionary
  setTabs: Dispatch<SetStateAction<AgentTerminalTab[]>>
}

export function useHistoryController({ t, setTabs }: Parameters) {
  const [historyOpen, setHistoryOpen] = useState(false)

  const [historyLoading, setHistoryLoading] = useState(false)

  const [historyError, setHistoryError] = useState<string | null>(null)

  const [historyItems, setHistoryItems] = useState<StoredSessionHistoryItem[]>([])

  const [historyTitleEditingId, setHistoryTitleEditingId] = useState<string | null>(null)

  const [historyTitleDraft, setHistoryTitleDraft] = useState('')

  const [historyTitleSavingId, setHistoryTitleSavingId] = useState<string | null>(null)

  const refreshSessionHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const items = await storageClient.listSessionHistory(100)
      setHistoryItems(items)
    } catch {
      setHistoryError(t.history.loadFailed)
    } finally {
      setHistoryLoading(false)
    }
  }, [t.history.loadFailed])

  function setHistorySheetOpen(open: boolean): void {
    setHistoryOpen(open)
    if (open) void refreshSessionHistory()
  }

  function startRenameHistorySession(item: StoredSessionHistoryItem): void {
    setHistoryTitleEditingId(item.tabId)
    setHistoryTitleDraft(item.title)
  }

  function cancelRenameHistorySession(): void {
    setHistoryTitleEditingId(null)
    setHistoryTitleDraft('')
  }

  async function saveHistorySessionTitle(item: StoredSessionHistoryItem): Promise<void> {
    const nextTitle = historyTitleDraft.trim()
    if (!nextTitle) return

    setHistoryTitleSavingId(item.tabId)
    try {
      const result = await storageClient.renameSessionHistory({
        tabId: item.tabId,
        title: nextTitle
      })
      if (!result.ok) return

      setHistoryItems((current) =>
        current.map((candidate) =>
          candidate.tabId === item.tabId ? { ...candidate, title: nextTitle } : candidate
        )
      )
      setTabs((current) =>
        current.map((tab) => (tab.id === item.tabId ? { ...tab, title: nextTitle } : tab))
      )
      cancelRenameHistorySession()
    } finally {
      setHistoryTitleSavingId(null)
    }
  }

  async function deleteHistorySession(item: StoredSessionHistoryItem): Promise<void> {
    if (!window.confirm(`${t.confirm.deleteHistory}\n\n${item.title}`)) return

    await storageClient.deleteSessionHistory(item.tabId)
    setHistoryItems((current) => current.filter((candidate) => candidate.tabId !== item.tabId))
  }
  return {
    historyOpen,
    setHistoryOpen,
    historyLoading,
    setHistoryLoading,
    historyError,
    setHistoryError,
    historyItems,
    setHistoryItems,
    historyTitleEditingId,
    setHistoryTitleEditingId,
    historyTitleDraft,
    setHistoryTitleDraft,
    historyTitleSavingId,
    setHistoryTitleSavingId,
    refreshSessionHistory,
    setHistorySheetOpen,
    startRenameHistorySession,
    cancelRenameHistorySession,
    saveHistorySessionTitle,
    deleteHistorySession
  }
}
