import type { WebContents } from 'electron'

import {
  executeCommandInTemporaryTerminal,
  executeCommandInTerminalWithPermissionRequest,
  type TerminalCommandExecutionResult
} from '../terminal/ipc'
import { CommandAuditor } from './command-auditor'
import { requestCommandApproval } from './command-approval'
import { matchCommandWhitelist } from './command-whitelist'
import type { PiCodingAgentModule } from './pi-sdk'
import type { AgentConfig, AgentEvent, CommandAuditResult } from './types'

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
}

const execContextBySessionKey = new Map<string, PtyBashExecContext>()

export function setPtyBashExecContext(sessionKey: string, context: PtyBashExecContext): void {
  execContextBySessionKey.set(sessionKey, context)
}

export function clearPtyBashExecContext(sessionKey: string): void {
  execContextBySessionKey.delete(sessionKey)
}

export function createPtyBashToolDefinition(
  pi: PiCodingAgentModule,
  cwd: string,
  sessionKey: string
): ReturnType<PiCodingAgentModule['createBashToolDefinition']> {
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
          timeoutMs: options.timeout,
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

  const executeWithProgress = async (): Promise<TerminalCommandExecutionResult> => {
    const startedAt = Date.now()
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
          executableCommand,
          timeoutMs,
          'wait'
        )
      : await executeCommandInTerminalWithPermissionRequest(
          context.webContents,
          executableCommand,
          timeoutMs,
          executionTabId
        )

    context.emit({
      type: 'command',
      phase: 'finished',
      command: executableCommand,
      result: {
        ok: result.ok,
        command: result.command,
        mode: result.mode,
        cwd: result.cwd,
        exitCode: result.exitCode,
        output: result.output,
        error: result.error,
        timedOut: result.timedOut,
        terminalExited: result.terminalExited,
        detached: result.detached,
        subterminalName: result.subterminalName,
        subterminalTabId: result.subterminalTabId
      },
      elapsedMs: Date.now() - startedAt,
      runId: context.runId,
      tabId: result.subterminalTabId || executionTabId
    })

    return result
  }

  const whitelistRule = matchCommandWhitelist(
    executableCommand,
    context.config.commandWhitelist ?? []
  )
  if (whitelistRule) {
    context.emit({
      type: 'status',
      message: `Command matched whitelist: ${whitelistRule}`,
      runId: context.runId,
      tabId: executionTabId
    })
    return executeWithProgress()
  }

  context.emit({
    type: 'status',
    message: 'Command review subprocess is analyzing risk.',
    runId: context.runId,
    tabId: executionTabId
  })

  const auditor = new CommandAuditor(context.config)
  const audit: CommandAuditResult = await auditor.audit({
    command: executableCommand,
    userInput: context.userInput,
    terminalContext: context.terminalContext ?? '',
    locale: context.locale
  })

  context.emit({
    type: 'command-review',
    command: executableCommand,
    audit,
    runId: context.runId,
    tabId: executionTabId
  })

  if (!audit.requiresApproval) {
    context.emit({
      type: 'status',
      message: 'Command audit classified this as read-only inspection.',
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
    audit,
    signal: input.signal
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
      ? `Command approved by user.\nUser note: ${approval.note.trim()}`
      : 'Command approved by user.',
    runId: context.runId,
    tabId: executionTabId
  })

  return executeWithProgress()
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
