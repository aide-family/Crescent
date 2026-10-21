import { storageClient } from '@renderer/clients'
import type { Dictionary } from '@renderer/i18n'
import { extractResultMarkdown } from '@renderer/lib/agent-run-markdown'
import { resolveOpsConnectionId } from '@renderer/lib/app-runtime'
import { notifyOperationError } from '@renderer/lib/operation-feedback'
import {
  getSessionChatTab,
  getSessionGroupId,
  getSessionTerminals,
  type AgentLogEntry,
  type AgentRunViewState,
  type AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import { TOAST_INTERVENTION_DURATION_MS } from '@renderer/lib/toast-policy'
import type { RefObject } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'

interface Parameters {
  activeAgentRunRef: RefObject<Map<string, AgentRunViewState>>
  tabsRef: RefObject<AgentTerminalTab[]>
  activeTab: AgentTerminalTab
  activeTabIdRef: RefObject<string>
  t: Dictionary
}

export function useOpsFeedback({
  activeAgentRunRef,
  tabsRef,
  activeTab,
  activeTabIdRef,
  t
}: Parameters) {
  const [opsFeedbackByLogId, setOpsFeedbackByLogId] = useState<Record<number, 'like' | 'dislike'>>(
    {}
  )

  const [opsFeedbackBusyLogId, setOpsFeedbackBusyLogId] = useState<number | null>(null)

  async function resolveRunIdForLogEntry(entry: AgentLogEntry): Promise<string | undefined> {
    for (const run of activeAgentRunRef.current.values()) {
      if (run.logId === entry.id && run.runId) return run.runId
    }

    const tabId =
      getSessionChatTab(tabsRef.current, getSessionGroupId(activeTab))?.id ?? activeTabIdRef.current
    const runs = await storageClient.listAgentRuns({ tabId, limit: 40 })
    const resultText = extractResultMarkdown(entry.text, t)
    const matched =
      runs.find((run) => run.output && resultText && run.output.trim() === resultText.trim()) ??
      runs.find(
        (run) =>
          Math.abs(Date.parse(run.startedAt ?? '') - Date.parse(entry.createdAt)) < 5 * 60_000
      )
    return matched?.runId
  }

  async function submitOpsFeedbackForEntry(
    entry: AgentLogEntry,
    rating: 'like' | 'dislike'
  ): Promise<void> {
    if (opsFeedbackBusyLogId === entry.id) return

    const existingRating = opsFeedbackByLogId[entry.id]
    if (existingRating) {
      toast.error(t.common.opsFeedbackAlreadyRated, {
        duration: TOAST_INTERVENTION_DURATION_MS
      })
      return
    }

    const chatTab = getSessionChatTab(tabsRef.current, getSessionGroupId(activeTab)) ?? activeTab
    const connectionId = resolveOpsConnectionId(
      activeTab.connectionId ||
        chatTab.connectionId ||
        getSessionTerminals(tabsRef.current, getSessionGroupId(activeTab)).find(
          (tab) => tab.connectionId
        )?.connectionId
    )

    const runId = await resolveRunIdForLogEntry(entry)
    if (!runId) {
      toast.error(t.common.opsFeedbackFailed, { duration: TOAST_INTERVENTION_DURATION_MS })
      return
    }

    setOpsFeedbackBusyLogId(entry.id)
    const savingToast = toast.loading(t.common.opsFeedbackSaving)
    try {
      const result = await storageClient.submitOpsFeedback({
        tabId: chatTab.id,
        runId,
        rating,
        connectionId
      })
      toast.dismiss(savingToast)
      if (!result.ok || !result.record) {
        toast.error(result.error || t.common.opsFeedbackFailed, {
          duration: TOAST_INTERVENTION_DURATION_MS
        })
        return
      }
      setOpsFeedbackByLogId((current) => ({ ...current, [entry.id]: result.record!.rating }))
      toast.success(
        result.record.rating === 'like'
          ? t.common.opsFeedbackSavedLike
          : t.common.opsFeedbackSavedDislike
      )
    } catch (error) {
      toast.dismiss(savingToast)
      notifyOperationError(t.common.opsFeedbackFailed, error)
    } finally {
      setOpsFeedbackBusyLogId(null)
    }
  }
  return {
    opsFeedbackByLogId,
    setOpsFeedbackByLogId,
    opsFeedbackBusyLogId,
    setOpsFeedbackBusyLogId,
    resolveRunIdForLogEntry,
    submitOpsFeedbackForEntry
  }
}
