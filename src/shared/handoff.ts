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

export type HandoffTarget = 'inherit' | 'local' | 'none' | `connection:${string}`
/** Inherit the persistent parent, never a temporary local child. */
export function resolveHandoffTarget(input: {
  selection: HandoffTarget
  source: { isSsh?: boolean; connectionId?: string; connectionName?: string }
  connections: Array<{ id: string; name: string }>
}): { isSsh: boolean; connectionId?: string; connectionName?: string; blocked: boolean } {
  if (input.selection === 'none') return { isSsh: false, blocked: true }
  if (input.selection === 'local') return { isSsh: false, blocked: false }
  const id =
    input.selection === 'inherit'
      ? input.source.connectionId
      : input.selection.slice('connection:'.length)
  if (id) {
    const saved = input.connections.find((item) => item.id === id)
    if (!saved) throw new Error('Target connection is missing; select an environment explicitly.')
    return { isSsh: true, connectionId: id, connectionName: saved.name, blocked: true }
  }
  if (input.source.isSsh)
    return { isSsh: true, connectionName: input.source.connectionName, blocked: true }
  return { isSsh: false, blocked: false }
}

/** Runtime manual hops supersede a cached connection-card identity in the renderer. */
export function handoffSourceIdentity(
  source: { isSsh?: boolean; connectionId?: string; connectionName?: string },
  context: {
    executionMode?: 'ssh' | 'local'
    manualSshActive?: boolean
    connectionOrigin?: string
    expectedTarget?: string
    promptHost?: string
  }
) {
  const manual =
    context.connectionOrigin === 'manual-shell' &&
    (context.executionMode === 'ssh' || context.manualSshActive)
  return {
    isSsh: Boolean(source.isSsh || context.executionMode === 'ssh'),
    connectionId: manual ? undefined : source.connectionId,
    connectionName: manual
      ? (context.expectedTarget ?? context.promptHost ?? 'Manual SSH')
      : source.connectionName
  }
}
