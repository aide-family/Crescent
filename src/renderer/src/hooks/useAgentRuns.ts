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
  clampAgentRunEnvelopeText,
  closeStreamingMessages,
  closeStreamingOpenSteps,
  closeStreamingThoughts,
  formatAgentRunDocumentCompact,
  syncActionsFromStructuredRun,
  toLiveRunView
} from '@renderer/lib/agent-run-document'
import {
  AGENT_LOG_SOFT_LIMIT,
  AGENT_RUN_STREAM_MAX_CHARS,
  clampAgentLogEntryText,
  clampAgentText,
  collectTrimmedAgentLogIds,
  trimAgentLogEntries
} from '@renderer/lib/agent-log'
import { AGENT_STREAM_LIVE_FLUSH } from '@renderer/lib/agent-text-limits'
import type {
  AgentLogEntry,
  AgentLogEntryInput,
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
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => number
  updateLogEntryText: (tabId: string, logId: number, text: string) => void
  updateAgentRun: (tabId: string, updater: (run: AgentRunViewState) => AgentRunViewState) => void
  appendAgentEvent: (event: AgentEvent, tabId?: string) => void
  liveRunByLogId: Record<number, AgentRunViewState>
  pruneLiveRuns: (logIds: number[]) => void
  attachApprovalRequest: (chatTabId: string, request: CommandApprovalRequest) => void
  applyApprovalPurpose: (chatTabId: string, requestId: string, purpose: string | null) => void
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
  const persistDirtyTabIdsRef = useRef(new Set<string>())
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pruneLiveRuns = useCallback((logIds: number[]): void => {
    if (logIds.length === 0) return
    const drop = new Set(logIds)
    setLiveRunByLogId((current) => {
      let changed = false
      const next: Record<number, AgentRunViewState> = {}
      for (const [key, value] of Object.entries(current)) {
        const id = Number(key)
        if (drop.has(id)) {
          changed = true
          continue
        }
        next[id] = value
      }
      return changed ? next : current
    })
  }, [])

  const appendLog = useCallback(
    (entry: AgentLogEntryInput, tabId = activeTabIdRef.current): number => {
      const id = nextLogIdRef.current
      const createdAt = new Date().toISOString()
      nextLogIdRef.current += 1
      let droppedIds: number[] = []
      const nextEntry = clampAgentLogEntryText({ ...entry, id, createdAt } as AgentLogEntry)
      updateTab(tabId, (tab) => {
        const next = [...tab.agentLog, nextEntry]
        const trimmed = trimAgentLogEntries(next, AGENT_LOG_SOFT_LIMIT).map((item) =>
          clampAgentLogEntryText(item)
        )
        droppedIds = collectTrimmedAgentLogIds(next, trimmed)
        return {
          ...tab,
          agentLog: trimmed
        }
      })
      void window.api.storage.saveAgentLog({
        tabId,
        logId: id,
        kind: nextEntry.kind,
        text: entry.text,
        createdAt,
        runId: nextEntry.kind === 'user-supplement' ? nextEntry.runId : undefined
      })
      // Memory-only trim: keep SQLite rows for lazy reload of earlier entries.
      if (droppedIds.length > 0) {
        pruneLiveRuns(droppedIds)
      }
      return id
    },
    [activeTabIdRef, nextLogIdRef, pruneLiveRuns, updateTab]
  )

  const updateLogEntryText = useCallback(
    (tabId: string, logId: number, text: string, persist = true): void => {
      const memoryText = clampAgentRunEnvelopeText(text)
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: tab.agentLog.map((entry) =>
          entry.id === logId ? { ...entry, text: memoryText } : entry
        )
      }))
      if (persist) {
        // Persist the full compact document; renderer memory stays structure-clamped.
        void window.api.storage.updateAgentLog({ tabId, logId, text })
      }
    },
    [updateTab]
  )

  const publishLiveRun = useCallback((run: AgentRunViewState): void => {
    const slim = toLiveRunView(run)
    setLiveRunByLogId((current) => {
      if (current[slim.logId] === slim) return current
      return { ...current, [slim.logId]: slim }
    })
  }, [])

  const scheduleLiveFlush = useCallback(
    (tabId: string, persistSoon = false): void => {
      dirtyTabIdsRef.current.add(tabId)
      if (persistSoon) {
        persistDirtyTabIdsRef.current.add(tabId)
        if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
        persistTimerRef.current = setTimeout(() => {
          const pending = [...persistDirtyTabIdsRef.current]
          persistDirtyTabIdsRef.current.clear()
          for (const dirtyTabId of pending) {
            const run = activeAgentRunRef.current.get(dirtyTabId)
            if (!run) continue
            // Debounced persist only — never rewrite agentLog on the RAF hot path.
            updateLogEntryText(dirtyTabId, run.logId, formatAgentRunDocumentCompact(run), true)
          }
        }, AGENT_STREAM_LIVE_FLUSH.persistDebounceMs)
      }
      if (rafFlushRef.current != null) return
      rafFlushRef.current = window.requestAnimationFrame(() => {
        rafFlushRef.current = null
        const dirty = [...dirtyTabIdsRef.current]
        dirtyTabIdsRef.current.clear()
        for (const dirtyTabId of dirty) {
          const run = activeAgentRunRef.current.get(dirtyTabId)
          if (!run) continue
          publishLiveRun(run)
        }
      })
    },
    [activeAgentRunRef, publishLiveRun, updateLogEntryText]
  )

  const updateAgentRun = useCallback(
    (
      tabId: string,
      updater: (run: AgentRunViewState) => AgentRunViewState,
      options?: { immediatePersist?: boolean; streaming?: boolean }
    ): void => {
      const run = activeAgentRunRef.current.get(tabId)
      if (!run) return

      // Keep actions on the ref for export/trace; React live map uses toLiveRunView (no actions).
      const updated = updater(run)
      const nextRun = {
        ...syncActionsFromStructuredRun(updated),
        steps: stampMissingStepSeq(updated.steps ?? [])
      }
      activeAgentRunRef.current.set(tabId, nextRun)

      if (options?.streaming) {
        scheduleLiveFlush(tabId, true)
        return
      }

      publishLiveRun(nextRun)
      updateLogEntryText(
        tabId,
        nextRun.logId,
        formatAgentRunDocumentCompact(nextRun),
        options?.immediatePersist !== false
      )
    },
    [activeAgentRunRef, publishLiveRun, scheduleLiveFlush, updateLogEntryText]
  )

  const attachApprovalRequest = useCallback(
    (chatTabId: string, request: CommandApprovalRequest): void => {
      const isHigh = request.audit.risk === 'high'
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
            elapsedMs: request.audit.elapsedMs,
            ...(isHigh ? { purposePhase: 'loading' as const, purpose: undefined } : {})
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
              elapsedMs: request.audit.elapsedMs,
              ...(isHigh ? { purposePhase: 'loading' as const } : {})
            }
          ]
        }
      })
    },
    [updateAgentRun]
  )

  const applyApprovalPurpose = useCallback(
    (chatTabId: string, requestId: string, purpose: string | null): void => {
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        steps: (run.steps ?? []).map((step) => {
          if (step.kind !== 'approval' || step.requestId !== requestId) return step
          if (purpose?.trim()) {
            return {
              ...step,
              purpose: purpose.trim(),
              purposePhase: 'ready' as const
            }
          }
          return {
            ...step,
            purpose: undefined,
            purposePhase: 'omitted' as const
          }
        })
      }))
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
      // After Stop, drop streaming noise — but still accept finish/settle events so
      // interrupted tool cards can update if main emits after the cancel flag.
      if (activeRunCanceledRef.current.has(tabId) && !isPostCancelSettlingEvent(event)) return

      if (event.type === 'token') {
        updateAgentRun(
          tabId,
          (run) => {
            let steps = closeStreamingThoughts(run.steps ?? [])
            const last = steps[steps.length - 1]
            if (last?.kind === 'message' && last.phase === 'streaming') {
              steps = [...steps]
              steps[steps.length - 1] = {
                ...last,
                text: clampAgentText(`${last.text}${event.text}`, AGENT_RUN_STREAM_MAX_CHARS)
              }
            } else {
              steps = [
                ...steps,
                {
                  id: createStepId('message'),
                  kind: 'message',
                  text: clampAgentText(event.text, AGENT_RUN_STREAM_MAX_CHARS),
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
              steps[steps.length - 1] = {
                ...last,
                text: clampAgentText(`${last.text}${delta}`, AGENT_RUN_STREAM_MAX_CHARS)
              }
            } else {
              steps = [
                ...steps,
                {
                  id: createStepId('thought'),
                  kind: 'thought',
                  text: clampAgentText(delta, AGENT_RUN_STREAM_MAX_CHARS),
                  phase: 'streaming'
                }
              ]
            }
            return {
              ...run,
              steps,
              thinkingText: clampAgentText(
                `${run.thinkingText ?? ''}${delta}`,
                AGENT_RUN_STREAM_MAX_CHARS
              )
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
            requestId:
              existingIndex >= 0 && steps[existingIndex].kind === 'approval'
                ? steps[existingIndex].requestId
                : '',
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
            elapsedMs: event.audit.elapsedMs,
            ...(event.audit.risk === 'high' && event.audit.requiresApproval
              ? {
                  purposePhase:
                    existingIndex >= 0 &&
                    steps[existingIndex].kind === 'approval' &&
                    steps[existingIndex].purposePhase === 'ready'
                      ? ('ready' as const)
                      : ('loading' as const),
                  purpose:
                    existingIndex >= 0 && steps[existingIndex].kind === 'approval'
                      ? steps[existingIndex].purpose
                      : undefined
                }
              : {})
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
              const openIndex = findOpenPtyToolStepIndex(steps, toolName, event.toolCallId, command)
              const openStep = openIndex >= 0 ? steps[openIndex] : undefined
              if (openStep?.kind === 'tool' && openStep.phase === 'started') {
                steps[openIndex] = {
                  ...openStep,
                  name: 'bash',
                  toolCallId: event.toolCallId || openStep.toolCallId,
                  command: command || openStep.command,
                  // Prefer plain command over JSON args for display.
                  argsText: command || openStep.command ? undefined : argsOrResult || undefined
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
                interrupted: Boolean(event.result?.interrupted),
                timedOut: Boolean(event.result?.timedOut),
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
              interrupted: Boolean(event.result?.interrupted) || Boolean(existing.interrupted),
              timedOut: Boolean(event.result?.timedOut) || Boolean(existing.timedOut),
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
            isError: event.result ? !event.result.ok : false,
            interrupted: Boolean(event.result?.interrupted),
            timedOut: Boolean(event.result?.timedOut)
          })
          return { ...run, steps: coalesceAdjacentPtyToolSteps(steps) }
        })
        return
      }

      if (event.type === 'error') {
        const isQuota = event.kind === 'quota' || event.code === 'quota_exceeded'
        const provider = event.provider?.trim() || t.input.modelQuotaUnknownProvider
        const resetHint =
          event.resetHint?.trim() ||
          (event.retryAfterMs != null
            ? t.input.modelQuotaResetHintMinutes.replace(
                '{minutes}',
                String(Math.max(1, Math.ceil(event.retryAfterMs / 60_000)))
              )
            : t.input.modelQuotaResetHintSoon)
        const humanError = isQuota
          ? t.input.modelQuotaExceeded
              .replace('{provider}', provider)
              .replace('{resetHint}', resetHint)
          : localizeAgentEventMessage(event.message, t)
        updateAgentRun(tabId, (run) => ({
          ...run,
          error: humanError,
          errorKind: isQuota ? 'quota' : event.kind === 'transient' ? 'transient' : 'other',
          errorProvider: isQuota ? provider : event.provider,
          errorResetHint: isQuota ? resetHint : undefined,
          steps: [
            ...closeStreamingOpenSteps(run.steps ?? []),
            {
              id: createStepId('status'),
              kind: 'status',
              title: isQuota ? t.input.modelQuotaExceededTitle : `${t.input.error}: ${humanError}`,
              detail: humanError
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
    pruneLiveRuns,
    attachApprovalRequest,
    applyApprovalPurpose,
    resolveApprovalStep
  }
}

/** Stamp monotonic seq on steps that do not carry one yet (append order). */
function stampMissingStepSeq(steps: AgentRunStep[]): AgentRunStep[] {
  let changed = false
  const next = steps.map((step, index) => {
    if (typeof step.seq === 'number') return step
    changed = true
    return { ...step, seq: index }
  })
  return changed ? next : steps
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

function isClassifyingStatusStep(step: AgentRunStep, t: Dictionary): boolean {
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
        interrupted: Boolean(prev.interrupted) || Boolean(step.interrupted),
        timedOut: Boolean(prev.timedOut) || Boolean(step.timedOut),
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

/** Finish events that may settle tool cards after the user hits Stop. */
function isPostCancelSettlingEvent(event: AgentEvent): boolean {
  if (event.type === 'command' && event.phase === 'finished') return true
  if (event.type === 'tool' && event.phase === 'finished') return true
  return false
}
