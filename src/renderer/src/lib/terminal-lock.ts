/** Pure helpers for locking the agent execution pane and targeting Ctrl+C. */

export function isTerminalPaneLocked(input: {
  tabId: string
  executionTerminalId?: string
  agentBusy: boolean
}): boolean {
  if (!input.agentBusy) return false
  const tabId = input.tabId.trim()
  const execution = input.executionTerminalId?.trim()
  return Boolean(tabId && execution && tabId === execution)
}

export function isPtyToolStep<T extends { kind: string; name?: string }>(
  step: T | null | undefined
): step is T & { kind: 'tool'; name: string } {
  return Boolean(step && step.kind === 'tool' && (step.name === 'bash' || step.name === 'terminal'))
}

export function resolveInterruptTabId(
  stepTabId: string | undefined,
  fallbackExecutionTabId?: string
): string {
  return stepTabId?.trim() || fallbackExecutionTabId?.trim() || ''
}

export function findRunningPtyCommandTabId(
  steps:
    | ReadonlyArray<{
        kind: string
        name?: string
        phase?: string
        tabId?: string
      }>
    | undefined,
  fallbackExecutionTabId?: string
): string | undefined {
  if (!steps?.length) return undefined
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]
    if (!isPtyToolStep(step) || step.phase !== 'started') continue
    const tabId = resolveInterruptTabId(step.tabId, fallbackExecutionTabId)
    return tabId || undefined
  }
  return undefined
}
