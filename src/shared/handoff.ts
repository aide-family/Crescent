import type { AgentGenerateHandoffInput, AgentHandoffSessionInput } from './agent-types'

export const HANDOFF_GOAL_MAX = 2_000
export const HANDOFF_DRAFT_MAX = 24_000
export const HANDOFF_INPUT_MAX_BYTES = 48_000
export const HANDOFF_TIMEOUT_MS = 120_000
export const HANDOFF_RETRY_DELAY_MS = 3_000

export function validHandoffSession(value: unknown): value is AgentHandoffSessionInput {
  if (!value || typeof value !== 'object') return false
  const v = value as AgentHandoffSessionInput
  return (
    typeof v.sessionKey === 'string' &&
    /^[\w-]{1,160}$/.test(v.sessionKey) &&
    v.sessionKey === v.tabId
  )
}

export function validHandoffRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,160}$/.test(value)
}

export function validHandoffInput(value: unknown): value is AgentGenerateHandoffInput {
  if (!validHandoffSession(value)) return false
  const v = value as AgentGenerateHandoffInput
  return (
    validHandoffRequestId(v.requestId) &&
    (v.expectedRevision === undefined || validHandoffRequestId(v.expectedRevision)) &&
    typeof v.goal === 'string' &&
    v.goal.trim().length > 0 &&
    v.goal.length <= HANDOFF_GOAL_MAX &&
    (v.locale === undefined || v.locale === 'zh-CN' || v.locale === 'en')
  )
}
