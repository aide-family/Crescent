import { useCallback, type MutableRefObject } from 'react'

import type { Dictionary } from '@renderer/i18n'
import {
  formatAgentEventActionTitle,
  formatCommandAuditActionDetail,
  formatCommandExecutionActionDetail,
  formatCommandExecutionActionTitle,
  formatLoadedSkillsActionDetail,
  isNoisyMcpCatalogMessage,
  localizeAgentEventMessage,
  riskLabel
} from '@renderer/lib/agent-event-formatters'
import { formatAgentRunMarkdown } from '@renderer/lib/agent-log'
import type {
  AgentLogEntry,
  AgentRunViewState,
  AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import type { AgentEvent } from '../../../shared/agent-types'
import { redactSensitiveText } from '../../../shared/secret-redaction'

interface UseAgentRunsInput {
  activeTabIdRef: MutableRefObject<string>
  nextLogIdRef: MutableRefObject<number>
  activeAgentRunRef: MutableRefObject<Map<string, AgentRunViewState>>
  activeRunCanceledRef: MutableRefObject<Set<string>>
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  t: Dictionary
}

export function useAgentRuns({
  activeTabIdRef,
  nextLogIdRef,
  activeAgentRunRef,
  activeRunCanceledRef,
  updateTab,
  t
}: UseAgentRunsInput): {
  appendLog: (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId?: string) => number
  updateLogEntryText: (tabId: string, logId: number, text: string) => void
  updateAgentRun: (tabId: string, updater: (run: AgentRunViewState) => AgentRunViewState) => void
  appendAgentEvent: (event: AgentEvent, tabId?: string) => void
} {
  const appendLog = useCallback(
    (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId = activeTabIdRef.current): number => {
      const id = nextLogIdRef.current
      const createdAt = new Date().toISOString()
      nextLogIdRef.current += 1
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: [...tab.agentLog, { id, ...entry, createdAt }].slice(-120)
      }))
      void window.api.storage.saveAgentLog({
        tabId,
        logId: id,
        kind: entry.kind,
        text: entry.text,
        createdAt
      })
      return id
    },
    [activeTabIdRef, nextLogIdRef, updateTab]
  )

  const updateLogEntryText = useCallback(
    (tabId: string, logId: number, text: string): void => {
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: tab.agentLog.map((entry) => (entry.id === logId ? { ...entry, text } : entry))
      }))
      void window.api.storage.updateAgentLog({ tabId, logId, text })
    },
    [updateTab]
  )

  const updateAgentRun = useCallback(
    (tabId: string, updater: (run: AgentRunViewState) => AgentRunViewState): void => {
      const run = activeAgentRunRef.current.get(tabId)
      if (!run) return

      const nextRun = updater(run)
      activeAgentRunRef.current.set(tabId, nextRun)
      updateLogEntryText(tabId, nextRun.logId, formatAgentRunMarkdown(nextRun, t))
    },
    [activeAgentRunRef, t, updateLogEntryText]
  )

  const appendAgentEvent = useCallback(
    (event: AgentEvent, tabId = activeTabIdRef.current): void => {
      if (activeRunCanceledRef.current.has(tabId)) return

      if (event.type === 'token') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          result: `${run.result ?? ''}${event.text}`
        }))
        return
      }

      if (event.type === 'done') return

      if (event.type === 'status' && isNoisyMcpCatalogMessage(event.message)) return

      if (event.type === 'plan') {
        const detail = event.steps.length
          ? event.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
          : t.input.planUnavailable
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: t.input.createdPlan,
              detail
            }
          ]
        }))
        return
      }

      if (event.type === 'command-review') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: `${t.commandReview.title}: ${riskLabel(event.audit.risk, t)}`,
              detail: formatCommandAuditActionDetail(event.command, event.audit, t)
            }
          ]
        }))
        return
      }

      if (event.type === 'skills') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: `${t.input.loadedSkills}: ${event.skills.map((skill) => skill.name).join(', ')}`,
              detail: formatLoadedSkillsActionDetail(event.skills, t)
            }
          ]
        }))
        return
      }

      if (event.type === 'tool') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: `${t.input.usedTool}: ${event.name}`,
              detail: redactSensitiveText(localizeAgentEventMessage(event.message, t))
            }
          ]
        }))
        return
      }

      if (event.type === 'command') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: formatCommandExecutionActionTitle(event, t),
              detail: formatCommandExecutionActionDetail(event, t)
            }
          ]
        }))
        return
      }

      updateAgentRun(tabId, (run) => ({
        ...run,
        actions: [
          ...run.actions,
          {
            title: formatAgentEventActionTitle(event, t),
            detail: localizeAgentEventMessage(event.message, t)
          }
        ]
      }))
    },
    [activeRunCanceledRef, activeTabIdRef, t, updateAgentRun]
  )

  return {
    appendLog,
    updateLogEntryText,
    updateAgentRun,
    appendAgentEvent
  }
}
