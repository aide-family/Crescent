import type { AgentLogEntry, AgentRunStep } from './terminal-tabs'
import type { AgentMessageReferences } from './agent-message-refs'
import { wrapSteerSupplementPayload } from '../../../shared/runtime-supplement'

/** Pure helper for busy-path supplement artifacts (testable without App.tsx). */
export function buildBusySupplementArtifacts(input: {
  displayInput: string
  runId: string
  createdAt: string
  stepId?: string
  references?: AgentMessageReferences
}): {
  logEntry: Omit<Extract<AgentLogEntry, { kind: 'user-supplement' }>, 'id' | 'createdAt'>
  step: Extract<AgentRunStep, { kind: 'user-supplement' }>
} {
  const text = input.displayInput
  return {
    logEntry: {
      kind: 'user-supplement',
      text,
      runId: input.runId,
      references: input.references
    },
    step: {
      id: input.stepId ?? `supplement-${input.createdAt}`,
      kind: 'user-supplement',
      text,
      createdAt: input.createdAt,
      references: input.references
    }
  }
}

/**
 * Merge supplements captured while the agent run was not yet active (e.g.
 * during connection login) into the post-login task input, so they are not
 * silently lost when steer() had no live run to deliver them to.
 */
export function mergePostLoginSupplements(baseInput: string, supplements: string[]): string {
  if (supplements.length === 0) return baseInput
  return [baseInput, ...supplements.map(wrapSteerSupplementPayload)].join('\n\n')
}

/**
 * Decide whether a finished login run must continue with queued supplements.
 * Pure-login runs have no post-connection task, so their queue would otherwise
 * never be consumed. Returns the ordered continuation text when it should run.
 */
export function resolveLoginContinuation(input: { ok: boolean; supplements: string[] }): {
  shouldContinue: boolean
  continuation: string
} {
  if (!input.ok || input.supplements.length === 0) {
    return { shouldContinue: false, continuation: '' }
  }
  return {
    shouldContinue: true,
    continuation: mergePostLoginSupplements('', input.supplements)
  }
}
