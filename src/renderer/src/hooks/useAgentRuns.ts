import { useCallback, type MutableRefObject } from 'react'

import type { Dictionary } from '@renderer/i18n'
import {
  formatAgentEventActionTitle,
  formatCommandAuditActionDetail,
  formatCommandExecutionActionDetail,
  formatLoadedSkillsActionDetail,
  isNoisyMcpCatalogMessage,
  localizeAgentEventMessage,
  riskLabel
} from '@renderer/lib/agent-event-formatters'
import {
  formatAgentRunDocument,
  syncActionsFromStructuredRun
} from '@renderer/lib/agent-run-document'
import type {
  AgentLogEntry,
  AgentRunStep,
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

function createStepId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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

      const nextRun = syncActionsFromStructuredRun(updater(run))
      activeAgentRunRef.current.set(tabId, nextRun)
      updateLogEntryText(tabId, nextRun.logId, formatAgentRunDocument(nextRun, t))
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

      if (event.type === 'thought') {
        const delta = localizeAgentEventMessage(event.message, t)
        if (!delta) return
        updateAgentRun(tabId, (run) => ({
          ...run,
          thinkingText: `${run.thinkingText ?? ''}${delta}`
        }))
        return
      }

      if (event.type === 'status') {
        const title = formatAgentEventActionTitle(event, t)
        const detail = localizeAgentEventMessage(event.message, t)
        updateAgentRun(tabId, (run) => {
          const steps = run.steps ?? []
          const last = steps[steps.length - 1]
          if (last?.kind === 'status' && last.title === title) {
            return run
          }
          const step: AgentRunStep = {
            id: createStepId('status'),
            kind: 'status',
            title,
            detail
          }
          return { ...run, steps: [...steps, step] }
        })
        return
      }

      if (event.type === 'plan') {
        const detail = event.steps.length
          ? event.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
          : t.input.planUnavailable
        updateAgentRun(tabId, (run) => ({
          ...run,
          steps: [
            ...(run.steps ?? []),
            {
              id: createStepId('status'),
              kind: 'status',
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
          steps: [
            ...(run.steps ?? []),
            {
              id: createStepId('status'),
              kind: 'status',
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
          steps: [
            ...(run.steps ?? []),
            {
              id: createStepId('status'),
              kind: 'status',
              title: `${t.input.loadedSkills}: ${event.skills.map((skill) => skill.name).join(', ')}`,
              detail: formatLoadedSkillsActionDetail(event.skills, t)
            }
          ]
        }))
        return
      }

      if (event.type === 'tool') {
        const phase = event.phase ?? 'finished'
        const argsOrResult = redactSensitiveText(localizeAgentEventMessage(event.message, t))
        updateAgentRun(tabId, (run) => {
          const steps = [...(run.steps ?? [])]
          if (phase === 'started') {
            steps.push({
              id: createStepId('tool'),
              kind: 'tool',
              name: event.name,
              phase: 'started',
              argsText: argsOrResult || undefined,
              command: event.command?.trim() || extractCommandFromArgsText(argsOrResult),
              toolCallId: event.toolCallId
            })
            return { ...run, steps }
          }

          const openIndex = findOpenToolStepIndex(steps, event.name, event.toolCallId)
          if (openIndex >= 0) {
            const existing = steps[openIndex]
            if (existing.kind === 'tool') {
              steps[openIndex] = {
                ...existing,
                phase: 'finished',
                resultText: argsOrResult || undefined,
                isError: Boolean(event.isError),
                command: existing.command || event.command?.trim() || undefined
              }
              return { ...run, steps }
            }
          }

          steps.push({
            id: createStepId('tool'),
            kind: 'tool',
            name: event.name,
            phase: 'finished',
            resultText: argsOrResult || undefined,
            isError: Boolean(event.isError),
            command: event.command?.trim() || undefined,
            toolCallId: event.toolCallId
          })
          return { ...run, steps }
        })
        return
      }

      if (event.type === 'command') {
        updateAgentRun(tabId, (run) => {
          const steps = [...(run.steps ?? [])]
          const detail = formatCommandExecutionActionDetail(event, t)
          if (event.phase === 'started') {
            steps.push({
              id: createStepId('tool'),
              kind: 'tool',
              name: 'terminal',
              phase: 'started',
              command: event.command,
              argsText: detail
            })
            return { ...run, steps }
          }

          const openIndex = findOpenToolStepIndex(steps, 'terminal')
          if (openIndex >= 0) {
            const existing = steps[openIndex]
            if (existing.kind === 'tool') {
              steps[openIndex] = {
                ...existing,
                phase: 'finished',
                resultText: detail,
                isError: event.result ? !event.result.ok : false,
                command: existing.command || event.command
              }
              return { ...run, steps }
            }
          }

          steps.push({
            id: createStepId('tool'),
            kind: 'tool',
            name: 'terminal',
            phase: 'finished',
            command: event.command,
            resultText: detail,
            isError: event.result ? !event.result.ok : false
          })
          return { ...run, steps }
        })
        return
      }

      if (event.type === 'error') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          error: localizeAgentEventMessage(event.message, t),
          steps: [
            ...(run.steps ?? []),
            {
              id: createStepId('status'),
              kind: 'status',
              title: `${t.input.error}: ${localizeAgentEventMessage(event.message, t)}`,
              detail: localizeAgentEventMessage(event.message, t)
            }
          ]
        }))
        return
      }

      // All AgentEvent variants are handled above.
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

function findOpenToolStepIndex(
  steps: AgentRunStep[],
  name: string,
  toolCallId?: string
): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind !== 'tool' || step.phase !== 'started') continue
    if (toolCallId && step.toolCallId && step.toolCallId !== toolCallId) continue
    if (step.name === name) return index
  }
  return -1
}

function extractCommandFromArgsText(argsText: string): string | undefined {
  const trimmed = argsText.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed) as { command?: unknown }
    if (typeof parsed.command === 'string' && parsed.command.trim()) return parsed.command.trim()
  } catch {
    // not JSON
  }
  return undefined
}
