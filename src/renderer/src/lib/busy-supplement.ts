import type { AgentLogEntry, AgentRunStep } from './terminal-tabs'

/** Pure helper for busy-path supplement artifacts (testable without App.tsx). */
export function buildBusySupplementArtifacts(input: {
  displayInput: string
  runId: string
  createdAt: string
  stepId?: string
}): {
  logEntry: Omit<Extract<AgentLogEntry, { kind: 'user-supplement' }>, 'id' | 'createdAt'>
  step: Extract<AgentRunStep, { kind: 'user-supplement' }>
} {
  const text = input.displayInput
  return {
    logEntry: {
      kind: 'user-supplement',
      text,
      runId: input.runId
    },
    step: {
      id: input.stepId ?? `supplement-${input.createdAt}`,
      kind: 'user-supplement',
      text,
      createdAt: input.createdAt
    }
  }
}
