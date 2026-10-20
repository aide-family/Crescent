import { redactSensitiveText } from '../../shared/secret-redaction'
import { normalizeCommandTimeoutPolicy } from '../../shared/command-timeouts'
import { isStaticallyReadonly } from '../../shared/command-guard'
import type { ExecutionMode } from '../../shared/execution-plan'
import { planBlocksBash, clearPlansForRun } from './change-plan'
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'

import { commandOutcome } from '../../shared/command-outcome'
import {
  canAutomaticallyApprove,
  type ApprovalPolicy,
  type MutationPolicy
} from '../../shared/approval-policy'
import { CommandFailures } from './command-failures'
import { applyBatchOutputFormatting, planReadonlyBatch } from '../../shared/readonly-batch'
import {
  executeCommandInTemporaryTerminal,
  executeCommandInTerminalWithPermissionRequest,
  interruptAndAwaitPendingTerminalCommands,
  readTerminalSessionHealth,
  readTerminalExecutionTarget,
  readTerminalPlanIdentity,
  registerMainTabLoginConfirmedHandler,
  resolveParentTerminalTabId,
  type TerminalCommandExecutionResult
} from '../terminal/ipc'
import { registerPtyExecutionTabChecker } from '../terminal/input-lock'
import {
  MAIN_TERMINAL_RESTORING_ERROR,
  shouldBlockToolsWhileMainRestoring
} from '../terminal/session-health'
import { classifyCommand } from './command-classify'
import { requestCommandApproval } from './command-approval'
import type { PiSdkFacade } from './pi-sdk'
import type { AgentConfig, AgentEvent } from './types'

export interface PtyBashExecContext {
  webContents: WebContents
  /** Visible terminal pane (main or subterminal tab id). */
  executionTabId: string
  chatTabId?: string
  runId: string
  userInput: string
  terminalContext?: string
  locale?: string
  config: AgentConfig
  executionMode?: ExecutionMode
  approvalPolicy?: ApprovalPolicy
  mutationPolicy?: MutationPolicy
  readonlyGrant?: { identity: string; expiresAt: number }
  emit: (event: AgentEvent) => void
  signal?: AbortSignal
  /**
   * When set, run the command in a named temporary subterminal docked under
   * the execution tab instead of the main pane.
   */
  subterminalName?: string
  /** SSH connection of the current execution pane, if remote. */
  connectionId?: string
  isSsh?: boolean
  /** SSH connection of the parent/main pane; survives local subterminal reroute. */
  parentConnectionId?: string
  /** True when this context belongs to a host-owned child subagent. */
  fromSubagent?: boolean
  restorationRequired?: boolean
  executionTargetIdentity?: string
  failures?: CommandFailures
  mainTarget?: { tabId: string; identity?: string; isSsh: boolean; connectionId?: string }
  targetStack?: Array<{ tabId: string; identity?: string; isSsh: boolean; connectionId?: string }>
}

const failedSshSubterminalByRunId = new Map<string, Set<string>>()

export function getFailedSshSubterminalConnectionIds(runId: string): Set<string> {
  let set = failedSshSubterminalByRunId.get(runId)
  if (!set) {
    set = new Set()
    failedSshSubterminalByRunId.set(runId, set)
  }
  return set
}

export function recordFailedSshSubterminalConnection(runId: string, connectionId: string): void {
  const id = connectionId.trim()
  const key = runId.trim()
  if (!id || !key) return
  getFailedSshSubterminalConnectionIds(key).add(id)
}

export function clearFailedSshSubterminalConnectionIds(runId: string): void {
  failedSshSubterminalByRunId.delete(runId)
}

/** Pure helper for tests: whether a missing-session bash error should return to the parent pane. */
export function isMissingTerminalSessionError(error?: string): boolean {
  return Boolean(error?.includes('No active terminal session'))
}

export function shouldRestoreParentAfterMissingSession(input: {
  error?: string
  executionTabId: string
  fromSubagent?: boolean
}): { restore: boolean; parentTabId: string } {
  const parentTabId = resolveParentTerminalTabId(input.executionTabId)
  if (input.fromSubagent) return { restore: false, parentTabId }
  if (!isMissingTerminalSessionError(input.error)) return { restore: false, parentTabId }
  if (!parentTabId || parentTabId === input.executionTabId) {
    return { restore: false, parentTabId }
  }
  return { restore: true, parentTabId }
}

export function rewriteMissingSessionErrorForMainRestore(input: {
  error?: string
  executionTabId: string
  hasSession: boolean
  restoring: boolean
}): string | undefined {
  if (!isMissingTerminalSessionError(input.error)) return input.error
  if (
    shouldBlockToolsWhileMainRestoring({
      hasSession: input.hasSession,
      restoring: input.restoring
    })
  ) {
    return MAIN_TERMINAL_RESTORING_ERROR
  }
  return input.error
}

export function shouldRestoreParentBashTab(input: {
  fromSubagent?: boolean
  executionTabId: string
  parentTabId: string
}): boolean {
  if (input.fromSubagent) return false
  return resolveParentTerminalTabId(input.executionTabId) === input.parentTabId.trim()
}

const execContextBySessionKey = new Map<string, PtyBashExecContext>()

registerPtyExecutionTabChecker((tabId) => {
  const id = tabId.trim()
  if (!id) return false
  for (const context of execContextBySessionKey.values()) {
    if (context.executionTabId === id) return true
  }
  return false
})

export function restorePtyBashExecutionToParentTab(parentTabId: string, ownerId?: number): void {
  const parent = parentTabId.trim()
  if (!parent) return
  for (const [sessionKey, context] of execContextBySessionKey.entries()) {
    if (ownerId !== undefined && context.webContents.id !== ownerId) continue
    if (
      !shouldRestoreParentBashTab({
        fromSubagent: context.fromSubagent,
        executionTabId: context.executionTabId,
        parentTabId: parent
      })
    ) {
      continue
    }
    if (
      context.executionTabId !== parent &&
      readTerminalPlanIdentity(context.webContents.id, context.executionTabId) ===
        context.executionTargetIdentity
    )
      continue
    if (
      !context.mainTarget?.identity ||
      readTerminalPlanIdentity(context.webContents.id, parent) !== context.mainTarget.identity
    )
      continue
    context.targetStack = []
    context.executionTargetIdentity = context.mainTarget.identity
    context.executionTabId = parent
    context.subterminalName = undefined
    context.isSsh = context.mainTarget.isSsh
    context.connectionId = context.mainTarget.connectionId
    execContextBySessionKey.set(sessionKey, context)
  }
}

registerMainTabLoginConfirmedHandler(restorePtyBashExecutionToParentTab)

export function setPtyBashExecContext(sessionKey: string, context: PtyBashExecContext): void {
  context.executionTargetIdentity = readTerminalPlanIdentity(
    context.webContents.id,
    context.executionTabId
  )
  context.failures ??= new CommandFailures()
  const currentTarget = readTerminalExecutionTarget(context.webContents.id, context.executionTabId)
  context.isSsh = currentTarget.executionMode === 'ssh'
  context.connectionId = currentTarget.connectionId
  const parentTabId = resolveParentTerminalTabId(context.executionTabId)
  const target = readTerminalExecutionTarget(context.webContents.id, parentTabId)
  if (context.approvalPolicy === 'safe-auto') {
    const identity = readTerminalPlanIdentity(context.webContents.id, context.executionTabId)
    if (identity) context.readonlyGrant = { identity, expiresAt: Date.now() + 10 * 60000 }
  }
  context.mainTarget = {
    tabId: parentTabId,
    identity: readTerminalPlanIdentity(context.webContents.id, parentTabId),
    isSsh: target.executionMode === 'ssh',
    connectionId: target.connectionId
  }
  if (!context.parentConnectionId?.trim()) {
    context.parentConnectionId = context.isSsh ? context.connectionId?.trim() : undefined
  }
  execContextBySessionKey.set(sessionKey, context)
}

export function getPtyBashExecContext(sessionKey: string): PtyBashExecContext | undefined {
  return execContextBySessionKey.get(sessionKey)
}

export function updatePtyBashExecutionTabId(
  sessionKey: string,
  executionTabId: string,
  environment?: { connectionId?: string; isSsh?: boolean }
): boolean {
  const existing = execContextBySessionKey.get(sessionKey)
  if (!existing) return false
  const nextId = executionTabId.trim()
  if (!nextId) return false
  const identity = readTerminalPlanIdentity(existing.webContents.id, nextId)
  const authoritative = readTerminalExecutionTarget(existing.webContents.id, nextId)
  if (
    !identity ||
    (environment && Boolean(environment.isSsh) !== (authoritative.executionMode === 'ssh'))
  )
    return false
  existing.restorationRequired = false
  existing.executionTargetIdentity = identity
  existing.executionTabId = nextId
  existing.subterminalName = undefined
  if (environment) {
    existing.isSsh = authoritative.executionMode === 'ssh'
    existing.connectionId = authoritative.connectionId
  }
  execContextBySessionKey.set(sessionKey, existing)
  return true
}

export function returnToMainTerminal(sessionKey: string): { ok: boolean; error?: string } {
  const context = getPtyBashExecContext(sessionKey)
  const target = context?.mainTarget
  if (!context || !target || context.fromSubagent)
    return { ok: false, error: 'No parent execution target in this scope.' }
  const current = readTerminalPlanIdentity(context.webContents.id, target.tabId)
  if (!target.identity || current !== target.identity) {
    context.restorationRequired = true
    return {
      ok: false,
      error:
        'Parent terminal is missing, replaced, or no longer verified. Select/reconnect the parent explicitly; no local fallback.'
    }
  }
  updatePtyBashExecutionTabId(sessionKey, target.tabId, target)
  context.targetStack = []
  return { ok: true }
}

export function pushTemporaryExecutionTarget(sessionKey: string): void {
  const context = getPtyBashExecContext(sessionKey)
  if (!context || context.fromSubagent) return
  const identity = readTerminalPlanIdentity(context.webContents.id, context.executionTabId)
  const target = readTerminalExecutionTarget(context.webContents.id, context.executionTabId)
  ;(context.targetStack ??= []).push({
    tabId: context.executionTabId,
    identity,
    isSsh: target.executionMode === 'ssh',
    connectionId: target.connectionId
  })
}
export function restoreTemporaryExecutionTarget(sessionKey: string): {
  ok: boolean
  error?: string
} {
  const context = getPtyBashExecContext(sessionKey)
  const target = context?.targetStack?.at(-1)
  if (
    !context ||
    !target ||
    !target.identity ||
    readTerminalPlanIdentity(context.webContents.id, target.tabId) !== target.identity
  )
    return {
      ok: false,
      error:
        'Temporary parent is unavailable or replaced; choose a verified target explicitly. No local fallback.'
    }
  updatePtyBashExecutionTabId(sessionKey, target.tabId, target)
  context.targetStack!.pop()
  return { ok: true }
}

export function bindPtyBashExecContextClone(input: {
  fromSessionKey: string
  toSessionKey: string
  executionTabId: string
  fromSubagent?: boolean
}): boolean {
  const parent = execContextBySessionKey.get(input.fromSessionKey)
  if (!parent) return false
  const executionTabId = input.executionTabId.trim()
  if (!executionTabId || !input.toSessionKey.trim()) return false
  const target = readTerminalExecutionTarget(parent.webContents.id, executionTabId)
  execContextBySessionKey.set(input.toSessionKey, {
    ...parent,
    isSsh: target.executionMode === 'ssh',
    connectionId: target.connectionId,
    executionTabId,
    executionTargetIdentity: readTerminalPlanIdentity(parent.webContents.id, executionTabId),
    subterminalName: undefined,
    fromSubagent: Boolean(input.fromSubagent),
    // Child panes keep an independent failure set so siblings/parent are not blocked.
    restorationRequired: false,
    failures: new CommandFailures(),
    targetStack: [],
    mainTarget: undefined
  })
  return true
}

export function clearPtyBashExecContext(sessionKey: string): void {
  execContextBySessionKey.delete(sessionKey)
}

export function clearPtyBashExecContextsForRun(runId: string): void {
  const normalized = runId.trim()
  if (!normalized) return
  for (const [key, context] of execContextBySessionKey.entries()) {
    if (context.runId !== normalized) continue
    execContextBySessionKey.delete(key)
  }
  clearPlansForRun(normalized)
  clearFailedSshSubterminalConnectionIds(normalized)
}

/**
 * Send Ctrl+C and settle any pending PTY command waiter for this agent run.
 * Awaits waiter settle so callers can emit `command/finished` before session abort.
 */
export async function interruptPtyCommandsForRun(runId: string): Promise<void> {
  const normalized = runId.trim()
  if (!normalized) return
  const waits: Promise<boolean>[] = []
  for (const context of execContextBySessionKey.values()) {
    if (context.runId !== normalized) continue
    if (context.webContents.isDestroyed()) continue
    waits.push(
      interruptAndAwaitPendingTerminalCommands(context.webContents.id, context.executionTabId)
    )
  }
  await Promise.all(waits)
}

/**
 * Stop-button ordering helper: PTY interrupt settle (and any microtask emits) before session abort.
 * Keeps tool-card `interrupted` events ahead of run-end/abort events.
 */
export async function settlePtyInterruptsBeforeSessionAbort(input: {
  settleInterrupts: () => Promise<void>
  abortSession: () => Promise<void>
}): Promise<void> {
  await input.settleInterrupts()
  // Flush microtasks so bash exec can emit command/finished before abort events.
  await Promise.resolve()
  await input.abortSession()
}

export function createPtyBashToolDefinition(
  pi: PiSdkFacade,
  cwd: string,
  sessionKey: string
): ReturnType<PiSdkFacade['createBashToolDefinition']> {
  const tool = pi.createBashToolDefinition(cwd, {
    operations: {
      async exec(command, _cwd, options) {
        const context = execContextBySessionKey.get(sessionKey)
        if (!context) {
          const message =
            'No active Crescent terminal context for bash. Select a terminal pane and retry.'
          throw new Error(message)
        }

        if (context.webContents.isDestroyed()) {
          throw new Error('Terminal webContents destroyed; command was not sent.')
        }

        const combinedSignal = combineAbortSignals(options.signal, context.signal)
        const result = await executeReviewedPtyCommand({
          sessionKey,
          context,
          command,
          timeoutMs:
            typeof options.timeout === 'number' && Number.isFinite(options.timeout)
              ? options.timeout * 1000
              : undefined,
          signal: combinedSignal
        })

        const output =
          result.code === 'SSH_TARGET_UNAVAILABLE'
            ? JSON.stringify({
                ok: false,
                code: result.code,
                expectedTarget: result.expectedHost,
                observedTarget: result.observedHost ?? 'unknown',
                connectionPhase: result.connectionPhase,
                recoveryAction: result.recoveryAction,
                message:
                  result.recoveryAction === 'wait-for-target-prompt'
                    ? 'The command was not sent. Wait for a fresh prompt from the expected SSH target after Ctrl+C, then re-check terminal state before continuing.'
                    : 'Stop querying this target until the operator reconnects or explicitly selects another target.'
              })
            : [
                redactSensitiveText(result.output),
                !result.ok
                  ? JSON.stringify({
                      outcome: commandOutcome(result),
                      dispatched: Boolean(result.dispatched),
                      exitCode: result.exitCode,
                      exitCodeTrusted:
                        result.exitCode !== undefined &&
                        !result.timedOut &&
                        !result.interrupted &&
                        !result.terminalExited,
                      safeToRepeat: isStaticallyReadonly(command),
                      next: result.timedOut
                        ? 'Wait for terminal completion or verify current state read-only; never replay mutations automatically.'
                        : 'Review evidence and request a new approval for mutations.'
                    })
                  : '',
                result.error
              ]
                .filter(Boolean)
                .join('\n')
        if (output) options.onData(Buffer.from(output.endsWith('\n') ? output : `${output}\n`))

        if (combinedSignal?.aborted) throw new Error('Command interrupted.')
        if (!result.dispatched || result.interrupted || result.timedOut || result.terminalExited) {
          throw new Error(
            result.error ||
              (result.dispatched
                ? 'Command completion could not be confirmed; verify the terminal before continuing.'
                : 'Command was blocked before terminal dispatch.')
          )
        }
        if (result.exitCode === undefined) {
          throw new Error(
            'Command completion could not be confirmed; verify the terminal before continuing.'
          )
        }
        return { exitCode: result.exitCode }
      }
    }
  })
  // Prefer sequential bash tool calls; exclusive per-tab lock in
  // executeCommandInTerminal remains the hard gate against same-pane conflicts.
  return {
    ...tool,
    description:
      tool.description +
      ' Crescent bash executes on the host-bound terminal target, which may be SSH. Local read/edit/write use the client workspace independently. The selected terminal remains bound across commands. Only an explicitly requested temporary=true visit returns after one bash call.',
    executionMode: 'sequential'
  }
}

export async function executeReviewedPtyCommand(input: {
  sessionKey: string
  context: PtyBashExecContext
  command: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Main-only callback; never accepted from renderer or model arguments. */
  planGuard?: () => void
}): Promise<TerminalCommandExecutionResult> {
  const { context, sessionKey } = input
  const executableCommand = input.planGuard
    ? input.command
    : normalizeInteractivePrivilegeCommand(input.command)
  const policy = normalizeCommandTimeoutPolicy(context.config.commandTimeouts)
  const timeoutMs = normalizeTimeout(input.timeoutMs ?? policy.executionMs)
  const executionTabId = context.executionTabId
  const fromSubagent = context.fromSubagent || undefined
  const targetBinding = readTerminalPlanIdentity(context.webContents.id, executionTabId)
  const readonly = isStaticallyReadonly(executableCommand)
  const failures = (context.failures ??= new CommandFailures())
  const fingerprint = failures.key(executableCommand, targetBinding ?? executionTabId)
  const executionId = randomUUID()
  const blocked = (
    error: string,
    outcome: 'blocked-before-dispatch' | 'approval-denied' = 'blocked-before-dispatch'
  ): TerminalCommandExecutionResult => {
    if (context.targetStack?.length) {
      const restored = restoreTemporaryExecutionTarget(sessionKey)
      context.restorationRequired = !restored.ok
      if (!restored.ok) error += `\n${restored.error}`
    }
    const result = { ok: false, command: executableCommand, output: '', error, outcome }
    context.emit({
      type: 'command',
      phase: 'finished',
      executionId,
      lifecycle: 'blocked-before-dispatch',
      command: executableCommand,
      result,
      runId: context.runId,
      tabId: executionTabId,
      fromSubagent
    })
    return result
  }

  if (context.restorationRequired)
    return blocked(
      'The temporary task ended but its parent target is unverified. Explicitly reconnect/select the main target; this command cannot run on the local child.'
    )
  if (!targetBinding || targetBinding !== context.executionTargetIdentity)
    return blocked('Execution target is unavailable or unverified; no command was sent.')
  const advice = failures.advice(fingerprint)
  if (advice.message)
    context.emit({
      type: 'status',
      message: advice.message,
      runId: context.runId,
      tabId: executionTabId,
      fromSubagent
    })
  if (advice.block) return blocked(advice.message!)
  if (!readonly && context.mutationPolicy === 'manual-execution')
    return blocked(
      'Manual execution selected. Show the exact command and target to the user; the Agent cannot execute this mutation.'
    )

  if (
    context.executionMode === 'planned' &&
    !input.planGuard &&
    (planBlocksBash(context.runId) || !isStaticallyReadonly(executableCommand))
  ) {
    return blocked(
      'Planned execution permits read-only investigation only. Submit a new exact change plan for approval; no out-of-plan command was executed.'
    )
  }

  const executeWithProgress = async (): Promise<TerminalCommandExecutionResult> => {
    if (input.signal?.aborted) {
      const result = { ok: false, command: executableCommand, output: '', interrupted: true }
      context.emit({
        type: 'command',
        phase: 'finished',
        executionId,
        lifecycle: 'interrupted',
        command: executableCommand,
        result,
        runId: context.runId,
        tabId: executionTabId,
        fromSubagent
      })
      return result
    }
    try {
      if (
        context.executionTabId !== executionTabId ||
        readTerminalPlanIdentity(context.webContents.id, executionTabId) !== targetBinding
      )
        throw new Error(
          'Execution target changed during review/approval. Review again on the current target.'
        )
      input.planGuard?.()
    } catch (cause) {
      return blocked(cause instanceof Error ? cause.message : String(cause))
    }
    const startedAt = Date.now()
    const batchPlan = planReadonlyBatch(executableCommand)
    const ptyCommand =
      !input.planGuard && batchPlan.inject ? batchPlan.ptyCommand : executableCommand

    const onDispatched = (): void => {
      context.emit({
        type: 'command',
        phase: 'started',
        executionId,
        command: executableCommand,
        runId: context.runId,
        tabId: executionTabId,
        executionTarget: context.subterminalName
          ? undefined
          : readTerminalExecutionTarget(context.webContents.id, executionTabId),
        fromSubagent
      })
    }

    const runOnTab = async (tabId: string): Promise<TerminalCommandExecutionResult> =>
      context.subterminalName
        ? executeCommandInTemporaryTerminal(
            context.webContents,
            tabId,
            context.subterminalName,
            ptyCommand,
            timeoutMs,
            'wait',
            input.signal,
            Boolean(context.isSsh),
            onDispatched
          )
        : executeCommandInTerminalWithPermissionRequest(
            context.webContents,
            ptyCommand,
            timeoutMs,
            tabId,
            input.signal,
            Boolean(
              context.isSsh ||
              (tabId === context.executionTabId ? false : context.parentConnectionId)
            ),
            onDispatched
          )

    const targetTabId = executionTabId
    let result = await runOnTab(targetTabId)
    // A closed child never silently moves this command to a different machine.
    if (!result.dispatched && isMissingTerminalSessionError(result.error))
      result.error += ' Use return_to_main_terminal and review the command for that target.'

    if (!result.ok && isMissingTerminalSessionError(result.error)) {
      const parentTabId = resolveParentTerminalTabId(targetTabId)
      const health = readTerminalSessionHealth(context.webContents.id, parentTabId)
      result = {
        ...result,
        error: rewriteMissingSessionErrorForMainRestore({
          error: result.error,
          executionTabId: targetTabId,
          hasSession: health.hasSession,
          restoring: health.restoring
        })
      }
    }

    const updatedIdentity = readTerminalPlanIdentity(context.webContents.id, targetTabId)
    if (
      result.dispatched &&
      updatedIdentity &&
      targetBinding &&
      context.executionTabId === targetTabId &&
      updatedIdentity !== targetBinding
    ) {
      // Our own confirmed cd updates cwd without changing the machine or PTY.
      try {
        const before = JSON.parse(targetBinding)
        const after = JSON.parse(updatedIdentity)
        delete before.cwd
        delete after.cwd
        if (JSON.stringify(before) === JSON.stringify(after)) {
          context.executionTargetIdentity = updatedIdentity
          context.readonlyGrant = undefined
        }
      } catch {
        /* Opaque bindings are never refreshed without proof. */
      }
    }

    failures.record(fingerprint, readonly, result)
    result.outcome = commandOutcome(result)
    if (context.targetStack?.length) {
      const restored = restoreTemporaryExecutionTarget(sessionKey)
      context.restorationRequired = !restored.ok
      if (!restored.ok)
        context.emit({
          type: 'status',
          message: restored.error!,
          runId: context.runId,
          tabId: executionTabId
        })
    }

    const { formatted } = applyBatchOutputFormatting(batchPlan, result.output || '')
    const formattedResult: TerminalCommandExecutionResult = {
      ...result,
      command: executableCommand,
      output: input.planGuard ? result.output : batchPlan.inject ? formatted : result.output
    }

    context.emit({
      type: 'command',
      phase: 'finished',
      executionId,
      lifecycle: !formattedResult.dispatched
        ? 'blocked-before-dispatch'
        : formattedResult.interrupted
          ? 'interrupted'
          : formattedResult.timedOut
            ? 'timed-out'
            : formattedResult.terminalExited || formattedResult.exitCode === undefined
              ? 'completion-unknown'
              : 'completed',
      command: executableCommand,
      result: {
        ok: formattedResult.ok,
        outcome: formattedResult.outcome,
        command: executableCommand,
        mode: formattedResult.mode,
        cwd: formattedResult.cwd,
        exitCode:
          formattedResult.dispatched &&
          !formattedResult.interrupted &&
          !formattedResult.timedOut &&
          !formattedResult.terminalExited
            ? formattedResult.exitCode
            : undefined,
        output: input.planGuard
          ? '[Plan output withheld; checked by host.]'
          : formattedResult.output,
        error:
          input.planGuard && formattedResult.error ? 'Plan command failed.' : formattedResult.error,
        timedOut: formattedResult.timedOut,
        interrupted: formattedResult.interrupted,
        terminalExited: formattedResult.terminalExited,
        detached: formattedResult.detached,
        code: formattedResult.code,
        connectionPhase: formattedResult.connectionPhase,
        recoveryAction: formattedResult.recoveryAction,
        expectedHost: formattedResult.expectedHost,
        observedHost: formattedResult.observedHost,
        subterminalName: formattedResult.subterminalName,
        subterminalTabId: formattedResult.subterminalTabId
      },
      elapsedMs: Date.now() - startedAt,
      runId: context.runId,
      tabId: formattedResult.subterminalTabId || targetTabId,
      executionTarget: readTerminalExecutionTarget(
        context.webContents.id,
        formattedResult.subterminalTabId || targetTabId
      ),
      fromSubagent
    })

    return formattedResult
  }

  context.emit({
    type: 'status',
    message: 'Command review is classifying risk.',
    runId: context.runId,
    tabId: executionTabId,
    fromSubagent
  })

  const classified = await classifyCommand(executableCommand, {
    config: context.config,
    userInput: context.userInput,
    terminalContext: context.terminalContext,
    locale: context.locale
  }).catch(() => undefined)
  if (!classified)
    return blocked('Command review failed. Automatic approval is denied; no command was sent.')
  const autoAllowed =
    classified.level === 'low' &&
    canAutomaticallyApprove(executableCommand, {
      policy: context.approvalPolicy ?? 'manual',
      grantValid: Boolean(
        context.readonlyGrant &&
        Date.now() < context.readonlyGrant.expiresAt &&
        context.readonlyGrant.identity === targetBinding
      )
    })

  context.emit({
    type: 'command-review',
    command: executableCommand,
    audit: {
      ...classified.audit,
      requiresApproval: !autoAllowed && !input.planGuard,
      risk: autoAllowed ? 'low' : 'high'
    },
    runId: context.runId,
    tabId: executionTabId,
    fromSubagent
  })

  if (input.planGuard) return executeWithProgress()

  if (autoAllowed) {
    context.emit({
      type: 'status',
      message:
        classified.source === 'whitelist'
          ? `Command matched whitelist: ${classified.whitelistRule}`
          : `Auto-approved by deterministic read-only policy (${context.approvalPolicy ?? 'manual'}), bound to this run, pane and generation.`,
      runId: context.runId,
      tabId: executionTabId,
      fromSubagent
    })
    return executeWithProgress()
  }

  const approval = await requestCommandApproval({
    webContents: context.webContents,
    runId: context.runId,
    tabId: executionTabId,
    chatTabId: context.chatTabId,
    command: executableCommand,
    timeoutMs: policy.approvalMs,
    audit: { ...classified.audit, requiresApproval: true },
    signal: input.signal,
    locale: context.locale,
    config: context.config
  })

  if (!approval.approved) {
    const rejectionReason = (approval.rejectionReason || approval.note || '').trim()
    context.emit({
      type: 'status',
      message: rejectionReason
        ? `Command rejected by user.\nUser rejection reason: ${rejectionReason}`
        : 'Command rejected by user.',
      runId: context.runId,
      tabId: executionTabId,
      fromSubagent
    })
    return blocked(
      [
        'Command execution was rejected by the user. Continue from this result and do not assume the command ran.',
        rejectionReason ? `User rejection reason: ${rejectionReason}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      'approval-denied'
    )
  }

  context.emit({
    type: 'status',
    message: approval.note?.trim()
      ? `Command approved by user.\nUser approval note: ${approval.note.trim()}`
      : 'Command approved by user.',
    runId: context.runId,
    tabId: executionTabId,
    fromSubagent
  })

  const result = await executeWithProgress()
  return withUserApprovalNote(result, approval.note)
}

/** Prefix tool-visible command result with the operator's approve note (model-readable). */
export function withUserApprovalNote(
  result: TerminalCommandExecutionResult,
  note: string | undefined
): TerminalCommandExecutionResult {
  const trimmed = note?.trim()
  if (!trimmed) return result
  const prefix = `User approval note: ${trimmed}`
  if (result.ok) {
    return {
      ...result,
      output: [prefix, result.output].filter(Boolean).join('\n\n')
    }
  }
  return {
    ...result,
    error: [prefix, result.error].filter(Boolean).join('\n\n')
  }
}

function normalizeInteractivePrivilegeCommand(command: string): string {
  return command.replace(/(^|[;&|]\s*)sudo\s+(?:-n|--non-interactive)\s+/g, '$1sudo ')
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 120_000
  }
  return Math.min(Math.max(Math.floor(timeoutMs), 1_000), 10 * 60_000)
}

/** Exported for unit tests — Pi bash `timeout` is seconds; Crescent uses ms. */
export function timeoutSecondsToMs(timeoutSeconds: number | undefined): number {
  return normalizeTimeout(
    typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds)
      ? timeoutSeconds * 1000
      : undefined
  )
}

function combineAbortSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined
): AbortSignal | undefined {
  if (!a) return b
  if (!b) return a
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal) {
    return AbortSignal.any([a, b])
  }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (a.aborted || b.aborted) {
    controller.abort()
    return controller.signal
  }
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  return controller.signal
}
