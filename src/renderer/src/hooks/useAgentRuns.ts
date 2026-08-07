import { useCallback, useRef, useState, type MutableRefObject } from 'react'

import type { Dictionary } from '@renderer/i18n'
import {
  formatAgentEventActionTitle,
  formatCommandObservation,
  formatLoadedSkillsActionDetail,
  isClassifyingStatusMessage,
  isNoiseAuditStatusMessage,
  isNoisyMcpCatalogMessage,
  localizeAgentEventMessage
} from '@renderer/lib/agent-event-formatters'
import {
  closeStreamingMessages,
  closeStreamingOpenSteps,
  closeStreamingThoughts,
  formatAgentRunDocument,
  syncActionsFromStructuredRun
} from '@renderer/lib/agent-run-document'
import type {
  AgentLogEntry,
  AgentRunStep,
  AgentRunViewState,
  AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import type { AgentEvent, CommandApprovalRequest } from '../../../shared/agent-types'
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
  liveRunByLogId: Record<number, AgentRunViewState>
  attachApprovalRequest: (chatTabId: string, request: CommandApprovalRequest) => void
  resolveApprovalStep: (
    chatTabId: string,
    requestId: string,
    approved: boolean,
    note?: string
  ) => void
} {
  const [liveRunByLogId, setLiveRunByLogId] = useState<Record<number, AgentRunViewState>>({})
  const rafFlushRef = useRef<number | null>(null)
  const dirtyTabIdsRef = useRef(new Set<string>())
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    (tabId: string, logId: number, text: string, persist = true): void => {
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: tab.agentLog.map((entry) => (entry.id === logId ? { ...entry, text } : entry))
      }))
      if (persist) {
        void window.api.storage.updateAgentLog({ tabId, logId, text })
      }
    },
    [updateTab]
  )

  const publishLiveRun = useCallback((run: AgentRunViewState): void => {
    setLiveRunByLogId((current) => {
      if (current[run.logId] === run) return current
      return { ...current, [run.logId]: run }
    })
  }, [])

  const scheduleLiveFlush = useCallback(
    (tabId: string, persistSoon = false): void => {
      dirtyTabIdsRef.current.add(tabId)
      if (persistSoon) {
        if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
        persistTimerRef.current = setTimeout(() => {
          for (const dirtyTabId of dirtyTabIdsRef.current) {
            const run = activeAgentRunRef.current.get(dirtyTabId)
            if (!run) continue
            updateLogEntryText(dirtyTabId, run.logId, formatAgentRunDocument(run, t), true)
          }
        }, 400)
      }
      if (rafFlushRef.current != null) return
      rafFlushRef.current = window.requestAnimationFrame(() => {
        rafFlushRef.current = null
        for (const dirtyTabId of dirtyTabIdsRef.current) {
          const run = activeAgentRunRef.current.get(dirtyTabId)
          if (!run) continue
          publishLiveRun(run)
          // Keep serialized log text reasonably fresh without blocking every token.
          updateLogEntryText(dirtyTabId, run.logId, formatAgentRunDocument(run, t), false)
        }
        dirtyTabIdsRef.current.clear()
      })
    },
    [activeAgentRunRef, publishLiveRun, t, updateLogEntryText]
  )

  const updateAgentRun = useCallback(
    (
      tabId: string,
      updater: (run: AgentRunViewState) => AgentRunViewState,
      options?: { immediatePersist?: boolean; streaming?: boolean }
    ): void => {
      const run = activeAgentRunRef.current.get(tabId)
      if (!run) return

      const nextRun = syncActionsFromStructuredRun(updater(run))
      activeAgentRunRef.current.set(tabId, nextRun)

      if (options?.streaming) {
        scheduleLiveFlush(tabId, true)
        return
      }

      publishLiveRun(nextRun)
      updateLogEntryText(
        tabId,
        nextRun.logId,
        formatAgentRunDocument(nextRun, t),
        options?.immediatePersist !== false
      )
    },
    [activeAgentRunRef, publishLiveRun, scheduleLiveFlush, t, updateLogEntryText]
  )

  const attachApprovalRequest = useCallback(
    (chatTabId: string, request: CommandApprovalRequest): void => {
      updateAgentRun(chatTabId, (run) => {
        const steps = [...(run.steps ?? [])]
        const index = steps.findIndex(
          (step) =>
            step.kind === 'approval' &&
            step.phase === 'pending' &&
            (!step.requestId || step.command === request.command)
        )
        if (index >= 0 && steps[index].kind === 'approval') {
          steps[index] = {
            ...steps[index],
            requestId: request.id,
            command: request.command,
            auditSummary: request.audit.summary,
            operationReason: request.audit.operationReason,
            risk: request.audit.risk,
            riskPoints: request.audit.riskPoints,
            impactAnalysis: request.audit.impactAnalysis,
            recommendation: request.audit.recommendation,
            source: request.audit.source,
            elapsedMs: request.audit.elapsedMs
          }
          return { ...run, steps }
        }
        return {
          ...run,
          steps: [
            ...steps,
            {
              id: createStepId('approval'),
              kind: 'approval',
              requestId: request.id,
              command: request.command,
              phase: 'pending',
              auditSummary: request.audit.summary,
              operationReason: request.audit.operationReason,
              risk: request.audit.risk,
              riskPoints: request.audit.riskPoints,
              impactAnalysis: request.audit.impactAnalysis,
              recommendation: request.audit.recommendation,
              source: request.audit.source,
              elapsedMs: request.audit.elapsedMs
            }
          ]
        }
      })
    },
    [updateAgentRun]
  )

  const resolveApprovalStep = useCallback(
    (chatTabId: string, requestId: string, approved: boolean, note?: string): void => {
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        steps: (run.steps ?? []).map((step) => {
          if (step.kind !== 'approval' || step.requestId !== requestId) return step
          if (step.phase !== 'pending') return step
          return {
            ...step,
            phase: approved ? 'approved' : 'rejected',
            note: approved ? note : undefined,
            rejectionReason: approved ? undefined : note
          }
        })
      }))
    },
    [updateAgentRun]
  )

  const appendAgentEvent = useCallback(
    (event: AgentEvent, tabId = activeTabIdRef.current): void => {
      if (activeRunCanceledRef.current.has(tabId)) return

      if (event.type === 'token') {
        updateAgentRun(
          tabId,
          (run) => {
            let steps = closeStreamingThoughts(run.steps ?? [])
            const last = steps[steps.length - 1]
            if (last?.kind === 'message' && last.phase === 'streaming') {
              steps = [...steps]
              steps[steps.length - 1] = { ...last, text: `${last.text}${event.text}` }
            } else {
              steps = [
                ...steps,
                {
                  id: createStepId('message'),
                  kind: 'message',
                  text: event.text,
                  phase: 'streaming'
                }
              ]
            }
            return { ...run, steps }
          },
          { streaming: true }
        )
        return
      }

      if (event.type === 'done') return

      if (event.type === 'status' && isNoisyMcpCatalogMessage(event.message)) return
      if (event.type === 'status' && isNoiseAuditStatusMessage(event.message, t)) return

      if (event.type === 'thought') {
        const delta = localizeAgentEventMessage(event.message, t)
        if (!delta) return
        updateAgentRun(
          tabId,
          (run) => {
            let steps = closeStreamingMessages(run.steps ?? [])
            const last = steps[steps.length - 1]
            if (last?.kind === 'thought' && last.phase === 'streaming') {
              steps = [...steps]
              steps[steps.length - 1] = { ...last, text: `${last.text}${delta}` }
            } else {
              steps = [
                ...steps,
                {
                  id: createStepId('thought'),
                  kind: 'thought',
                  text: delta,
                  phase: 'streaming'
                }
              ]
            }
            return {
              ...run,
              steps,
              thinkingText: `${run.thinkingText ?? ''}${delta}`
            }
          },
          { streaming: true }
        )
        return
      }

      if (event.type === 'status') {
        const title = formatAgentEventActionTitle(event, t)
        if (isNoiseAuditStatusMessage(title, t)) return
        const detail = localizeAgentEventMessage(event.message, t)
        updateAgentRun(tabId, (run) => {
          const steps = closeStreamingOpenSteps(run.steps ?? [])
          const last = steps[steps.length - 1]
          if (last?.kind === 'status' && last.title === title) {
            return steps === run.steps ? run : { ...run, steps }
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
            ...closeStreamingOpenSteps(run.steps ?? []),
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
        updateAgentRun(tabId, (run) => {
          const steps = closeStreamingOpenSteps(run.steps ?? []).filter(
            (step) => !isClassifyingStatusStep(step, t)
          )
          const existingIndex = steps.findIndex(
            (step) =>
              step.kind === 'approval' &&
              (step.phase === 'pending' || step.phase === 'approved') &&
              step.command === event.command
          )
          const approvalStep = {
            id:
              existingIndex >= 0 && steps[existingIndex].kind === 'approval'
                ? steps[existingIndex].id
                : createStepId('approval'),
            kind: 'approval' as const,
            requestId: '',
            command: event.command,
            phase: (event.audit.requiresApproval ? 'pending' : 'approved') as
              | 'pending'
              | 'approved'
              | 'rejected',
            auditSummary: event.audit.summary,
            operationReason: event.audit.operationReason,
            risk: event.audit.risk,
            riskPoints: event.audit.riskPoints,
            impactAnalysis: event.audit.impactAnalysis,
            recommendation: event.audit.recommendation,
            source: event.audit.source,
            elapsedMs: event.audit.elapsedMs
          }
          if (existingIndex >= 0) {
            steps[existingIndex] = approvalStep
            return { ...run, steps }
          }
          return { ...run, steps: [...steps, approvalStep] }
        })
        return
      }

      if (event.type === 'skills') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          steps: [
            ...closeStreamingOpenSteps(run.steps ?? []),
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
        const rawMessage = event.message ?? ''
        if (phase === 'finished' && isNoiseAuditStatusMessage(rawMessage, t)) {
          return
        }
        const argsOrResult = redactSensitiveText(localizeAgentEventMessage(rawMessage, t))
        updateAgentRun(tabId, (run) => {
          let steps = [...(run.steps ?? [])]
          const toolName = event.name === 'terminal' ? 'bash' : event.name
          const isPty = toolName === 'bash'
          const command =
            event.command?.trim() ||
            (phase === 'started' ? extractCommandFromArgsText(argsOrResult) : undefined)

          if (phase === 'started') {
            steps = closeStreamingOpenSteps(steps)
            // Reuse an open PTY step (command may have arrived first) so we never
            // render bash + terminal as two identical command rows.
            if (isPty) {
              const openIndex = findOpenPtyToolStepIndex(
                steps,
                toolName,
                event.toolCallId,
                command
              )
              const openStep = openIndex >= 0 ? steps[openIndex] : undefined
              if (openStep?.kind === 'tool' && openStep.phase === 'started') {
                steps[openIndex] = {
                  ...openStep,
                  name: 'bash',
                  toolCallId: event.toolCallId || openStep.toolCallId,
                  command: command || openStep.command,
                  // Prefer plain command over JSON args for display.
                  argsText:
                    command || openStep.command ? undefined : argsOrResult || undefined
                }
                return { ...run, steps }
              }
            }
            steps.push({
              id: createStepId('tool'),
              kind: 'tool',
              name: toolName,
              phase: 'started',
              argsText: isPty && command ? undefined : argsOrResult || undefined,
              command: command || undefined,
              toolCallId: event.toolCallId
            })
            return { ...run, steps }
          }

          const openIndex = findOpenPtyToolStepIndex(steps, event.name, event.toolCallId, command)
          if (openIndex >= 0) {
            const existing = steps[openIndex]
            if (existing.kind === 'tool') {
              steps[openIndex] = {
                ...existing,
                name: existing.name === 'terminal' ? 'bash' : existing.name,
                phase: 'finished',
                // Prefer PTY command observation when already present; otherwise use tool result.
                resultText: existing.resultText || argsOrResult || undefined,
                isError: Boolean(event.isError) || Boolean(existing.isError),
                command: existing.command || command || undefined,
                toolCallId: event.toolCallId || existing.toolCallId,
                argsText: existing.command || command ? undefined : existing.argsText
              }
              return { ...run, steps: coalesceAdjacentPtyToolSteps(steps) }
            }
          }

          steps.push({
            id: createStepId('tool'),
            kind: 'tool',
            name: toolName,
            phase: 'finished',
            resultText: argsOrResult || undefined,
            isError: Boolean(event.isError),
            command: command || undefined,
            toolCallId: event.toolCallId
          })
          return { ...run, steps: coalesceAdjacentPtyToolSteps(steps) }
        })
        return
      }

      if (event.type === 'command') {
        updateAgentRun(tabId, (run) => {
          let steps = [...(run.steps ?? [])]
          if (event.phase === 'started') {
            // Merge into the open bash tool step so bash + terminal are not duplicated.
            const openIndex = (() => {
              const bash = findOpenToolStepIndex(steps, 'bash')
              if (bash >= 0) return bash
              return findOpenToolStepIndex(steps, 'terminal')
            })()
            if (openIndex >= 0 && steps[openIndex].kind === 'tool') {
              steps[openIndex] = {
                ...steps[openIndex],
                name: 'bash',
                command: event.command || steps[openIndex].command,
                argsText: undefined
              }
              return { ...run, steps }
            }
            steps = closeStreamingOpenSteps(steps)
            steps.push({
              id: createStepId('tool'),
              kind: 'tool',
              name: 'bash',
              phase: 'started',
              command: event.command
            })
            return { ...run, steps }
          }

          const observation = formatCommandObservation(event, t)
          const openIndex = (() => {
            const bash = findOpenToolStepIndex(steps, 'bash')
            if (bash >= 0) return bash
            return findOpenToolStepIndex(steps, 'terminal')
          })()
          if (openIndex >= 0) {
            const existing = steps[openIndex]
            if (existing.kind === 'tool') {
              steps[openIndex] = {
                ...existing,
                name: 'bash',
                phase: 'finished',
                resultText: observation || undefined,
                isError: event.result ? !event.result.ok : false,
                command: existing.command || event.command,
                argsText: undefined
              }
              return { ...run, steps: coalesceAdjacentPtyToolSteps(steps) }
            }
          }

          // Prefer updating a just-finished PTY row with the same command over adding another.
          const finishedSame = findFinishedPtyToolStepIndex(steps, event.command)
          if (finishedSame >= 0 && steps[finishedSame].kind === 'tool') {
            const existing = steps[finishedSame]
            steps[finishedSame] = {
              ...existing,
              name: 'bash',
              resultText: existing.resultText || observation || undefined,
              isError: event.result ? !event.result.ok : Boolean(existing.isError),
              command: existing.command || event.command,
              argsText: undefined
            }
            return { ...run, steps: coalesceAdjacentPtyToolSteps(steps) }
          }

          steps.push({
            id: createStepId('tool'),
            kind: 'tool',
            name: 'bash',
            phase: 'finished',
            command: event.command,
            resultText: observation || undefined,
            isError: event.result ? !event.result.ok : false
          })
          return { ...run, steps: coalesceAdjacentPtyToolSteps(steps) }
        })
        return
      }

      if (event.type === 'error') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          error: localizeAgentEventMessage(event.message, t),
          steps: [
            ...closeStreamingOpenSteps(run.steps ?? []),
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
    appendAgentEvent,
    liveRunByLogId,
    attachApprovalRequest,
    resolveApprovalStep
  }
}

function findOpenToolStepIndex(steps: AgentRunStep[], name: string, toolCallId?: string): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind !== 'tool' || step.phase !== 'started') continue
    if (toolCallId && step.toolCallId && step.toolCallId !== toolCallId) continue
    if (step.name === name) return index
  }
  return -1
}

function isClassifyingStatusStep(
  step: AgentRunStep,
  t: Dictionary
): boolean {
  if (step.kind !== 'status') return false
  return (
    isClassifyingStatusMessage(step.title, t) ||
    (Boolean(step.detail) && isClassifyingStatusMessage(step.detail!, t))
  )
}

/** Match bash/terminal as one PTY command lifecycle so finish events update the same row. */
function findOpenPtyToolStepIndex(
  steps: AgentRunStep[],
  name: string,
  toolCallId?: string,
  command?: string
): number {
  const isPty = name === 'bash' || name === 'terminal'
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind !== 'tool') continue
    if (toolCallId && step.toolCallId && step.toolCallId === toolCallId) return index
    if (!isPty) {
      if (step.phase === 'started' && step.name === name) return index
      continue
    }
    if (step.name !== 'bash' && step.name !== 'terminal') continue
    if (step.phase === 'started') return index
    if (command && step.command === command) return index
  }
  return -1
}

function findFinishedPtyToolStepIndex(steps: AgentRunStep[], command?: string): number {
  const trimmed = command?.trim()
  if (!trimmed) return -1
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind !== 'tool' || step.phase !== 'finished') continue
    if (step.name !== 'bash' && step.name !== 'terminal') continue
    if (step.command?.trim() === trimmed) return index
  }
  return -1
}

/** Collapse back-to-back bash/terminal rows that show the same command. */
function coalesceAdjacentPtyToolSteps(steps: AgentRunStep[]): AgentRunStep[] {
  const next: AgentRunStep[] = []
  for (const step of steps) {
    const prev = next[next.length - 1]
    if (
      step.kind === 'tool' &&
      prev?.kind === 'tool' &&
      isPtyToolName(step.name) &&
      isPtyToolName(prev.name) &&
      normalizeToolCommand(prev) === normalizeToolCommand(step) &&
      normalizeToolCommand(step)
    ) {
      next[next.length - 1] = {
        ...prev,
        name: 'bash',
        phase:
          Boolean(prev.resultText || step.resultText) ||
          (prev.phase === 'finished' && step.phase === 'finished')
            ? 'finished'
            : prev.phase === 'started' || step.phase === 'started'
              ? 'started'
              : 'finished',
        command: prev.command || step.command,
        toolCallId: prev.toolCallId || step.toolCallId,
        resultText: prev.resultText || step.resultText,
        isError: Boolean(prev.isError) || Boolean(step.isError),
        argsText: undefined
      }
      continue
    }
    if (step.kind === 'tool' && isPtyToolName(step.name)) {
      next.push({
        ...step,
        name: 'bash',
        argsText: step.command?.trim() ? undefined : step.argsText
      })
      continue
    }
    next.push(step)
  }
  return next
}

function isPtyToolName(name: string): boolean {
  return name === 'bash' || name === 'terminal'
}

function normalizeToolCommand(step: Extract<AgentRunStep, { kind: 'tool' }>): string {
  return (step.command || extractCommandFromArgsText(step.argsText ?? '') || '').trim()
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
