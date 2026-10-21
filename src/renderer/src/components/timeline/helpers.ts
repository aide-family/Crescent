import type { Dictionary } from '@renderer/i18n'
import { isClassifyingStatusMessage } from '@renderer/lib/agent-event-formatters'
import { isConnectionStatusText } from '@renderer/lib/agent-log'
import type { ParsedAgentRunDocument } from '@renderer/lib/agent-run-document'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import type { CommandRiskLevel } from '../../../../shared/agent-types'

export function isLowRiskAutoPassStep(
  step: AgentRunStep
): step is Extract<AgentRunStep, { kind: 'approval' }> {
  return step.kind === 'approval' && step.risk === 'low' && step.phase !== 'pending'
}

export type TimelineItem =
  | { kind: 'step'; step: AgentRunStep; index: number }
  | {
      kind: 'low-risk-group'
      id: string
      steps: Array<Extract<AgentRunStep, { kind: 'approval' }>>
    }
  | {
      kind: 'connection-flow'
      id: string
      steps: Array<Extract<AgentRunStep, { kind: 'status' }>>
      connectionName: string
    }

export function isConnectionFlowStatusStep(step: AgentRunStep, t: Dictionary): boolean {
  if (step.kind !== 'status') return false
  return isConnectionStatusText(step.title ?? '', t)
}

export function isConnectionFlowStatusStepType(
  step: AgentRunStep
): step is Extract<AgentRunStep, { kind: 'status' }> {
  return step.kind === 'status'
}

export function hasConnectionFlowFinished(
  steps: Array<Extract<AgentRunStep, { kind: 'status' }>>,
  t: Dictionary
): boolean {
  const done = t.terminal.postLoginTaskStarting.trim()
  return steps.some((step) => (step.title ?? '').trim() === done)
}

export function statusText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return ''
}

export function statusStepTitle(step: Extract<AgentRunStep, { kind: 'status' }>): string {
  const title = statusText(step.title)
  const firstLine = title.split('\n')[0]?.trim()
  return firstLine || title
}

export function statusStepDetail(step: Extract<AgentRunStep, { kind: 'status' }>): string {
  const title = statusText(step.title)
  const titleRest = title.includes('\n') ? title.split('\n').slice(1).join('\n').trim() : ''
  const detail = statusText(step.detail)
  return [titleRest, detail].filter(Boolean).join('\n')
}

export function groupTimelineSteps(steps: AgentRunStep[], t: Dictionary): TimelineItem[] {
  const items: TimelineItem[] = []
  // Collect every connection-flow status step in this run into ONE flow group,
  // regardless of whether unrelated rows (e.g. user supplements) appear between
  // them. The connection name is derived from the steps, never from a row title
  // fallback, so an interrupted login still renders as a single flow.
  const flowSteps: Array<Extract<AgentRunStep, { kind: 'status' }>> = []
  const flowStepIds = new Set<string>()
  for (const step of steps) {
    if (isConnectionFlowStatusStepType(step) && isConnectionFlowStatusStep(step, t)) {
      flowSteps.push(step)
      flowStepIds.add(step.id)
    }
  }
  const connectionName = resolveFlowConnectionName(flowSteps, t)

  let flowEmitted = false
  let index = 0
  while (index < steps.length) {
    const step = steps[index]
    if (flowStepIds.has(step.id)) {
      if (!flowEmitted && flowSteps.length > 0) {
        flowEmitted = true
        items.push({
          kind: 'connection-flow',
          id: 'connection-flow',
          steps: flowSteps,
          connectionName
        })
      }
      index += 1
      continue
    }
    if (isLowRiskAutoPassStep(step)) {
      let end = index + 1
      while (end < steps.length && isLowRiskAutoPassStep(steps[end])) end += 1
      if (end - index >= 2) {
        items.push({
          kind: 'low-risk-group',
          id: `low-risk-group-${step.id}`,
          steps: steps.slice(index, end) as Array<Extract<AgentRunStep, { kind: 'approval' }>>
        })
        index = end
        continue
      }
    }
    items.push({ kind: 'step', step, index })
    index += 1
  }

  return items
}

export function resolveConnectionFlowKey(
  step: Extract<AgentRunStep, { kind: 'status' }>,
  t: Dictionary
): string {
  const title = step.title ?? ''
  const switched = t.terminal.switchedToConnection.split('{name}')[0]
  if (switched && title.startsWith(switched)) {
    return title.slice(switched.length).trim()
  }
  const matched = t.terminal.connectionMatched
  if (matched && title.startsWith(matched)) {
    const firstLine = statusText(step.detail).split('\n')[0]?.trim()
    if (firstLine) return firstLine
  }
  return ''
}

export function resolveFlowConnectionName(
  steps: Array<Extract<AgentRunStep, { kind: 'status' }>>,
  t: Dictionary
): string {
  for (const step of steps) {
    const key = resolveConnectionFlowKey(step, t)
    if (key) return key
  }
  return ''
}

export function coalesceVisiblePtyToolSteps(steps: AgentRunStep[]): AgentRunStep[] {
  const next: AgentRunStep[] = []
  for (const step of steps) {
    const prev = next[next.length - 1]
    if (
      step.kind === 'tool' &&
      prev?.kind === 'tool' &&
      (step.name === 'bash' || step.name === 'terminal') &&
      (prev.name === 'bash' || prev.name === 'terminal')
    ) {
      const left = (prev.command || prev.argsText || '').trim()
      const right = (step.command || step.argsText || '').trim()
      if (
        left &&
        right &&
        left === right &&
        (!prev.executionId || !step.executionId || prev.executionId === step.executionId) &&
        (!prev.toolCallId || !step.toolCallId || prev.toolCallId === step.toolCallId)
      ) {
        const merged: Extract<AgentRunStep, { kind: 'tool' }> = {
          ...prev,
          name: 'bash',
          phase: step.phase === 'finished' || prev.phase === 'finished' ? 'finished' : prev.phase,
          command: prev.command || step.command,
          executionId: prev.executionId || step.executionId,
          lifecycle: prev.lifecycle || step.lifecycle,
          dispatchPending: Boolean(prev.dispatchPending && step.dispatchPending),
          resultText: prev.resultText || step.resultText,
          isError: Boolean(prev.isError) || Boolean(step.isError),
          toolCallId: prev.toolCallId || step.toolCallId,
          argsText: undefined
        }
        next[next.length - 1] = merged
        continue
      }
    }
    next.push(step)
  }
  return next
}

export function isNoiseStatusStep(
  step: AgentRunStep,
  t: Dictionary,
  hasApprovalStep = false
): boolean {
  if (step.kind !== 'status') return false
  const title = step.title.trim()
  if (
    /^Agent started\.?$/i.test(title) ||
    /^Thinking…$/i.test(title) ||
    /^Thinking\.\.\.$/i.test(title) ||
    title === 'Agent finished.' ||
    title === t.input.startedRun
  ) {
    return true
  }
  if (hasApprovalStep && isClassifyingStatusMessage(title, t)) {
    return true
  }
  if (hasApprovalStep && step.detail && isClassifyingStatusMessage(statusText(step.detail), t)) {
    return true
  }
  if (title === t.commandReview.title || title.startsWith(`${t.commandReview.title}:`)) {
    return true
  }
  if (
    title === t.commandReview.readOnlyAllowed ||
    title === t.commandReview.whitelisted ||
    title === t.commandReview.autoApproved
  ) {
    return true
  }
  const detail = statusText(step.detail)
  if (detail) {
    if (
      detail === t.commandReview.readOnlyAllowed ||
      detail === t.commandReview.whitelisted ||
      detail === t.input.toolTerminalHint ||
      detail.startsWith(t.commandReview.title)
    ) {
      return true
    }
  }
  return false
}

export function summarizeArgs(argsText: string | undefined): string | undefined {
  if (!argsText?.trim()) return undefined
  const trimmed = argsText.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 77)}…`
}

export function riskBadgeVariant(
  risk: CommandRiskLevel
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (risk === 'high') return 'destructive'
  if (risk === 'medium') return 'secondary'
  return 'outline'
}

export function riskLabel(risk: CommandRiskLevel, t: Dictionary): string {
  if (risk === 'high') return t.commandReview.highRisk
  if (risk === 'medium') return t.commandReview.mediumRisk
  return t.commandReview.lowRisk
}

export function resolveActivity(
  document: ParsedAgentRunDocument,
  steps: AgentRunStep[],
  t: Dictionary
): string | undefined {
  if (typeof document.elapsedMs === 'number') return undefined
  const pendingApproval = [...steps]
    .reverse()
    .find((step) => step.kind === 'approval' && step.phase === 'pending')
  if (pendingApproval) return t.input.activityAwaitingApproval
  const openThought = [...steps]
    .reverse()
    .find((step) => step.kind === 'thought' && step.phase === 'streaming')
  if (openThought) return t.input.activityThinking
  const openMessage = [...steps]
    .reverse()
    .find((step) => step.kind === 'message' && step.phase === 'streaming')
  if (openMessage) return t.input.activityWriting
  const openTool = [...steps]
    .reverse()
    .find((step) => step.kind === 'tool' && step.phase === 'started')
  if (openTool && openTool.kind === 'tool') {
    return t.input.activityRunningTool.replace('{tool}', openTool.name)
  }
  if (document.thinkingText?.trim()) return t.input.activityThinking
  return t.input.activityThinking
}

export function formatDuration(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`
  const seconds = elapsedMs / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return `${minutes}m ${rem}s`
}
