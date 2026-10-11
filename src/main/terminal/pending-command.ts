import {
  TERMINAL_CTRL_C_CONFIRM_MS,
  buildInterruptedCommandError,
  buildTimeoutCommandError,
  detectsTerminalCtrlC,
  hasLikelyShellPrompt
} from './command-interrupt'
import {
  TERMINAL_COMMAND_START_DEADLINE_FLOOR_MS,
  TERMINAL_COMMAND_START_TIMEOUT_BASE_MS
} from './script-runner'

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
  /** Grace after we send Ctrl+C for hard timeout before forcing settle. */
  interruptGraceMs?: number
  /** Wait after observing ^C before settle (unless prompt returns sooner). */
  ctrlCConfirmMs?: number
  /** Idle wait for start marker; re-armed on PTY progress before start. */
  startTimeoutMs?: number
  /** Absolute wall-clock cap from write; prevents infinite idle-reset. */
  startDeadlineMs?: number
  continuationPromptTimeoutMs?: number
  secretPromptTimeoutMs?: number
  interruptSession: () => void
  onTimeout?: () => void
  display?: (message: string) => void
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
  /** External interrupt (user terminal:write \\x03 or Stop button). */
  notifyUserInterrupt: () => void
  promise: Promise<PendingCommandResult>
}

/**
 * Pure-ish pending-command waiter: sentinel completion + Ctrl+C interrupt + hard timeout.
 * Used by terminal ipc and unit tests (no real PTY required).
 */
export function createPendingCommandController(
  input: CreatePendingCommandControllerInput
): PendingCommandController {
  const timers = input.timers ?? { setTimeout, clearTimeout }
  const interruptGraceMs = input.interruptGraceMs ?? 2_000
  const ctrlCConfirmMs = input.ctrlCConfirmMs ?? TERMINAL_CTRL_C_CONFIRM_MS
  const startTimeoutMs = input.startTimeoutMs ?? TERMINAL_COMMAND_START_TIMEOUT_BASE_MS
  const startDeadlineMs = input.startDeadlineMs ?? TERMINAL_COMMAND_START_DEADLINE_FLOOR_MS
  const continuationPromptTimeoutMs = input.continuationPromptTimeoutMs ?? 5_000
  const secretPromptTimeoutMs = input.secretPromptTimeoutMs ?? 300_000

  let buffer = ''
  let settled = false
  let timeoutTriggered = false
  let commandStarted = false
  let waitingForSecretPrompt = false
  let interruptGraceTimeout: ReturnType<typeof setTimeout> | undefined
  let continuationPromptTimeout: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let startTimeout: ReturnType<typeof setTimeout> | undefined
  let startDeadlineTimeout: ReturnType<typeof setTimeout> | undefined
  let ctrlCConfirmTimeout: ReturnType<typeof setTimeout> | undefined
  let resolvePromise!: (result: PendingCommandResult) => void

  const promise = new Promise<PendingCommandResult>((resolve) => {
    resolvePromise = resolve
  })

  const clearStartWatchdogs = (): void => {
    if (startTimeout) timers.clearTimeout(startTimeout)
    if (startDeadlineTimeout) timers.clearTimeout(startDeadlineTimeout)
    startTimeout = undefined
    startDeadlineTimeout = undefined
  }

  const clearAllTimers = (): void => {
    if (timeout) timers.clearTimeout(timeout)
    if (interruptGraceTimeout) timers.clearTimeout(interruptGraceTimeout)
    if (continuationPromptTimeout) timers.clearTimeout(continuationPromptTimeout)
    if (ctrlCConfirmTimeout) timers.clearTimeout(ctrlCConfirmTimeout)
    clearStartWatchdogs()
    timeout = undefined
    interruptGraceTimeout = undefined
    continuationPromptTimeout = undefined
    ctrlCConfirmTimeout = undefined
  }

  const settle = (result: PendingCommandResult): void => {
    if (settled) return
    settled = true
    clearAllTimers()
    if (input.signal) {
      input.signal.removeEventListener('abort', onAbort)
    }
    resolvePromise(result)
  }

  const settleInterrupted = (): void => {
    if (settled || timeoutTriggered) return
    settle({
      ok: false,
      command: input.command,
      mode: input.mode,
      cwd: input.cwd,
      output: input.extractPartialCommandOutput(buffer, input.startMarker),
      error: buildInterruptedCommandError(),
      interrupted: true
    })
  }

  const interruptForTimeout = (message: string, display?: string): void => {
    if (settled) return
    timeoutTriggered = true
    input.onTimeout?.()
    if (display) input.display?.(display)
    input.interruptSession()
    interruptGraceTimeout = timers.setTimeout(() => {
      settle({
        ok: false,
        command: input.command,
        mode: input.mode,
        cwd: input.cwd,
        output: input.extractPartialCommandOutput(buffer, input.startMarker),
        error: message,
        timedOut: true
      })
    }, interruptGraceMs)
  }

  const armCommandTimeout = (ms: number): void => {
    if (timeout) timers.clearTimeout(timeout)
    timeout = timers.setTimeout(() => {
      interruptForTimeout(
        buildTimeoutCommandError(ms),
        `\r\n\x1b[33m[Crescent] command exceeded ${ms}ms; sending Ctrl+C.\x1b[0m\r\n`
      )
    }, ms)
  }

  /** Idle watchdog: fires only after silence lasting startTimeoutMs. */
  const armStartTimeout = (): void => {
    if (startTimeout) timers.clearTimeout(startTimeout)
    startTimeout = timers.setTimeout(() => {
      if (commandStarted || settled || waitingForSecretPrompt) return
      interruptForTimeout(
        'Command did not reach the execution start marker. The shell may be waiting for an unfinished quote or continuation prompt; Crescent sent Ctrl+C to recover.',
        `\r\n\x1b[33m[Crescent] command did not start within ${startTimeoutMs}ms; sending Ctrl+C to recover the shell.\x1b[0m\r\n`
      )
    }, startTimeoutMs)
  }

  /** Absolute cap from write so idle-reset cannot stretch forever. */
  const armStartDeadline = (): void => {
    if (startDeadlineTimeout) timers.clearTimeout(startDeadlineTimeout)
    startDeadlineTimeout = timers.setTimeout(() => {
      if (commandStarted || settled || waitingForSecretPrompt) return
      interruptForTimeout(
        'Command did not reach the execution start marker before the absolute start deadline; Crescent sent Ctrl+C to recover.',
        `\r\n\x1b[33m[Crescent] command did not start within ${startDeadlineMs}ms (absolute); sending Ctrl+C to recover the shell.\x1b[0m\r\n`
      )
    }, startDeadlineMs)
  }

  const markCommandStarted = (): void => {
    if (commandStarted) return
    commandStarted = true
    clearStartWatchdogs()
  }

  const armCtrlCConfirm = (): void => {
    if (settled || timeoutTriggered || ctrlCConfirmTimeout) return
    ctrlCConfirmTimeout = timers.setTimeout(() => {
      settleInterrupted()
    }, ctrlCConfirmMs)
  }

  const onAbort = (): void => {
    if (settled) return
    input.interruptSession()
    settleInterrupted()
  }

  const onData = (data: string): void => {
    if (settled) return
    buffer += data
    if (buffer.includes(input.startMarker)) markCommandStarted()

    // Bootstrap still in flight: any PTY progress resets the idle start watchdog.
    if (!commandStarted && !waitingForSecretPrompt && !timeoutTriggered) {
      armStartTimeout()
    }

    if (!timeoutTriggered && detectsTerminalCtrlC(data)) {
      armCtrlCConfirm()
      if (hasLikelyShellPrompt(buffer)) {
        settleInterrupted()
        return
      }
    }

    const parsed = input.parseCommandBuffer(buffer, input.startMarker, input.endMarker)
    if (!parsed.done) {
      const atSecretPrompt = Boolean(input.hasUnterminatedSecretPrompt?.(buffer))
      if (atSecretPrompt && !waitingForSecretPrompt) {
        waitingForSecretPrompt = true
        clearStartWatchdogs()
        if (continuationPromptTimeout) {
          timers.clearTimeout(continuationPromptTimeout)
          continuationPromptTimeout = undefined
        }
        armCommandTimeout(secretPromptTimeoutMs)
      } else if (!atSecretPrompt && waitingForSecretPrompt) {
        waitingForSecretPrompt = false
        armCommandTimeout(input.timeoutMs)
        if (!commandStarted) {
          armStartTimeout()
          armStartDeadline()
        }
      }

      if (
        commandStarted &&
        !timeoutTriggered &&
        !continuationPromptTimeout &&
        !waitingForSecretPrompt &&
        input.hasShellContinuationPrompt?.(buffer)
      ) {
        continuationPromptTimeout = timers.setTimeout(() => {
          if (!commandStarted || settled || waitingForSecretPrompt) return
          interruptForTimeout(
            'Command appears stuck at a shell continuation prompt; Crescent sent Ctrl+C to recover.',
            `\r\n\x1b[33m[Crescent] shell continuation prompt persisted for ${continuationPromptTimeoutMs}ms; sending Ctrl+C to recover the shell.\x1b[0m\r\n`
          )
        }, continuationPromptTimeoutMs)
      }
      return
    }

    settle({
      ok: !timeoutTriggered && parsed.exitCode === 0,
      command: input.command,
      mode: input.mode,
      cwd: input.cwd,
      exitCode: parsed.exitCode,
      output: parsed.output,
      error: timeoutTriggered ? buildTimeoutCommandError(input.timeoutMs) : undefined,
      timedOut: timeoutTriggered || undefined,
      interrupted: undefined
    })
  }

  const onExit = (event: { exitCode: number; signal?: number | string }): void => {
    settle({
      ok: false,
      command: input.command,
      mode: input.mode,
      cwd: input.cwd,
      output: input.extractPartialCommandOutput(buffer, input.startMarker),
      error: timeoutTriggered
        ? `${buildTimeoutCommandError(input.timeoutMs)} Terminal exit code: ${event.exitCode}.`
        : `Terminal session exited before the command completion marker (terminal exit code ${event.exitCode}).`,
      timedOut: timeoutTriggered || undefined,
      terminalExited: true
    })
  }

  const notifyUserInterrupt = (): void => {
    if (settled || timeoutTriggered) return
    input.interruptSession()
    settleInterrupted()
  }

  armCommandTimeout(input.timeoutMs)
  armStartTimeout()
  armStartDeadline()

  if (input.signal) {
    if (input.signal.aborted) {
      // Defer so callers can attach listeners/write first in the same tick if needed.
      timers.setTimeout(() => onAbort(), 0)
    } else {
      input.signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  return { onData, onExit, notifyUserInterrupt, promise }
}
