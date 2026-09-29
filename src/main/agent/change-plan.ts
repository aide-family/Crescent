import { redactSensitiveText } from '../../shared/secret-redaction'
import { randomUUID } from 'node:crypto'
import type {
  ChangePlanStep,
  PlanApprovalDecision,
  PlanApprovalRequest,
  PlanProgress
} from '../../shared/execution-plan'
import { planDigest, validateChangePlan } from './change-plan-policy'

interface CommandResult {
  ok: boolean
  exitCode?: number
  output: string
  timedOut?: boolean
  interrupted?: boolean
  terminalExited?: boolean
}
export interface PlanHost {
  runId: string
  sessionKey: string
  tabId: string
  chatTabId?: string
  ownerId: number
  signal?: AbortSignal
  /** Opaque host snapshot includes terminal generation, connection and live identity. */
  targetIdentity: () => string | undefined
  execute: (command: string, timeoutMs: number, signal: AbortSignal) => Promise<CommandResult>
  request: (request: PlanApprovalRequest) => void
  progress: (event: PlanProgress) => void
}
interface ActivePlan {
  request: PlanApprovalRequest
  host: PlanHost
  controller: AbortController
  phase: PlanProgress['phase']
  resolve?: (decision: PlanApprovalDecision | undefined) => void
}
const activePlans = new Map<string, ActivePlan>()
const failedCommands = new Map<string, Set<string>>()

export function resolvePlanApproval(ownerId: number, value: unknown): { ok: boolean } {
  const decision = value as PlanApprovalDecision | undefined
  if (
    !decision ||
    typeof decision.requestId !== 'string' ||
    typeof decision.digest !== 'string' ||
    typeof decision.approved !== 'boolean' ||
    typeof decision.approveRecovery !== 'boolean' ||
    (decision.note !== undefined &&
      (typeof decision.note !== 'string' || decision.note.length > 2000))
  )
    return { ok: false }
  const state = [...activePlans.values()].find((item) => item.request.id === decision.requestId)
  if (
    !state ||
    state.host.ownerId !== ownerId ||
    state.phase !== 'pending' ||
    state.request.binding.digest !== decision.digest ||
    !state.resolve
  )
    return { ok: false }
  const valid = isBound(state)
  state.resolve(valid ? decision : undefined)
  state.resolve = undefined
  return { ok: valid }
}
export function stopPlansForTab(tabId: string, ownerId?: number): void {
  for (const state of activePlans.values()) {
    if (ownerId !== undefined && state.host.ownerId !== ownerId) continue
    if (state.host.tabId === tabId || state.host.chatTabId === tabId) state.controller.abort()
  }
}
export function clearPlansForRun(runId: string): void {
  activePlans.get(runId)?.controller.abort()
  activePlans.delete(runId)
  failedCommands.delete(runId)
}
/** Bash never receives a reusable plan bypass; the executor alone owns exact approved commands. */
export function planBlocksBash(runId: string): boolean {
  const state = activePlans.get(runId)
  if (!state) return false
  if (!['stopped', 'rejected', 'completed', 'recovered'].includes(state.phase))
    state.controller.abort()
  return true
}
function isBound(state: ActivePlan): boolean {
  return (
    !state.controller.signal.aborted &&
    !state.host.signal?.aborted &&
    Date.now() < state.request.binding.expiresAt &&
    state.host.targetIdentity() === state.request.binding.targetIdentity &&
    planDigest(state.request.plan) === state.request.binding.digest
  )
}
function emit(
  state: ActivePlan,
  phase: PlanProgress['phase'],
  message: string,
  stepId?: string
): void {
  state.phase = phase
  state.host.progress({
    requestId: state.request.id,
    runId: state.host.runId,
    chatTabId: state.host.chatTabId,
    stepId,
    phase,
    message,
    at: Date.now()
  })
}
function requireBound(state: ActivePlan): void {
  if (!isBound(state))
    throw new Error(
      'Authorization expired, canceled, modified, or target changed. Submit a new plan.'
    )
}
function checkResult(result: CommandResult, expectedOutput: string): boolean {
  return (
    result.ok &&
    result.exitCode === 0 &&
    !result.timedOut &&
    !result.interrupted &&
    !result.terminalExited &&
    result.output.trim() === expectedOutput.trim()
  )
}
class StepFailure extends Error {
  constructor(
    public stepId: string,
    public recoverable: boolean
  ) {
    super(`Step ${stepId} failed; subsequent changes stopped.`)
  }
}
async function executeChecked(
  state: ActivePlan,
  command: string,
  timeoutMs: number,
  expectedOutput: string
): Promise<CommandResult> {
  requireBound(state)
  const result = await state.host.execute(command, timeoutMs, state.controller.signal)
  requireBound(state)
  if (!checkResult(result, expectedOutput))
    throw new Error(
      'Read-only precondition/identity check failed; new investigation and approval required.'
    )
  return result
}
async function executeStep(
  state: ActivePlan,
  step: ChangePlanStep,
  recovery: boolean
): Promise<void> {
  requireBound(state)
  await executeChecked(
    state,
    state.request.plan.identity.command,
    15000,
    state.request.plan.identity.expectedOutput
  )
  await executeChecked(state, step.precondition.command, 15000, step.precondition.expectedOutput)
  if (step.kind === 'change') {
    for (const backup of state.request.plan.backups) {
      await executeChecked(state, backup.integrity.command, 15000, backup.integrity.expectedOutput)
    }
  }
  const failed = failedCommands.get(state.host.runId) ?? new Set<string>()
  failedCommands.set(state.host.runId, failed)
  if (failed.has(step.command)) throw new Error('A failed command cannot be retried in this run.')
  emit(state, recovery ? 'recovering' : 'started', `${step.title}: ${step.command}`, step.id)
  let result: CommandResult
  try {
    result = await state.host.execute(step.command, step.timeoutMs, state.controller.signal)
  } catch (error) {
    failed.add(step.command)
    throw error
  }
  requireBound(state)
  if (!checkResult(result, step.expectedOutput)) {
    failed.add(step.command)
    throw new StepFailure(
      step.id,
      !result.timedOut &&
        !result.interrupted &&
        !result.terminalExited &&
        result.exitCode !== undefined
    )
  }
  if (step.kind === 'backup-verify') {
    for (const backup of state.request.plan.backups.filter(
      (item) => item.verificationStepId === step.id
    )) {
      await executeChecked(state, backup.integrity.command, 15000, backup.integrity.expectedOutput)
    }
  }
  emit(
    state,
    'succeeded',
    step.kind === 'backup-verify' ? 'Backup verified.' : 'Step verified.',
    step.id
  )
}

export async function submitAndExecutePlan(
  value: unknown,
  host: PlanHost
): Promise<{ ok: boolean; message: string }> {
  const existing = activePlans.get(host.runId)
  if (existing && !['stopped', 'rejected', 'completed', 'recovered'].includes(existing.phase))
    return { ok: false, message: 'A plan is already active.' }
  const plan = validateChangePlan(value)
  const targetIdentity = host.targetIdentity()
  if (!targetIdentity || host.signal?.aborted)
    return { ok: false, message: 'Target is unavailable.' }
  const controller = new AbortController()
  const state: ActivePlan = {
    host,
    controller,
    phase: 'pending',
    request: {
      id: randomUUID(),
      chatTabId: host.chatTabId,
      plan,
      binding: {
        runId: host.runId,
        sessionKey: host.sessionKey,
        tabId: host.tabId,
        targetIdentity,
        digest: planDigest(plan),
        expiresAt: Date.now() + 10 * 60000
      }
    }
  }
  activePlans.set(host.runId, state)
  const abort = (): void => controller.abort()
  host.signal?.addEventListener('abort', abort, { once: true })
  const expiry = setTimeout(abort, 10 * 60000)
  const completed: string[] = []
  try {
    // Host rechecks the declared identity and first preflight before exposing approval.
    await executeChecked(state, plan.identity.command, 15000, plan.identity.expectedOutput)
    const first = plan.steps[0]
    await executeChecked(
      state,
      first.precondition.command,
      15000,
      first.precondition.expectedOutput
    )
    await executeChecked(state, first.command, first.timeoutMs, first.expectedOutput)
    const decision = await new Promise<PlanApprovalDecision | undefined>((resolve) => {
      const onAbort = (): void => finish(undefined)
      const finish = (value: PlanApprovalDecision | undefined): void => {
        controller.signal.removeEventListener('abort', onAbort)
        resolve(value)
      }
      state.resolve = finish
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (controller.signal.aborted) return finish(undefined)
      emit(
        state,
        'pending',
        'Waiting for approval of the exact plan. Selecting planned execution is not approval.'
      )
      host.request(structuredClone(state.request))
    })
    if (!decision?.approved) {
      emit(
        state,
        'rejected',
        `Plan rejected or approval expired. No changes executed. ${redactSensitiveText(decision?.note ?? '')}`
      )
      return { ok: false, message: 'Plan rejected or expired. No changes executed.' }
    }
    requireBound(state)
    emit(
      state,
      'approved',
      `Plan approved for this run and target only. Recovery: ${decision.approveRecovery ? 'approved' : 'not approved'}. ${redactSensitiveText(decision.note ?? '')}`
    )
    try {
      for (const step of plan.steps) {
        await executeStep(state, step, false)
        completed.push(step.id)
      }
    } catch (error) {
      const recovery =
        error instanceof StepFailure && error.recoverable && decision.approveRecovery
          ? plan.recovery.find((item) => item.triggerStepId === error.stepId)
          : undefined
      if (!recovery) throw error
      requireBound(state)
      emit(state, 'recovering', `Approved recovery triggered by ${recovery.triggerStepId}.`)
      for (const step of recovery.steps) await executeStep(state, step, true)
      emit(
        state,
        'recovered',
        'Approved recovery verified. Original plan stopped; remaining changes were not executed.'
      )
      return {
        ok: false,
        message: `Recovered. Completed original steps: ${completed.join(', ')}. Remaining changes require a new plan.`
      }
    }
    emit(state, 'completed', 'All plan steps and final verification completed.')
    return { ok: true, message: `Verified steps: ${completed.join(', ')}.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Plan stopped.'
    emit(
      state,
      'stopped',
      `${message} Completed: ${completed.join(', ') || 'none'}. Remaining: ${plan.steps
        .filter((step) => !completed.includes(step.id))
        .map((step) => step.id)
        .join(', ')}. ${plan.impact}`
    )
    return {
      ok: false,
      message: `${message} Completed: ${completed.join(', ') || 'none'}. No automatic retry; review current state and submit a new plan.`
    }
  } finally {
    clearTimeout(expiry)
    host.signal?.removeEventListener('abort', abort)
    state.resolve = undefined
  }
}
