import {
  TERMINAL_CTRL_C_CONFIRM_MS,
  detectsTerminalCtrlC,
  hasLikelyShellPrompt
} from './command-interrupt'
import type { CommandOutcome } from '../../shared/command-outcome'

export interface PendingCommandResult {
  ok: boolean
  command: string
  mode?: 'pty' | 'pipe'
  cwd?: string
  exitCode?: number
  output: string
  error?: string
  timedOut?: boolean
  interrupted?: boolean
  terminalExited?: boolean
  outcome?: CommandOutcome
}
export interface PendingCommandTimers {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}
export interface CreatePendingCommandControllerInput {
  command: string
  mode: 'pty' | 'pipe'
  cwd: string
  startMarker: string
  endMarker: string
  timeoutMs: number
  signal?: AbortSignal
  interruptGraceMs?: number
  ctrlCConfirmMs?: number
  startTimeoutMs?: number
  idleTimeoutMs?: number
  continuationPromptTimeoutMs?: number
  secretPromptTimeoutMs?: number
  deferDispatch?: boolean
  interruptSession: () => void
  onTimeout?: () => void
  display?: (message: string) => void
  onPhase?: (phase: string) => void
  hasUnterminatedSecretPrompt?: (buffer: string) => boolean
  hasShellContinuationPrompt?: (buffer: string) => boolean
  parseCommandBuffer: (
    buffer: string,
    startMarker: string,
    endMarker: string
  ) => { done: boolean; exitCode?: number; output: string }
  extractPartialCommandOutput: (buffer: string, startMarker: string) => string
  timers?: PendingCommandTimers
}
export interface PendingCommandController {
  onData: (data: string) => void
  onExit: (event: { exitCode: number; signal?: number | string }) => void
  notifyUserInterrupt: () => void
  failDispatch: (message: string) => void
  markDispatching: () => void
  markDispatched: () => void
  continueWaiting: (ms?: number) => boolean
  promise: Promise<PendingCommandResult>
}
/** Deadlines describe command uncertainty. Only explicit user/run cancellation sends SIGINT. */
export function createPendingCommandController(
  input: CreatePendingCommandControllerInput
): PendingCommandController {
  const timers = input.timers ?? { setTimeout, clearTimeout }
  const startMs = Math.max(1000, Math.min(60000, input.startTimeoutMs ?? 30000))
  const hardMs = Math.max(1000, Math.min(600000, input.timeoutMs))
  let buffer = ''
  let settled = false
  let dispatched = false
  let transportAccepted = false
  let started = false
  let waitingSecret = false
  let continuationWarned = false
  const handles = new Map<string, ReturnType<typeof setTimeout>>()
  let resolve!: (result: PendingCommandResult) => void
  const promise = new Promise<PendingCommandResult>((r) => {
    resolve = r
  })
  function clear(name: string): void {
    const handle = handles.get(name)
    if (handle !== undefined) timers.clearTimeout(handle)
    handles.delete(name)
  }
  function arm(name: string, ms: number, fn: () => void): void {
    clear(name)
    handles.set(
      name,
      timers.setTimeout(() => {
        handles.delete(name)
        if (!settled) fn()
      }, ms)
    )
  }
  function settle(result: Partial<PendingCommandResult>): void {
    if (settled) return
    settled = true
    for (const name of handles.keys()) clear(name)
    input.signal?.removeEventListener('abort', onAbort)
    resolve({
      ok: false,
      command: input.command,
      mode: input.mode,
      cwd: input.cwd,
      output: input.extractPartialCommandOutput(buffer, input.startMarker),
      ...result
    })
  }
  function deadline(): void {
    input.onTimeout?.()
    const outcome = started ? 'completion-unknown' : 'timeout-unconfirmed'
    input.onPhase?.(outcome)
    settle({
      timedOut: true,
      outcome,
      error:
        'Command result is unconfirmed. No interrupt was sent. Do not replay mutations; inspect the terminal or verify current state read-only.'
    })
  }
  function warn(message: string, phase: string): void {
    input.onPhase?.(phase)
    input.display?.(`\r\n[Crescent] ${message} Continue waiting or interrupt manually.\r\n`)
  }
  function armIdle(): void {
    arm('idle', Math.max(1000, input.idleTimeoutMs ?? 30000), () =>
      warn('No recent command output.', 'idle-warning')
    )
  }
  function markDispatching(): void {
    if (settled) return
    dispatched = true
    input.onPhase?.('dispatching')
    arm('transport-warning', startMs, () =>
      warn(
        'PTY transmission is awaiting confirmation; SSH health is unchanged.',
        'timeout-unconfirmed'
      )
    )
  }
  function markDispatched(): void {
    if (transportAccepted || settled) return
    transportAccepted = true
    clear('transport-warning')
    dispatched = true
    input.onPhase?.('dispatched')
    if (started) return
    arm('start', startMs, () => {
      if (!started && !waitingSecret)
        warn('Execution start is unconfirmed; SSH health is unchanged.', 'timeout-unconfirmed')
    })
    arm('hard', Math.min(600000, Math.max(60000, startMs * 2)), deadline)
  }
  function continueWaiting(ms = hardMs): boolean {
    if (settled || !dispatched) return false
    arm('hard', Math.max(1000, Math.min(600000, Number.isFinite(ms) ? ms : hardMs)), deadline)
    armIdle()
    input.onPhase?.('waiting')
    return true
  }
  function onAbort(): void {
    if (settled) return
    if (dispatched) input.interruptSession()
    settle({
      interrupted: true,
      outcome: dispatched ? 'user-cancelled' : 'blocked-before-dispatch',
      error: 'Canceled by user/run. Verify terminal state before repeating a mutation.'
    })
  }
  function onData(data: string): void {
    if (settled) return
    buffer += data
    // Keep a bounded transcript while retaining the start sentinel across truncation.
    if (buffer.length > 1024 * 1024)
      buffer = (started ? `${input.startMarker}\n` : '') + buffer.slice(-512 * 1024)
    if (!started && new RegExp(`(?:^|[\\r\\n])${input.startMarker}(?:[\\r\\n]|$)`).test(buffer)) {
      started = true
      clear('start')
      input.onPhase?.('started')
      arm('hard', hardMs, deadline)
    }
    const parsed = input.parseCommandBuffer(buffer, input.startMarker, input.endMarker)
    if (parsed.done) {
      settle({
        ok: parsed.exitCode === 0,
        exitCode: parsed.exitCode,
        output: parsed.output,
        outcome: parsed.exitCode === 0 ? 'completed' : 'confirmed-exit-nonzero'
      })
      return
    }
    if (detectsTerminalCtrlC(data)) {
      if (hasLikelyShellPrompt(buffer)) settle({ interrupted: true, outcome: 'user-cancelled' })
      else
        arm('ctrlc', input.ctrlCConfirmMs ?? TERMINAL_CTRL_C_CONFIRM_MS, () =>
          settle({ interrupted: true, outcome: 'user-cancelled' })
        )
      return
    }
    const secret = Boolean(input.hasUnterminatedSecretPrompt?.(buffer))
    if (secret && !waitingSecret) {
      waitingSecret = true
      clear('start')
      arm('hard', input.secretPromptTimeoutMs ?? 300000, deadline)
      input.onPhase?.('awaiting-input')
    } else if (!secret && waitingSecret) {
      waitingSecret = false
      arm('hard', started ? hardMs : Math.max(60000, startMs * 2), deadline)
    }
    if (started && !waitingSecret) {
      armIdle()
      if (input.hasShellContinuationPrompt?.(buffer) && !continuationWarned) {
        continuationWarned = true
        arm('continuation', input.continuationPromptTimeoutMs ?? 5000, () => {
          if (input.hasShellContinuationPrompt?.(buffer))
            warn('Possible shell continuation; completion remains unconfirmed.', 'awaiting-input')
        })
      }
    }
  }
  function onExit(event: { exitCode: number }): void {
    settle({
      terminalExited: true,
      outcome: 'session-exited',
      error: `Terminal exited (${event.exitCode}) before command completion.`
    })
  }
  if (!input.deferDispatch) markDispatched()
  if (input.signal?.aborted) onAbort()
  else input.signal?.addEventListener('abort', onAbort, { once: true })
  return {
    onData,
    onExit,
    notifyUserInterrupt: onAbort,
    failDispatch: (message) => {
      input.onPhase?.('timeout-unconfirmed')
      settle({
        timedOut: true,
        outcome: started ? 'completion-unknown' : 'timeout-unconfirmed',
        error: message
      })
    },
    markDispatching,
    markDispatched,
    continueWaiting,
    promise
  }
}
