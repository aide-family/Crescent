import type { WebContents } from 'electron'

import { normalizeCommand } from '../../shared/command-guard'
import { applyBatchOutputFormatting, planReadonlyBatch } from '../../shared/readonly-batch'
import {
  executeCommandInTemporaryTerminal,
  executeCommandInTerminalWithPermissionRequest,
  interruptAndAwaitPendingTerminalCommands,
  type TerminalCommandExecutionResult
} from '../terminal/ipc'
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
  emit: (event: AgentEvent) => void
  signal?: AbortSignal
  /**
   * When set, run the command in a named temporary subterminal docked under
   * the execution tab instead of the main pane.
   */
  subterminalName?: string
  /** Fingerprints of commands that already failed in this run (normalized). */
  failedFingerprints?: Set<string>
}

/** Run-scoped failed command fingerprints (shared across session context updates). */
const failedFingerprintsByRunId = new Map<string, Set<string>>()

export function getFailedCommandFingerprints(runId: string): Set<string> {
  let set = failedFingerprintsByRunId.get(runId)
  if (!set) {
    set = new Set()
    failedFingerprintsByRunId.set(runId, set)
  }
  return set
}

export function clearFailedCommandFingerprints(runId: string): void {
  failedFingerprintsByRunId.delete(runId)
}

/** Pure helper for tests: whether a normalized fingerprint is blocked. */
export function shouldBlockFailedRetry(fingerprint: string, failed: ReadonlySet<string>): boolean {
  return Boolean(fingerprint && failed.has(fingerprint))
}

const execContextBySessionKey = new Map<string, PtyBashExecContext>()

export function setPtyBashExecContext(sessionKey: string, context: PtyBashExecContext): void {
  context.failedFingerprints = getFailedCommandFingerprints(context.runId)
  execContextBySessionKey.set(sessionKey, context)
}

export function getPtyBashExecContext(sessionKey: string): PtyBashExecContext | undefined {
  return execContextBySessionKey.get(sessionKey)
}

export function updatePtyBashExecutionTabId(sessionKey: string, executionTabId: string): boolean {
  const existing = execContextBySessionKey.get(sessionKey)
  if (!existing) return false
  const nextId = executionTabId.trim()
  if (!nextId) return false
  existing.executionTabId = nextId
  existing.subterminalName = undefined
  execContextBySessionKey.set(sessionKey, existing)
  return true
}

export function clearPtyBashExecContext(sessionKey: string): void {
  const existing = execContextBySessionKey.get(sessionKey)
  if (existing?.runId) clearFailedCommandFingerprints(existing.runId)
  execContextBySessionKey.delete(sessionKey)
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
  return pi.createBashToolDefinition(cwd, {
    operations: {
      async exec(command, _cwd, options) {
        const context = execContextBySessionKey.get(sessionKey)
        if (!context) {
          const message =
            'No active Crescent terminal context for bash. Select a terminal pane and retry.'
          options.onData(Buffer.from(`${message}\n`))
          return { exitCode: 1 }
        }

        if (context.webContents.isDestroyed()) {
          options.onData(Buffer.from('Terminal webContents destroyed.\n'))
          return { exitCode: 1 }
        }

        const combinedSignal = combineAbortSignals(options.signal, context.signal)
        const result = await executeReviewedPtyCommand({
          context,
          command,
          timeoutMs:
            typeof options.timeout === 'number' && Number.isFinite(options.timeout)
              ? options.timeout * 1000
              : undefined,
          signal: combinedSignal
        })

        const output = [result.output, result.error].filter(Boolean).join('\n')
        if (output) options.onData(Buffer.from(output.endsWith('\n') ? output : `${output}\n`))

        if (combinedSignal?.aborted) return { exitCode: null }
        return { exitCode: result.exitCode ?? (result.ok ? 0 : 1) }
      }
    }
  })
}

async function executeReviewedPtyCommand(input: {
  context: PtyBashExecContext
  command: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<TerminalCommandExecutionResult> {
  const { context } = input
  const executableCommand = normalizeInteractivePrivilegeCommand(input.command)
  const timeoutMs = normalizeTimeout(input.timeoutMs)
  const executionTabId = context.executionTabId
  const fingerprint = normalizeCommand(executableCommand)
  const failed = context.failedFingerprints ?? getFailedCommandFingerprints(context.runId)
  const zh = Boolean(context.locale?.toLowerCase().startsWith('zh'))

  if (shouldBlockFailedRetry(fingerprint, failed)) {
    const message = zh
      ? '该命令本轮已失败过一次，禁止原样重试。请分析 stderr 后换方案（不要再次提交相同命令以免重复审批）。'
      : 'This command already failed once in this run. Do not retry it unchanged — analyze stderr and try a different approach (avoid re-triggering approval).'
    context.emit({
      type: 'status',
      message,
      runId: context.runId,
      tabId: executionTabId
    })
    return {
      ok: false,
      command: executableCommand,
      output: '',
      error: message
    }
  }

  const executeWithProgress = async (): Promise<TerminalCommandExecutionResult> => {
    const startedAt = Date.now()
    const batchPlan = planReadonlyBatch(executableCommand)
    const ptyCommand = batchPlan.inject ? batchPlan.ptyCommand : executableCommand

    context.emit({
      type: 'command',
      phase: 'started',
      command: executableCommand,
      runId: context.runId,
      tabId: executionTabId
    })

    const result = context.subterminalName
      ? await executeCommandInTemporaryTerminal(
          context.webContents,
          executionTabId,
          context.subterminalName,
          ptyCommand,
          timeoutMs,
          'wait',
          input.signal
        )
      : await executeCommandInTerminalWithPermissionRequest(
          context.webContents,
          ptyCommand,
          timeoutMs,
          executionTabId,
          input.signal
        )

    if (!result.ok && fingerprint) {
      failed.add(fingerprint)
    }

    const { formatted } = applyBatchOutputFormatting(batchPlan, result.output || '')
    const formattedResult: TerminalCommandExecutionResult = {
      ...result,
      command: executableCommand,
      output: batchPlan.inject ? formatted : result.output
    }

    context.emit({
      type: 'command',
      phase: 'finished',
      command: executableCommand,
      result: {
        ok: formattedResult.ok,
        command: executableCommand,
        mode: formattedResult.mode,
        cwd: formattedResult.cwd,
        exitCode: formattedResult.exitCode,
        output: formattedResult.output,
        error: formattedResult.error,
        timedOut: formattedResult.timedOut,
        interrupted: formattedResult.interrupted,
        terminalExited: formattedResult.terminalExited,
        detached: formattedResult.detached,
        subterminalName: formattedResult.subterminalName,
        subterminalTabId: formattedResult.subterminalTabId
      },
      elapsedMs: Date.now() - startedAt,
      runId: context.runId,
      tabId: formattedResult.subterminalTabId || executionTabId
    })

    return formattedResult
  }

  context.emit({
    type: 'status',
    message: 'Command review is classifying risk.',
    runId: context.runId,
    tabId: executionTabId
  })

  const classified = await classifyCommand(executableCommand, {
    config: context.config,
    userInput: context.userInput,
    terminalContext: context.terminalContext,
    locale: context.locale
  })

  context.emit({
    type: 'command-review',
    command: executableCommand,
    audit: classified.audit,
    runId: context.runId,
    tabId: executionTabId
  })

  if (classified.level === 'low') {
    context.emit({
      type: 'status',
      message:
        classified.source === 'whitelist'
          ? `Command matched whitelist: ${classified.whitelistRule}`
          : 'Command audit classified this as read-only inspection.',
      runId: context.runId,
      tabId: executionTabId
    })
    return executeWithProgress()
  }

  const approval = await requestCommandApproval({
    webContents: context.webContents,
    runId: context.runId,
    tabId: executionTabId,
    chatTabId: context.chatTabId,
    command: executableCommand,
    timeoutMs,
    audit: classified.audit,
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
      tabId: executionTabId
    })
    return {
      ok: false,
      command: executableCommand,
      output: '',
      error: [
        'Command execution was rejected by the user. Continue from this result and do not assume the command ran.',
        rejectionReason ? `User rejection reason: ${rejectionReason}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  context.emit({
    type: 'status',
    message: approval.note?.trim()
      ? `Command approved by user.\nUser approval note: ${approval.note.trim()}`
      : 'Command approved by user.',
    runId: context.runId,
    tabId: executionTabId
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
    return 60_000
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
