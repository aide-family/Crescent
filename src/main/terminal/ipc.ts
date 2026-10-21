import { recoverTimedOutSshSession } from './timeout-recovery'
import { TerminalExecutionState, requiresTerminalTakeover } from './execution-state'
import { beginManualSshHop, observeSshHopPrompt } from './ssh-hops'
import { readStoredExecutionIntent } from '../crescent-sqlite'
import { createHash } from 'node:crypto'
import { normalizeCommandTimeoutPolicy } from '../../shared/command-timeouts'
import { readAgentConfig } from '../crescent-store'
import { writeSystemLog } from '../logging'
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron'
import { homedir, hostname } from 'os'
import { dirname, resolve } from 'path'
import { stopPlansForTab } from '../agent/change-plan'
import { rendererIpc } from '../ipc-security'
import { resolveTerminalSecretReference } from '../renderer-secrets'
import {
  createCommandWrapper,
  extractPartialCommandOutput,
  filterAutomationControlLines,
  filterAutomationControlOutputWithState,
  formatPipePrompt,
  formatReadableCommandInput,
  formatReadableCommandResult,
  hasShellContinuationPrompt,
  isAutomationEchoLine,
  parseCommandBuffer,
  sanitizeCommand
} from './output-format'
import { createPtyScriptRunner, writePtyScript } from './script-runner'
import { TerminalSessionManager } from './session/manager'
import { createPipeSession } from './session/pipe-session'
import { createPtySession } from './session/pty-session'
import { TerminalRendererEvents } from './session/renderer-events'
import type {
  TerminalSessionEvents,
  TemporarySubterminalEntry,
  TerminalCommandExecutionResult,
  TerminalExitNotification,
  TerminalSession
} from './session/types'
const visibleTerminalEvents = new TerminalRendererEvents(appendTerminalContext)
export {
  filterAutomationControlOutputWithState,
  formatReadableCommandInput,
  isAutomationEchoLine
} from './output-format'
export type { TerminalAutomationFilterState, TerminalCommandExecutionResult } from './session/types'
const sessionManager = new TerminalSessionManager(flushVisibleTerminalData)
const {
  sessions,
  terminalOutputBuffers,
  degradedRecoveryOutput,
  connectionStates,
  manualInputLines,
  sessionWebContents,
  automationEchoSuppressions,
  terminalDataWaiters,
  terminalExitWaiters,
  terminalUserInterruptNotifiers,
  pendingCommandPromises,
  terminalAutomationFilterStates,
  temporarySubterminals,
  restoringSessionKeys
} = sessionManager

import type { TerminalExecutionTarget } from '../../shared/agent-types'
import {
  applyConfirmedLoginAnchor,
  classifyPipeCommand,
  confirmLoginState,
  connectionPhase,
  createConnectionState,
  evaluateInjectionGuard,
  isReturnToJumpHost,
  matchesClusterHostRegex,
  patchConnectionClusterHostRegex,
  resolveGateAlignment,
  resolveLoginConfirmTarget,
  resolveSessionAlignment,
  runtimeAnchorHost,
  setConnectionExpectedHost,
  type ConnectionState
} from '../../shared/connection-state'
import {
  extractSshDestinationHost,
  isIpv4Literal,
  isSshCommandLine,
  sanitizeExpectedTargetHost
} from '../../shared/ssh-destination'
import {
  extractPasswordPromptLine,
  hasUnterminatedSecretPrompt,
  isPrivilegePasswordPrompt
} from '../../shared/terminal-password-prompt'
import {
  isLocalMachinePromptHost,
  isPromptHostAligned,
  normalizeHostToken
} from '../../shared/terminal-prompt-host'
import { listConnections } from '../connections/ipc'
import { safeWebContentsSend } from '../safe-ipc-send'
import { buildTerminalExclusiveBusyResult } from './exclusive-lock'
import { GRACEFUL_TEARDOWN_TIMEOUT_MS, listGracefulTeardownSteps } from './graceful-teardown'
import {
  isPtyExecutionTabLocked,
  isTerminalInterruptPayload,
  resolveCtrlCTabId,
  resolveUserCommandInterrupt,
  shouldBlockTerminalUserInput
} from './input-lock'
import { createPendingCommandController, type PendingCommandController } from './pending-command'
import { resolveShellLaunchConfig } from './shell'

export interface TemporarySubterminalOpenOptions {
  cols?: number
  rows?: number
  initialCommand?: string
  owner?: string
}

export interface TemporarySubterminalOpenResult {
  ok: boolean
  name?: string
  tabId?: string
  sessionId?: number
  mode?: 'pty' | 'pipe'
  pid?: number
  shell?: string
  cwd?: string
  error?: string
}

export interface TemporarySubterminalSnapshot {
  ok: boolean
  name: string
  tabId: string
  mode: 'pty' | 'pipe' | 'none'
  cwd: string
  shell: string
  output: string
  busy: boolean
  detached: boolean
  error?: string
}

const handoffDataOnly = new Set<string>()
const commandControllers = new Map<string, PendingCommandController>()
const uncertainCommands = new Map<
  string,
  {
    sessionId: number
    startMarker: string
    endMarker: string
    buffer: string
    interrupted: boolean
  }
>()
const executionStates = new Map<string, TerminalExecutionState>()
let nextSessionId = 1

const MAX_CONTEXT_BUFFER = 24_000
const TERMINAL_COMMAND_TIMEOUT_MS = 120_000
const TERMINAL_COMMAND_MIN_TIMEOUT_MS = 5_000
const TERMINAL_COMMAND_MAX_TIMEOUT_MS = 600_000
const TERMINAL_COMMAND_INTERRUPT_GRACE_MS = 2_000
const TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS = 5_000
/** Extra wait window while sudo/SSH/OTP secret prompts are visible for the user. */
const TERMINAL_COMMAND_SECRET_PROMPT_TIMEOUT_MS = 300_000

/** Only PTY output emitted after degradation can prove timeout recovery. */

/**
 * Per-tab connection state SSOT. Written ONLY by: prompt observations,
 * ready/login confirmation, expected-host updates, and PTY/PIPE events.
 * Subterminal login never writes the parent tab. Everything else reads
 * through this map.
 */

/** User keyboard input is the authority for a manually initiated SSH hop. */
function noteManualTerminalInput(key: string, data: string): void {
  if (executionStates.get(key)?.alternateScreen || data.includes('\x1b')) {
    manualInputLines.delete(key)
    return
  }
  let line = manualInputLines.get(key) ?? ''
  for (const char of data) {
    if (char === '\x7f' || char === '\b') {
      line = line.slice(0, -1)
    } else if (char === '\r' || char === '\n') {
      if (
        isSshCommandLine(line.trim()) &&
        !hasUnterminatedSecretPrompt(terminalOutputBuffers.get(key) ?? '')
      ) {
        const state = getConnectionState(key)
        if (classifyPipeCommand(line.trim()) === 'interactive') {
          const destination = extractSshDestinationHost(line.trim())
          if (destination) setConnectionState(key, beginManualSshHop(state, destination))
        }
      }
      if (line.trim() && !hasUnterminatedSecretPrompt(terminalOutputBuffers.get(key) ?? '')) {
        const activity = executionStates.get(key)
        if (activity?.phase !== 'interactive-application') {
          if (/^(?:exit|logout)\s*$/.test(line.trim()))
            setConnectionState(key, { ...getConnectionState(key), pendingSshExit: true })
          activity?.begin(
            requiresTerminalTakeover(line) ? 'interactive-application' : 'command-running'
          )
        }
      }
      line = ''
    } else if (char >= ' ' && line.length < 4096) {
      line += char
    }
  }
  manualInputLines.set(key, line)
}
function noteDispatchedManualCommand(key: string, command: string): void {
  const state = connectionStates.get(key)
  if (!state?.expectedHost || state.ready) noteManualTerminalInput(key, `${command}\r`)
  else
    executionStates
      .get(key)
      ?.begin(requiresTerminalTakeover(command) ? 'interactive-application' : 'command-running')
}

/** Owning renderer for drift notifications (kept across soft restarts). */

/** Raw echo lines of automation-pasted commands, suppressed from display by default. */

/** Coalesce visible PTY→renderer frames (~16–32ms) to cut IPC/re-render pressure. */

/** In-flight automated command waiters (Stop / Ctrl+C can await settle). */

export const MAX_TEMPORARY_SUBTERMINALS = 3

let onMainTabLoginConfirmed: ((tabId: string, ownerId: number) => void) | undefined

export function registerMainTabLoginConfirmedHandler(
  handler: (tabId: string, ownerId: number) => void
): void {
  onMainTabLoginConfirmed = handler
}

export function markTerminalSessionRestoring(
  senderId: number,
  tabId: string,
  restoring: boolean
): void {
  const normalized = normalizeTabId(tabId)
  if (!normalized) return
  const key = getSessionKey(senderId, normalized)
  if (restoring) restoringSessionKeys.add(key)
  else restoringSessionKeys.delete(key)
}

export function readTerminalSessionHealth(
  senderId: number,
  tabId: string
): {
  hasSession: boolean
  restoring: boolean
  alignment: 'aligned' | 'drifted' | 'unknown'
  ready: boolean
} {
  const normalized = normalizeTabId(tabId)
  if (!normalized) {
    return { hasSession: false, restoring: false, alignment: 'unknown', ready: false }
  }
  const key = getSessionKey(senderId, normalized)
  const session = sessions.get(key)
  const state = connectionStates.get(key)
  const hasSession = Boolean(session)
  return {
    hasSession,
    restoring: restoringSessionKeys.has(key),
    alignment: hasSession ? (state?.alignment ?? 'unknown') : 'unknown',
    ready: Boolean(hasSession && state?.ready)
  }
}

/** CRESCENT_DEBUG_CONN=1 enables [conn-trace] logs and raw terminal echo. */
function debugConnEnabled(): boolean {
  return process.env.CRESCENT_DEBUG_CONN === '1'
}

function connTrace(...parts: unknown[]): void {
  if (!debugConnEnabled()) return
  console.info('[conn-trace]', ...parts)
}

function invalidateTerminalPlans(key: string): void {
  const separator = key.indexOf(':')
  stopPlansForTab(key.slice(separator + 1), Number(key.slice(0, separator)))
}

function setConnectionState(key: string, next: ConnectionState): void {
  const previous = connectionStates.get(key)
  const identity = (state: ConnectionState): string =>
    JSON.stringify([
      state.connectionId,
      state.expectedHost,
      runtimeAnchorHost(state),
      state.ready,
      state.alignment,
      state.connectionFault,
      state.clusterHostRegex
    ])
  if (previous && identity(previous) !== identity(next)) invalidateTerminalPlans(key)
  if (next.connectionFault !== 'degraded') degradedRecoveryOutput.delete(key)
  connectionStates.set(key, next)
}

function getConnectionState(key: string, mode: ConnectionState['mode'] = 'none'): ConnectionState {
  const existing = connectionStates.get(key)
  if (existing) return existing
  const created = createConnectionState(mode)
  setConnectionState(key, created)
  return created
}

function setSessionExpectedHost(
  key: string,
  host: string | null | undefined,
  options?: {
    clusterHostRegex?: string | null
    connectionId?: string
    connectionName?: string
    connectionOrigin?: ConnectionState['connectionOrigin']
    sshHopChain?: string[]
  }
): void {
  const state = getConnectionState(key)
  setConnectionState(key, setConnectionExpectedHost(state, host, options))
}

/** Sync SSOT mode when a session is created (PTY/PIPE event). */
function noteSessionMode(key: string, mode: 'pty' | 'pipe'): void {
  const state = connectionStates.get(key)
  if (state) {
    setConnectionState(key, { ...state, mode })
    return
  }
  setConnectionState(key, createConnectionState(mode))
}

export function executeCommandInTerminal(
  senderId: number,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  tabId?: string,
  signal?: AbortSignal,
  requiredSsh = false,
  onDispatched?: () => void
): Promise<TerminalCommandExecutionResult> {
  const normalizedTabId = normalizeTabId(tabId)
  const normalizedCommand = command.trim()
  if (!normalizedTabId) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      error: 'Missing terminal tab id. Refusing to execute on a shared default terminal.'
    })
  }
  if (!isUsableTerminalTabId(normalizedTabId)) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      error: `Reserved terminal tab id "${normalizedTabId}" is not allowed. Use a unique tabId.`
    })
  }
  const key = getSessionKey(senderId, normalizedTabId)
  if (handoffDataOnly.has(key))
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      outcome: 'blocked-before-dispatch',
      error:
        'Data-only Handoff has no execution authorization. Select a target explicitly; no command was sent.'
    })
  const session = sessions.get(key)
  const boundTarget = connectionStates.get(key)
  if (
    requiredSsh &&
    boundTarget?.monitorPolicy !== 'manual' &&
    !boundTarget?.expectedHost &&
    (session || !parseTemporarySubterminalTabId(normalizedTabId))
  ) {
    return Promise.resolve({
      ok: false,
      code: 'SSH_TARGET_UNAVAILABLE',
      command: normalizedCommand,
      output: '',
      connectionPhase: 'ssh-lost',
      recoveryAction: 'reconnect-or-select-target',
      error: 'SSH_TARGET_UNAVAILABLE: Agent SSH target binding is missing. No command was sent.'
    })
  }
  const effectiveTimeoutMs = normalizeCommandTimeout(timeoutMs)

  if (!session) {
    const state = connectionStates.get(key)
    if (state?.expectedHost) {
      return Promise.resolve(unavailableSshTarget(normalizedCommand, state, 'ssh-lost'))
    }
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      error: 'No active terminal session.'
    })
  }

  if (Buffer.byteLength(normalizedCommand) > 128 * 1024)
    return Promise.resolve({
      ok: false,
      command: '[oversized command]',
      output: '',
      outcome: 'blocked-before-dispatch',
      error:
        'Command exceeds the 128 KiB transport limit; split the investigation or use a reviewed transfer.'
    })

  if (!normalizedCommand) {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error: 'Command is empty.'
    })
  }

  const activity = executionStates.get(key)
  if (
    activity &&
    [
      'interactive-application',
      'awaiting-input',
      'command-running',
      'interrupted',
      'completion-unknown'
    ].includes(activity.phase) &&
    !pendingCommandPromises.has(key) &&
    !uncertainCommands.has(key)
  )
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      outcome: 'blocked-before-dispatch',
      error: `Terminal is ${activity.phase}. Finish the interactive application or use Ctrl+C, then wait for a fresh shell prompt. No command was sent.`
    })
  if (requiresTerminalTakeover(normalizedCommand))
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      outcome: 'blocked-before-dispatch',
      error:
        'Interactive application requires manual terminal takeover. Open it in this pane, complete or exit it, then wait for the shell prompt; no automated command was sent.'
    })
  const uncertain = uncertainCommands.get(key)
  if (uncertain && uncertain.sessionId !== session.id) uncertainCommands.delete(key)
  else if (uncertain)
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      outcome: 'blocked-before-dispatch',
      error:
        'Previous command completion is unknown. Wait for completion or manually interrupt and confirm the shell; no new command was sent.'
    })
  if (signal?.aborted)
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      outcome: 'blocked-before-dispatch',
      interrupted: true
    })
  if (pendingCommandPromises.has(key)) {
    return Promise.resolve(buildTerminalExclusiveBusyResult(normalizedCommand, session))
  }

  const drift = detectEnvironmentDriftForSession(key, normalizedTabId, normalizedCommand, session)
  if (drift) {
    connTrace(
      'gate-block',
      `tab=${normalizedTabId}`,
      `drift=${drift.observedHost}`,
      `expected=${drift.expectedHost ?? '-'}`
    )
    return Promise.resolve(drift)
  }

  const state = connectionStates.get(key)
  if (state?.expectedHost) {
    const alignment = state.alignment
    const phase = connectionPhase(state, alignment, true, restoringSessionKeys.has(key))
    if (phase !== 'ssh-ready') {
      setConnectionState(key, {
        ...state,
        alignment,
        ready: false,
        connectionFault: phase === 'ssh-lost' ? 'lost' : 'degraded'
      })
      if (phase === 'ssh-degraded') degradedRecoveryOutput.set(key, '')
      return Promise.resolve(unavailableSshTarget(normalizedCommand, state, phase, session))
    }
  }

  if (process.platform === 'win32' && !/(?:bash|zsh|(?:^|[\\/])sh)(?:\.exe)?$/i.test(session.shell))
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      output: '',
      outcome: 'blocked-before-dispatch',
      error:
        'Automated sentinel execution requires a POSIX shell. Use a configured bash/sh terminal or execute manually in PowerShell/cmd; target and approval remain unchanged.'
    })

  if (session.mode === 'pipe' && classifyPipeCommand(normalizedCommand) === 'interactive') {
    return Promise.resolve({
      ok: false,
      command: normalizedCommand,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error:
        'Interactive commands (ssh login shell, sudo/su/passwd prompts, mysql/psql/sftp REPL) require PTY mode. Current terminal is pipe fallback, so this command was blocked to avoid corrupting password input. One-shot non-interactive ssh (BatchMode or a remote command without -t) is still allowed. Restart the app or rebuild node-pty for interactive sessions.'
    })
  }

  const commandId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const startMarker = `__CRESCENT_CMD_START_${commandId}__`
  const endMarker = `__CRESCENT_CMD_END_${commandId}__`
  const policy = normalizeCommandTimeoutPolicy(readAgentConfig().commandTimeouts)
  const dispatchAt = Date.now()
  let dispatchDeadline = dispatchAt + policy.executionMs
  const targetHash = createHash('sha256')
    .update(readTerminalPlanIdentity(senderId, normalizedTabId) ?? key)
    .digest('hex')
    .slice(0, 12)
  const dispatchController = new AbortController()
  const dispatchSignal = signal
    ? AbortSignal.any([signal, dispatchController.signal])
    : dispatchController.signal
  const pending = createPendingCommandController({
    command: normalizedCommand,
    mode: session.mode,
    cwd: session.cwd,
    startMarker,
    endMarker,
    timeoutMs: effectiveTimeoutMs,
    signal,
    interruptGraceMs: TERMINAL_COMMAND_INTERRUPT_GRACE_MS,
    onSettled: (result) => {
      if (sessions.get(key)?.id !== session.id) return
      if (
        result.cwd &&
        result.cwd.startsWith('/') &&
        result.cwd.length <= 4096 &&
        !result.cwd.includes('\0') &&
        result.cwd !== session.cwd
      ) {
        session.cwd = result.cwd
        invalidateTerminalPlans(key)
      }
      if ((result.timedOut || result.interrupted) && result.outcome !== 'blocked-before-dispatch') {
        uncertainCommands.set(key, {
          sessionId: session.id,
          startMarker,
          endMarker,
          buffer: '',
          interrupted: Boolean(result.interrupted)
        })
        activity?.begin(result.interrupted ? 'interrupted' : 'completion-unknown')
      } else activity?.begin(result.terminalExited ? 'session-exited' : 'shell-ready')
    },
    startTimeoutMs: policy.startMs,
    idleTimeoutMs: policy.idleMs,
    onPhase: (phase) =>
      writeSystemLog(
        'debug',
        JSON.stringify({
          commandId,
          targetHash,
          phase,
          elapsedMs: Date.now() - dispatchAt,
          inputBytes: Buffer.byteLength(normalizedCommand),
          shell: session.shell.split(/[\\/]/).at(-1),
          sessionGeneration: session.id
        })
      ),
    continuationPromptTimeoutMs: TERMINAL_COMMAND_CONTINUATION_PROMPT_TIMEOUT_MS,
    secretPromptTimeoutMs: TERMINAL_COMMAND_SECRET_PROMPT_TIMEOUT_MS,
    interruptSession: () => interruptCommandSession(key, session),
    deferDispatch: true,
    display: (message) => session.display(message),
    hasUnterminatedSecretPrompt,
    hasShellContinuationPrompt,
    parseCommandBuffer,
    extractPartialCommandOutput
  })

  const continueWaiting = pending.continueWaiting
  pending.continueWaiting = (ms = policy.executionMs) => {
    dispatchDeadline = Date.now() + normalizeCommandTimeout(ms)
    return continueWaiting(ms)
  }
  commandControllers.set(key, pending)
  const onData = (data: string): void => {
    if (sessions.get(key)?.id !== session.id) return
    pending.onData(data)
  }
  const onExit = (event: TerminalExitNotification): void => {
    pending.onExit(event)
  }
  const onUserInterrupt = (): void => {
    pending.notifyUserInterrupt()
  }

  const waiters = terminalDataWaiters.get(key) ?? new Set<(data: string) => void>()
  waiters.add(onData)
  terminalDataWaiters.set(key, waiters)
  const exitWaiters =
    terminalExitWaiters.get(key) ?? new Set<(event: TerminalExitNotification) => void>()
  exitWaiters.add(onExit)
  terminalExitWaiters.set(key, exitWaiters)
  const interruptNotifiers = terminalUserInterruptNotifiers.get(key) ?? new Set<() => void>()
  interruptNotifiers.add(onUserInterrupt)
  terminalUserInterruptNotifiers.set(key, interruptNotifiers)

  pendingCommandPromises.set(key, pending.promise)

  void pending.promise.finally(() => {
    dispatchController.abort()
    if (pendingCommandPromises.get(key) === pending.promise) {
      pendingCommandPromises.delete(key)
    }
    const dataWaiters = terminalDataWaiters.get(key)
    dataWaiters?.delete(onData)
    if (dataWaiters?.size === 0) terminalDataWaiters.delete(key)
    const exits = terminalExitWaiters.get(key)
    exits?.delete(onExit)
    if (exits?.size === 0) terminalExitWaiters.delete(key)
    const interrupts = terminalUserInterruptNotifiers.get(key)
    interrupts?.delete(onUserInterrupt)
    if (interrupts?.size === 0) terminalUserInterruptNotifiers.delete(key)
    if (commandControllers.get(key) === pending) commandControllers.delete(key)
    if (sessions.get(key)?.id === session.id) terminalAutomationFilterStates.delete(key)
  })

  void pending.promise.then((result) => {
    if (sessions.get(key)?.id !== session.id) return
    if (result.terminalExited) {
      const state = connectionStates.get(key)
      if (state?.expectedHost) {
        setConnectionState(key, {
          ...state,
          alignment: 'unknown',
          ready: false,
          connectionFault: 'lost'
        })
      }
    }
    const readableResult = formatReadableCommandResult(result)
    if (readableResult) session.display(readableResult)
  })

  activity?.begin('command-running')
  pending.markDispatching()
  onDispatched?.()
  session.display(formatReadableCommandInput(normalizedCommand))
  if (session.mode === 'pty') {
    terminalAutomationFilterStates.set(key, {
      startMarker,
      endMarker,
      phase: 'before-start',
      pending: ''
    })
    void writePtyScript({
      payload: createPtyScriptRunner(
        createCommandWrapper(normalizedCommand, startMarker, endMarker)
      ),
      write: session.write,
      signal: dispatchSignal,
      acknowledgementTimeoutMs: Math.max(60000, policy.startMs * 2),
      dispatchDeadline: () => dispatchDeadline,
      observeOutput: (listener) => {
        const observers = terminalDataWaiters.get(key) ?? new Set<(data: string) => void>()
        observers.add(listener)
        terminalDataWaiters.set(key, observers)
        return () => {
          observers.delete(listener)
          if (!observers.size && terminalDataWaiters.get(key) === observers)
            terminalDataWaiters.delete(key)
        }
      },
      isCurrent: () => sessions.get(key)?.id === session.id
    })
      .then(() => pending.markDispatched())
      .catch((error) => {
        if (signal?.aborted) pending.notifyUserInterrupt()
        else
          pending.failDispatch(
            error instanceof Error ? error.message : 'Terminal transport is unconfirmed.'
          )
      })
  } else {
    try {
      session.write(`${createCommandWrapper(normalizedCommand, startMarker, endMarker)}\n`)
      pending.markDispatched()
    } catch {
      pending.onExit({ exitCode: 1 })
    }
  }

  return pending.promise.then((result) => ({ ...result, dispatched: true }))
}

function unavailableSshTarget(
  command: string,
  state: ConnectionState,
  phase: ReturnType<typeof connectionPhase>,
  session?: TerminalSession
): TerminalCommandExecutionResult {
  const expectedHost = runtimeAnchorHost(state) ?? state.expectedHost
  const observedHost = state.promptHost
  const awaitingPrompt = phase === 'ssh-degraded'
  return {
    ok: false,
    code: 'SSH_TARGET_UNAVAILABLE',
    command,
    mode: session?.mode,
    cwd: session?.cwd,
    output: '',
    expectedHost,
    observedHost,
    connectionPhase: phase,
    recoveryAction: awaitingPrompt ? 'wait-for-target-prompt' : 'reconnect-or-select-target',
    error: awaitingPrompt
      ? `SSH_TARGET_UNAVAILABLE: Waiting for a fresh prompt from ${expectedHost ?? 'SSH target'} after command timeout. Use Ctrl+C if the shell is still busy, then wait for the target prompt. No command was sent.`
      : `SSH_TARGET_UNAVAILABLE: Expected ${expectedHost ?? 'SSH target'}, observed ${observedHost ?? 'unknown'} (${phase}). Reconnect or explicitly select another target. No command was sent.`
  }
}

/** Run-local binding; a new PTY, changed connection, cwd or login identity revokes plans. */
export function readTerminalPlanIdentity(senderId: number, tabId: string): string | undefined {
  const key = getSessionKey(senderId, tabId)
  if (handoffDataOnly.has(key)) return undefined
  const session = sessions.get(key)
  const state = connectionStates.get(key)
  const health = readTerminalSessionHealth(senderId, tabId)
  if (
    !session ||
    health.restoring ||
    (state?.manualSshActive &&
      (!state.ready ||
        !state.promptHost ||
        isLocalMachinePromptHost(state.promptHost, hostname()))) ||
    (state?.expectedHost && (!health.ready || health.alignment !== 'aligned'))
  )
    return undefined
  return JSON.stringify({
    ownerId: senderId,
    paneId: tabId,
    shell: session.shell,
    targetScope: state?.targetScope,
    clusterHostRegex: state?.clusterHostRegex,
    sshHopChain: state?.sshHopChain,
    sessionId: session.id,
    cwd: session.cwd,
    target: {
      executionMode: state?.expectedHost || state?.manualSshActive ? 'ssh' : 'local',
      expectedTarget:
        runtimeAnchorHost(state ?? createConnectionState()) ??
        state?.expectedHost ??
        (state?.manualSshActive ? state.promptHost : undefined),
      connectionOrigin: state?.connectionOrigin
    },
    connectionId: state?.connectionId
  })
}

export function readTerminalExecutionTarget(
  senderId: number,
  tabId: string
): TerminalExecutionTarget {
  const key = getSessionKey(senderId, tabId)
  const state = connectionStates.get(key)
  const session = sessions.get(key)
  return {
    activity: session ? executionStates.get(key)?.phase : 'session-exited',
    cwd: session?.cwd,
    shell: session?.shell,
    sshHops: state?.sshHops ?? [],
    paneRole: parseTemporarySubterminalTabId(tabId) ? 'subterminal' : 'main',
    paneId: tabId,
    sessionGeneration: sessions.get(getSessionKey(senderId, tabId))?.id ?? 0,
    connectionId: state?.connectionId,
    connectionOrigin: state?.connectionOrigin,
    readiness: readTerminalSessionHealth(senderId, tabId),
    owner: state?.owner ?? 'user',
    executionMode: state?.expectedHost || state?.manualSshActive ? 'ssh' : 'local',
    connectionName: state?.connectionName,
    expectedTarget:
      (state ? runtimeAnchorHost(state) : undefined) ??
      state?.expectedHost ??
      (state?.manualSshActive ? state.promptHost : undefined)
  }
}

/**
 * User Ctrl+C: write SIGINT to the PTY. Settles an in-flight waiter when one exists.
 * Does not abort the Pi session.
 */
export function interruptPendingTerminalCommandIfRunning(
  senderId: number,
  tabId?: string
): boolean {
  const normalizedTabId = normalizeTabId(tabId)
  if (!normalizedTabId) return false
  const key = getSessionKey(senderId, normalizedTabId)
  if (
    resolveUserCommandInterrupt({ hasPendingCommand: pendingCommandPromises.has(key) }) === 'noop'
  ) {
    return false
  }
  return interruptPendingTerminalCommands(senderId, normalizedTabId)
}

/** Interrupt any in-flight automated command on a tab (Ctrl+C + settle interrupted). */
export function interruptPendingTerminalCommands(senderId: number, tabId?: string): boolean {
  const normalizedTabId = normalizeTabId(tabId)
  if (!normalizedTabId) return false
  const key = getSessionKey(senderId, normalizedTabId)
  const session = sessions.get(key)
  if (!session) return false
  const uncertain = uncertainCommands.get(key)
  if (uncertain) {
    uncertain.interrupted = true
    uncertain.buffer = ''
    executionStates.get(key)?.begin('interrupted')
  }
  clearTemporarySubterminalDetached(senderId, normalizedTabId)
  const notifiers = terminalUserInterruptNotifiers.get(key)
  if (!notifiers || notifiers.size === 0) {
    interruptCommandSession(key, session)
    return Boolean(uncertain)
  }
  ;[...notifiers].forEach((notify) => notify())
  return true
}

/**
 * Interrupt in-flight automated commands and wait until the pending waiter settles.
 * Callers that emit agent `command/finished` after the waiter can then flush before run abort.
 */
export async function interruptAndAwaitPendingTerminalCommands(
  senderId: number,
  tabId?: string
): Promise<boolean> {
  const normalizedTabId = normalizeTabId(tabId)
  if (!normalizedTabId) return false
  const key = getSessionKey(senderId, normalizedTabId)
  const uncertain = uncertainCommands.get(key)
  if (uncertain) {
    uncertain.interrupted = true
    uncertain.buffer = ''
    executionStates.get(key)?.begin('interrupted')
  }
  const pending = pendingCommandPromises.get(key)
  const interrupted = interruptPendingTerminalCommands(senderId, normalizedTabId)
  if (pending) {
    try {
      await pending
    } catch {
      // settle errors are surfaced via the command result / agent emit path
    }
  }
  return interrupted || Boolean(pending)
}

export async function executeCommandInTerminalWithPermissionRequest(
  webContents: WebContents,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  tabId?: string,
  signal?: AbortSignal,
  requiredSsh = false,
  onDispatched?: () => void
): Promise<TerminalCommandExecutionResult> {
  let result = await executeCommandInTerminal(
    webContents.id,
    command,
    timeoutMs,
    tabId,
    signal,
    requiredSsh,
    onDispatched
  )

  if (isLocalFilePermissionFailure(result)) {
    result = await requestLocalFileAccessAndAnnotateResult(webContents, command, result)
  }

  return result
}

export async function executeCommandInTemporaryTerminal(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string,
  command: string,
  timeoutMs = TERMINAL_COMMAND_TIMEOUT_MS,
  mode: 'wait' | 'detach' = 'wait',
  signal?: AbortSignal,
  requiredSsh = false,
  onDispatched?: () => void
): Promise<TerminalCommandExecutionResult> {
  const parent = normalizeTabId(parentTabId)
  const normalizedCommand = command.trim()
  if (!parent) {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: 'Missing parent terminal tab id for temporary sub-terminal.'
    }
  }
  const name = normalizeTemporaryTerminalName(terminalName)
  const slot = ensureTemporarySubterminal(webContents, parent, name)

  if (!slot.ok) {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: slot.error
    }
  }

  const entry = slot.entry
  if (entry.busy) {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: `Temporary sub-terminal "${name}" is already running a command.`
    }
  }
  if (entry.detached && mode === 'wait') {
    return {
      ok: false,
      command: normalizedCommand,
      output: '',
      error: `Temporary sub-terminal "${name}" is running a detached watch command. Interrupt it first, or use mode=detach only after clearing the pane.`,
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  if (mode === 'detach') {
    return executeDetachedCommandInTemporaryTerminal(webContents, entry, name, normalizedCommand)
  }

  entry.busy = true
  entry.lastUsedAt = Date.now()

  try {
    let result = await executeCommandInTerminal(
      webContents.id,
      command,
      timeoutMs,
      entry.tabId,
      signal,
      requiredSsh,
      onDispatched
    )

    if (isLocalFilePermissionFailure(result)) {
      result = await requestLocalFileAccessAndAnnotateResult(webContents, command, result)
    }

    return {
      ...result,
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  } finally {
    entry.busy = false
    entry.lastUsedAt = Date.now()
  }
}

export function openTemporarySubterminal(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string,
  options?: TemporarySubterminalOpenOptions
): TemporarySubterminalOpenResult {
  const parent = normalizeTabId(parentTabId)
  if (!parent) {
    return { ok: false, error: 'Missing parent terminal tab id for temporary sub-terminal.' }
  }

  const name = normalizeTemporaryTerminalName(terminalName)
  const slot = ensureTemporarySubterminal(webContents, parent, name, options)
  if (!slot.ok) return { ok: false, error: slot.error }

  const key = getSessionKey(webContents.id, slot.entry.tabId)
  const session = sessions.get(key)
  if (!session) {
    return {
      ok: false,
      name,
      tabId: slot.entry.tabId,
      error: 'Failed to start temporary sub-terminal session.'
    }
  }

  if (options?.owner) {
    const state = getConnectionState(key)
    setConnectionState(key, { ...state, owner: options.owner })
  }

  return {
    ok: true,
    name,
    tabId: slot.entry.tabId,
    sessionId: session.id,
    mode: session.mode,
    pid: session.pid,
    shell: session.shell,
    cwd: session.cwd
  }
}

export function listTemporarySubterminalNames(
  webContents: WebContents,
  parentTabId: string | undefined
): string[] {
  const parent = normalizeTabId(parentTabId)
  if (!parent) return []
  const poolKey = getSessionKey(webContents.id, parent)
  return (temporarySubterminals.get(poolKey) ?? []).map((entry) => entry.name)
}

/** Stop a temporary subterminal session and free its pool slot (e.g. ready timeout). */
export function closeTemporarySubterminal(
  webContents: WebContents,
  tabId: string | undefined
): void {
  const normalized = normalizeTabId(tabId)
  if (!normalized) return
  const key = getSessionKey(webContents.id, normalized)
  stopSession(key)
  invalidateTerminalPlans(key)
  connectionStates.delete(key)
  sessionWebContents.delete(key)
  restoringSessionKeys.delete(key)
  releaseTemporarySubterminalByTabId(webContents.id, normalized)
}

export async function teardownTerminalSessionGracefully(
  senderId: number,
  tabId: string,
  timeoutMs = GRACEFUL_TEARDOWN_TIMEOUT_MS
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeTabId(tabId)
  if (!normalized || !isUsableTerminalTabId(normalized)) {
    return { ok: false, error: 'Missing or reserved terminal tab id.' }
  }
  const key = getSessionKey(senderId, normalized)
  markTerminalSessionRestoring(senderId, normalized, true)
  const session = sessions.get(key)
  if (!session) return { ok: true }

  const exitPromise = waitForSessionExit(key)
  const deadline = Date.now() + Math.max(200, timeoutMs)
  for (const step of listGracefulTeardownSteps(timeoutMs)) {
    if (!sessions.has(key) || Date.now() >= deadline) break
    try {
      session.write(step.write)
    } catch {
      break
    }
    await Promise.race([exitPromise, sleep(step.waitMs)])
  }
  const remaining = Math.max(0, deadline - Date.now())
  if (sessions.has(key) && remaining > 0) {
    await Promise.race([exitPromise, sleep(remaining)])
  }
  stopSession(key)
  return { ok: true }
}

export function readTemporarySubterminalOutput(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string,
  maxChars = 12_000
): TemporarySubterminalSnapshot {
  const parent = normalizeTabId(parentTabId)
  const name = normalizeTemporaryTerminalName(terminalName)
  if (!parent) {
    return {
      ok: false,
      name,
      tabId: '',
      mode: 'none',
      cwd: '',
      shell: '',
      output: '',
      busy: false,
      detached: false,
      error: 'Missing parent terminal tab id for temporary sub-terminal.'
    }
  }

  const poolKey = getSessionKey(webContents.id, parent)
  const entry = (temporarySubterminals.get(poolKey) ?? []).find((item) => item.name === name)
  if (!entry) {
    return {
      ok: false,
      name,
      tabId: createTemporarySubterminalTabId(parent, name),
      mode: 'none',
      cwd: '',
      shell: '',
      output: '',
      busy: false,
      detached: false,
      error: `Temporary sub-terminal "${name}" is not open.`
    }
  }

  const key = getSessionKey(webContents.id, entry.tabId)
  const session = sessions.get(key)
  const output = (terminalOutputBuffers.get(key) ?? '').slice(-Math.max(1_000, maxChars))

  return {
    ok: true,
    name,
    tabId: entry.tabId,
    mode: session?.mode ?? 'none',
    cwd: session?.cwd ?? '',
    shell: session?.shell ?? '',
    output,
    busy: entry.busy,
    detached: entry.detached
  }
}

export function interruptTemporarySubterminal(
  webContents: WebContents,
  parentTabId: string | undefined,
  terminalName: string
): { ok: boolean; name: string; tabId?: string; error?: string } {
  const parent = normalizeTabId(parentTabId)
  const name = normalizeTemporaryTerminalName(terminalName)
  if (!parent) {
    return { ok: false, name, error: 'Missing parent terminal tab id for temporary sub-terminal.' }
  }

  const poolKey = getSessionKey(webContents.id, parent)
  const entry = (temporarySubterminals.get(poolKey) ?? []).find((item) => item.name === name)
  if (!entry) {
    return { ok: false, name, error: `Temporary sub-terminal "${name}" is not open.` }
  }

  const key = getSessionKey(webContents.id, entry.tabId)
  const session = sessions.get(key)
  if (!session) {
    entry.detached = false
    entry.busy = false
    return {
      ok: false,
      name,
      tabId: entry.tabId,
      error: 'No active terminal session for this sub-terminal.'
    }
  }

  interruptCommandSession(key, session)
  entry.detached = false
  entry.lastUsedAt = Date.now()
  return { ok: true, name, tabId: entry.tabId }
}

function executeDetachedCommandInTemporaryTerminal(
  webContents: WebContents,
  entry: TemporarySubterminalEntry,
  name: string,
  command: string
): TerminalCommandExecutionResult {
  const key = getSessionKey(webContents.id, entry.tabId)
  const session = sessions.get(key)
  if (!session) {
    return {
      ok: false,
      command,
      output: '',
      error: 'No active terminal session.',
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  if (!command) {
    return {
      ok: false,
      command,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error: 'Command is empty.',
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  if (session.mode === 'pipe' && classifyPipeCommand(command) === 'interactive') {
    return {
      ok: false,
      command,
      mode: session.mode,
      cwd: session.cwd,
      output: '',
      error:
        'Interactive commands (ssh login shell, sudo/su/passwd prompts, mysql/psql/sftp REPL) require PTY mode. Current terminal is pipe fallback, so this command was blocked to avoid corrupting password input. One-shot non-interactive ssh (BatchMode or a remote command without -t) is still allowed. Restart the app or rebuild node-pty for interactive sessions.',
      subterminalName: name,
      subterminalTabId: entry.tabId
    }
  }

  noteDispatchedManualCommand(key, command)
  entry.detached = true
  entry.lastUsedAt = Date.now()
  session.display(formatReadableCommandInput(command))
  session.write(session.mode === 'pty' ? `${command}\r` : `${command}\n`)

  return {
    ok: true,
    command,
    mode: session.mode,
    cwd: session.cwd,
    output: '',
    detached: true,
    subterminalName: name,
    subterminalTabId: entry.tabId
  }
}

async function requestLocalFileAccessAndAnnotateResult(
  webContents: WebContents,
  command: string,
  result: TerminalCommandExecutionResult
): Promise<TerminalCommandExecutionResult> {
  const defaultPath = extractLikelyLocalDirectory(command)
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const options: OpenDialogOptions = {
    title: 'Authorize local folder access',
    message:
      'Crescent could not access a local folder used by this command. Select the target folder to grant access, then retry the operation.',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  const note = selection.canceled
    ? 'Local folder access was not granted. Please grant access to the target folder and retry.'
    : `Local folder access was requested for: ${selection.filePaths[0]}. Retry the command after authorization.`

  return {
    ...result,
    error: [result.error, note].filter(Boolean).join('\n'),
    output: [result.output, note].filter(Boolean).join('\n')
  }
}

function isLocalFilePermissionFailure(result: TerminalCommandExecutionResult): boolean {
  const text = `${result.error ?? ''}\n${result.output}`

  return !result.ok && /(EACCES|EPERM|Permission denied|Operation not permitted)/i.test(text)
}

function extractLikelyLocalDirectory(command: string): string | undefined {
  const candidates = [
    command.match(/\$HOME\/([^\s'"<>|;&]+)/)?.[1],
    command.match(/~\/([^\s'"<>|;&]+)/)?.[1],
    command
      .match(/Path\.home\(\)\s*\/\s*['"]([^'"]+)['"]\s*\/\s*['"]([^'"]+)['"]/)
      ?.slice(1)
      .join('/'),
    command.match(/["'](\/[^"']+)["']/)?.[1]
  ].filter((value): value is string => Boolean(value))

  const candidate = candidates[0]
  if (!candidate) return undefined

  const expanded = candidate.startsWith('/')
    ? candidate
    : resolve(homedir(), candidate.replace(/^~\//, ''))

  return /\.[A-Za-z0-9]{1,8}$/.test(expanded) ? dirname(expanded) : expanded
}

export function registerTerminalIpc(): void {
  rendererIpc.handle(
    'terminal:prepare-handoff',
    async (event, payload?: { sourceId?: string; tabId?: string; target?: string }) => {
      const sourceId = normalizeTabId(payload?.sourceId)
      const tabId = normalizeTabId(payload?.tabId)
      const selection = payload?.target
      if (
        !sourceId ||
        !tabId ||
        !isUsableTerminalTabId(tabId) ||
        sourceId === tabId ||
        sessions.has(getSessionKey(event.sender.id, tabId)) ||
        typeof selection !== 'string'
      )
        return { ok: false, error: 'Invalid handoff target' }
      const key = getSessionKey(event.sender.id, tabId)
      if (selection === 'none') {
        handoffDataOnly.add(key)
        return { ok: true }
      }
      if (selection === 'local') {
        handoffDataOnly.delete(key)
        setSessionExpectedHost(key, null)
        return { ok: true }
      }
      const sourceKey = getSessionKey(event.sender.id, sourceId)
      const source = connectionStates.get(sourceKey)
      if (selection === 'inherit' && !sessions.has(sourceKey))
        return {
          ok: false,
          error: 'Handoff source session is unavailable; select an explicit target.'
        }
      if (selection === 'inherit' && (source?.pendingSshHop || (source?.sshHops?.length ?? 0) > 1))
        return {
          ok: false,
          error:
            'Nested SSH cannot inherit the original connection as the current host. Select a saved environment explicitly.'
        }
      const connectionId =
        selection === 'inherit'
          ? source?.connectionId
          : selection.startsWith('connection:')
            ? selection.slice(11)
            : undefined
      if (selection !== 'inherit' && !connectionId)
        return { ok: false, error: 'Invalid environment selection' }
      const saved = connectionId
        ? (await listConnections()).find((item) => item.id === connectionId)
        : undefined
      if (connectionId && !saved) return { ok: false, error: 'Saved connection is missing' }
      if (saved)
        setSessionExpectedHost(key, saved.host, {
          connectionId: saved.id,
          connectionName: saved.name,
          clusterHostRegex: saved.clusterHostRegex,
          connectionOrigin: source?.connectionOrigin ?? 'connection-card'
        })
      else if (source?.manualSshActive || source?.expectedHost) {
        const intendedHost = source.runtimeExpectedHost ?? source.expectedHost ?? source.promptHost
        if (!intendedHost)
          return {
            ok: false,
            error:
              'Manual SSH source target is unverified. Select a saved environment or wait for the source prompt.'
          }
        setSessionExpectedHost(
          key,
          source.runtimeExpectedHost ?? source.expectedHost ?? source.promptHost,
          { connectionOrigin: 'manual-shell' }
        )
      } else setSessionExpectedHost(key, null)
      return { ok: true }
    }
  )
  rendererIpc.handle(
    'terminal:continue-waiting',
    (event, payload?: { tabId?: string; timeoutMs?: number }) => {
      const tabId = normalizeTabId(payload?.tabId)
      const controller = tabId
        ? commandControllers.get(getSessionKey(event.sender.id, tabId))
        : undefined
      return {
        ok:
          controller?.continueWaiting(normalizeCommandTimeout(payload?.timeoutMs ?? 120000)) ??
          false
      }
    }
  )
  rendererIpc.handle(
    'terminal:start',
    async (
      event,
      options?: { cols?: number; rows?: number; tabId?: string; initialCommand?: string }
    ) => {
      const senderId = event.sender.id
      const tabId = normalizeTabId(options?.tabId)
      if (!isUsableTerminalTabId(tabId)) {
        throw new Error(
          'Missing or reserved terminal tab id. Each terminal session requires a unique tabId.'
        )
      }
      const key = getSessionKey(senderId, tabId)
      const intent = readStoredExecutionIntent(tabId)
      if (!connectionStates.has(key) && intent) {
        if (intent.blocked && !intent.isSsh) handoffDataOnly.add(key)
        else if (intent.isSsh) {
          const saved = intent.connectionId
            ? (await listConnections()).find((item) => item.id === intent.connectionId)
            : undefined
          const expected = saved?.host ?? sanitizeExpectedTargetHost(intent.expectedTarget)
          if (expected)
            setSessionExpectedHost(key, expected, {
              connectionId: saved?.id,
              connectionName: saved?.name,
              clusterHostRegex: saved?.clusterHostRegex,
              connectionOrigin: intent.connectionOrigin ?? 'manual-shell'
            })
          else handoffDataOnly.add(key)
        }
      }
      stopSession(key)

      const launchConfig = resolveShellLaunchConfig()
      const sessionId = nextSessionId
      nextSessionId += 1
      const session = createTerminalSession({
        sessionId,
        shell: launchConfig.shell,
        args: resolveTerminalArgs(launchConfig.args, options?.initialCommand),
        cwd: launchConfig.cwd,
        env: launchConfig.env,
        cols: sanitizeDimension(options?.cols, 80),
        rows: sanitizeDimension(options?.rows, 24),
        webContents: event.sender,
        tabId,
        key
      })

      terminalOutputBuffers.set(key, '')
      terminalAutomationFilterStates.delete(key)
      sessions.set(key, session)
      noteSessionMode(key, session.mode)

      return {
        sessionId: session.id,
        tabId,
        mode: session.mode,
        pid: session.pid,
        shell: launchConfig.shell,
        cwd: launchConfig.cwd
      }
    }
  )

  rendererIpc.handle(
    'terminal:teardown-gracefully',
    async (event, payload?: { tabId?: string; timeoutMs?: number }) => {
      const tabId = normalizeTabId(payload?.tabId)
      if (!tabId) return { ok: false, error: 'Missing terminal tab id.' }
      return teardownTerminalSessionGracefully(
        event.sender.id,
        tabId,
        typeof payload?.timeoutMs === 'number' ? payload.timeoutMs : undefined
      )
    }
  )

  rendererIpc.handle('terminal:clear-restoring', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) return { ok: false }
    markTerminalSessionRestoring(event.sender.id, tabId, false)
    return { ok: true }
  })

  rendererIpc.handle(
    'terminal:set-expected-host',
    async (
      event,
      payload?: {
        tabId?: string
        host?: string | null
        clusterHostRegex?: string | null
        connectionId?: string
        connectionName?: string
      }
    ) => {
      const tabId = normalizeTabId(payload?.tabId)
      if (!tabId || !isUsableTerminalTabId(tabId)) {
        return { ok: false as const, error: 'Missing or reserved terminal tab id.' }
      }
      const key = getSessionKey(event.sender.id, tabId)
      sessionWebContents.set(key, event.sender)
      const host = typeof payload?.host === 'string' ? payload.host.trim() : ''
      const clusterHostRegex =
        typeof payload?.clusterHostRegex === 'string' ? payload.clusterHostRegex : null
      const connectionId =
        typeof payload?.connectionId === 'string' ? payload.connectionId.trim() : ''
      const savedConnection = connectionId
        ? (await listConnections()).find((connection) => connection.id === connectionId)
        : undefined
      if (connectionId && (!savedConnection || savedConnection.host !== host)) {
        return {
          ok: false as const,
          error: 'SSH connection identity does not match a saved connection.'
        }
      }
      handoffDataOnly.delete(key)
      const actionHops = (savedConnection?.actions ?? [])
        .map(extractSshDestinationHost)
        .filter((hop): hop is string => Boolean(hop))
      const proxyJump = (savedConnection?.sshOptions ?? []).flatMap((option) => {
        const match = option.match(/(?:^-J\s*|ProxyJump=)([^\s]+)/i)
        return match ? match[1].split(',').map((hop) => hop.replace(/^.*@/, '')) : []
      })
      const sshHopChain = [...proxyJump, host, ...actionHops].filter(Boolean)
      const connectionOrigin = savedConnection
        ? sshHopChain.length > 1
          ? 'special-ssh'
          : 'connection-card'
        : 'manual-shell'
      setSessionExpectedHost(key, savedConnection ? host : null, {
        clusterHostRegex: host ? (savedConnection?.clusterHostRegex ?? clusterHostRegex) : null,
        connectionId: savedConnection?.id,
        connectionName: savedConnection?.name,
        connectionOrigin,
        sshHopChain
      })
      return { ok: true as const, host: host || undefined }
    }
  )

  rendererIpc.handle(
    'terminal:patch-cluster-host-regex',
    (event, payload?: { tabId?: string; clusterHostRegex?: string | null }) => {
      const tabId = normalizeTabId(payload?.tabId)
      if (!tabId || !isUsableTerminalTabId(tabId)) {
        return { ok: false as const, error: 'Missing or reserved terminal tab id.' }
      }
      const key = getSessionKey(event.sender.id, tabId)
      sessionWebContents.set(key, event.sender)
      const state = getConnectionState(key)
      const next = patchConnectionClusterHostRegex(state, payload?.clusterHostRegex)
      setConnectionState(key, next)
      return { ok: true as const, clusterHostRegex: next.clusterHostRegex }
    }
  )

  /**
   * Verified-login write-back (SSOT write source). Confirms only on the pane
   * that logged in. Subterminal logins never mark the parent tab ready.
   */
  rendererIpc.handle(
    'terminal:confirm-login',
    (
      event,
      payload?: {
        tabId?: string
        sourceTabId?: string
        localHost?: string
        expectedTargetHost?: string
        jumpPromptHost?: string
      }
    ): {
      ok: boolean
      tabId?: string
      promptHost?: string
      learned?: boolean
      alignment?: 'unknown' | 'aligned' | 'drifted'
      ready?: boolean
      aliases?: string[]
      error?: string
    } => {
      const tabId = normalizeTabId(payload?.tabId)
      const sourceTabId = normalizeTabId(payload?.sourceTabId)
      const confirmTabId = normalizeTabId(
        resolveLoginConfirmTarget({ tabId: tabId ?? '', sourceTabId }).confirmTabId
      )
      if (!confirmTabId || !isUsableTerminalTabId(confirmTabId)) {
        return { ok: false, error: 'Missing or reserved terminal tab id.' }
      }
      const key = getSessionKey(event.sender.id, confirmTabId)
      sessionWebContents.set(key, event.sender)
      const localHost = payload?.localHost?.trim() || hostname()
      const expectedTargetHost = sanitizeExpectedTargetHost(payload?.expectedTargetHost)
      const jumpPromptHost = payload?.jumpPromptHost?.trim()

      const confirmOn = (targetTabId: string): ConnectionState | undefined => {
        const targetKey = getSessionKey(event.sender.id, targetTabId)
        const state =
          connectionStates.get(targetKey) ??
          createConnectionState(sessions.get(targetKey)?.mode ?? 'none')
        const buffer = terminalOutputBuffers.get(targetKey) ?? ''
        const promptHost = resolveSessionAlignment({
          output: buffer,
          expectedHost: state.expectedHost,
          aliases: state.aliases,
          clusterHostRegex: state.clusterHostRegex,
          localHost
        }).promptHost
        const expectedFinalHost = expectedTargetHost || state.expectedHost
        const onKnownIntermediateHop = Boolean(
          promptHost &&
          state.sshHopChain?.slice(0, -1).some((hop) => isPromptHostAligned(promptHost, hop))
        )
        if (
          state.monitorPolicy === 'special' &&
          expectedFinalHost &&
          promptHost &&
          !isPromptHostAligned(promptHost, expectedFinalHost) &&
          (onKnownIntermediateHop || !matchesClusterHostRegex(promptHost, state.clusterHostRegex))
        ) {
          setConnectionState(targetKey, {
            ...state,
            promptHost,
            alignment: 'unknown',
            ready: false
          })
          return undefined
        }
        if (
          promptHost &&
          jumpPromptHost &&
          isPromptHostAligned(promptHost, jumpPromptHost) &&
          expectedFinalHost &&
          !isPromptHostAligned(promptHost, expectedFinalHost)
        ) {
          setConnectionState(targetKey, {
            ...state,
            promptHost,
            alignment: 'drifted',
            ready: false
          })
          return undefined
        }
        if (
          promptHost &&
          expectedFinalHost &&
          !isIpv4Literal(expectedFinalHost) &&
          !isPromptHostAligned(promptHost, expectedFinalHost) &&
          !matchesClusterHostRegex(promptHost, state.clusterHostRegex)
        ) {
          setConnectionState(targetKey, {
            ...state,
            promptHost,
            alignment: 'drifted',
            ready: false
          })
          return undefined
        }
        const result = confirmLoginState(state, promptHost, { localHost })
        const anchored = applyConfirmedLoginAnchor(result.state, {
          expectedTargetHost,
          jumpPromptHost
        })
        setConnectionState(targetKey, anchored)
        return result.ok ? anchored : undefined
      }

      const confirmed = confirmOn(confirmTabId)
      if (!confirmed) {
        const failed = connectionStates.get(key)
        return {
          ok: false,
          tabId: confirmTabId,
          promptHost: failed?.promptHost,
          alignment: failed?.alignment,
          ready: failed?.ready,
          aliases: failed?.aliases,
          error: 'Login could not be verified (terminal still shows the local prompt).'
        }
      }
      markTerminalSessionRestoring(event.sender.id, confirmTabId, false)
      if (!parseTemporarySubterminalTabId(confirmTabId)) {
        onMainTabLoginConfirmed?.(confirmTabId, event.sender.id)
      }
      const state = connectionStates.get(key)
      return {
        ok: true,
        tabId: confirmTabId,
        promptHost: state?.promptHost,
        learned: Boolean(state?.aliases.length),
        alignment: state?.alignment,
        ready: state?.ready,
        aliases: state?.aliases
      }
    }
  )

  rendererIpc.handle(
    'terminal:open-subterminal',
    (
      event,
      options?: {
        parentTabId?: string
        terminalName?: string
        cols?: number
        rows?: number
        initialCommand?: string
      }
    ) => {
      return openTemporarySubterminal(
        event.sender,
        options?.parentTabId,
        options?.terminalName ?? '',
        {
          cols: options?.cols,
          rows: options?.rows,
          initialCommand: options?.initialCommand
        }
      )
    }
  )

  rendererIpc.handle(
    'terminal:read-subterminal',
    (event, options?: { parentTabId?: string; terminalName?: string; maxChars?: number }) => {
      return readTemporarySubterminalOutput(
        event.sender,
        options?.parentTabId,
        options?.terminalName ?? '',
        options?.maxChars
      )
    }
  )

  rendererIpc.handle(
    'terminal:interrupt-subterminal',
    (event, options?: { parentTabId?: string; terminalName?: string }) => {
      return interruptTemporarySubterminal(
        event.sender,
        options?.parentTabId,
        options?.terminalName ?? ''
      )
    }
  )

  rendererIpc.handle('terminal:interrupt', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) return { ok: false, interrupted: false, error: 'Missing tabId' }
    const target =
      resolveCtrlCTabId({
        requestedTabId: tabId,
        pendingTabIds: pendingCommandTabIds(event.sender.id)
      }) || tabId
    const interrupted = interruptPendingTerminalCommands(event.sender.id, target)
    return { ok: true, interrupted }
  })

  rendererIpc.on(
    'terminal:write',
    async (event, payload: { data?: string; tabId?: string } | string) => {
      let data = typeof payload === 'string' ? payload : payload?.data
      if (typeof data !== 'string') return

      const tabId = normalizeTabId(typeof payload === 'string' ? undefined : payload?.tabId)
      if (!tabId) return
      const session = sessions.get(getSessionKey(event.sender.id, tabId))
      if (!session) {
        sendIfAlive(
          event.sender,
          tabId,
          getSessionKey(event.sender.id, tabId),
          'terminal:data',
          '\r\n\x1b[31mTerminal session is not active. Command input was blocked.\x1b[0m\r\n'
        )
        return
      }

      if (session.mode === 'pipe' && classifyPipeCommand(data) === 'interactive') {
        sendIfAlive(
          event.sender,
          tabId,
          getSessionKey(event.sender.id, tabId),
          'terminal:data',
          '\r\n\x1b[31mInteractive commands (ssh login shell, sudo/su/passwd prompts, mysql/psql/sftp REPL) require PTY mode. Current terminal is pipe fallback; command blocked. One-shot non-interactive ssh (BatchMode or remote command without -t) is still allowed.\x1b[0m\r\n'
        )
        return
      }

      if (isTerminalInterruptPayload(data)) {
        interruptPendingTerminalCommands(event.sender.id, tabId)
        return
      }

      if (isUserInputLocked(event.sender.id, tabId)) return

      if (data.startsWith('__crescent_secret_')) {
        const key = getSessionKey(event.sender.id, tabId)
        const connectionId = connectionStates.get(key)?.connectionId
        const connection = (await listConnections()).find((item) => item.id === connectionId)
        // Recheck after resolving env credentials; PTY/lock/prompt may have changed.
        if (
          sessions.get(key) !== session ||
          connectionStates.get(key)?.connectionId !== connectionId ||
          isUserInputLocked(event.sender.id, tabId)
        )
          return
        data =
          resolveTerminalSecretReference(
            data,
            connection,
            session.mode === 'pty' &&
              hasUnterminatedSecretPrompt(terminalOutputBuffers.get(key) ?? ''),
            isPrivilegePasswordPrompt(
              extractPasswordPromptLine(terminalOutputBuffers.get(key) ?? '') ?? ''
            )
          ) ?? data
        session.write(data)
        return
      }
      noteManualTerminalInput(getSessionKey(event.sender.id, tabId), data)
      session.write(data)
    }
  )

  rendererIpc.handle(
    'terminal:paste-command',
    async (
      event,
      payload: {
        command?: string
        execute?: boolean
        tabId?: string
      }
    ) => {
      const command = sanitizeCommand(payload?.command)
      if (!command) return { ok: false as const, error: 'Command is empty.' }

      const tabId = normalizeTabId(payload?.tabId)
      if (!tabId) return { ok: false as const, error: 'Terminal tab is missing.' }
      const key = getSessionKey(event.sender.id, tabId)
      let session = sessions.get(key)
      connTrace(
        'paste-command-received',
        `tab=${tabId}`,
        `execute=${Boolean(payload?.execute)}`,
        `session=${session?.mode ?? 'missing'}`
      )
      if (!session) {
        sendIfAlive(
          event.sender,
          tabId,
          key,
          'terminal:data',
          '\r\n\x1b[31mTerminal session is not active. Command paste was blocked.\x1b[0m\r\n'
        )
        return { ok: false as const, error: 'Terminal session is not active.' }
      }

      const unlockDeadline = Date.now() + 10_000
      while (isUserInputLocked(event.sender.id, tabId) && Date.now() < unlockDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (isUserInputLocked(event.sender.id, tabId)) {
        const error = 'Terminal input remained locked; command was not sent.'
        connTrace('paste-command-blocked', `tab=${tabId}`, 'reason=input-locked')
        sendIfAlive(event.sender, tabId, key, 'terminal:data', `\r\n\x1b[31m${error}\x1b[0m\r\n`)
        return { ok: false as const, error }
      }
      session = sessions.get(key)
      if (!session) return { ok: false as const, error: 'Terminal session is no longer active.' }

      if (!payload?.execute && session.mode === 'pipe') {
        sendIfAlive(
          event.sender,
          tabId,
          key,
          'terminal:data',
          '\r\n\x1b[33mPipe fallback cannot paste without executing. Press Run SSH/Execute instead.\x1b[0m\r\n'
        )
        return { ok: false as const, error: 'Pipe fallback cannot paste without executing.' }
      }

      if (session.mode === 'pipe' && classifyPipeCommand(command) === 'interactive') {
        sendIfAlive(
          event.sender,
          tabId,
          key,
          'terminal:data',
          '\r\n\x1b[31mInteractive commands (ssh login shell, sudo/su/passwd prompts, mysql/psql/sftp REPL) require PTY mode. Current terminal is pipe fallback; command not executed. One-shot non-interactive ssh (BatchMode or remote command without -t) is still allowed.\x1b[0m\r\n'
        )
        return { ok: false as const, error: 'Interactive SSH login requires PTY mode.' }
      }

      if (payload?.execute) {
        // Raw echo of automation-pasted commands is suppressed by default so
        // the terminal never shows a repeated ssh/.zshrc noise wall; the command
        // is displayed exactly once. CRESCENT_DEBUG_CONN=1 shows the raw echo.
        automationEchoSuppressions.set(key, { echo: command, until: Date.now() + 15_000 })
        session.display(formatReadableCommandInput(command))
        noteDispatchedManualCommand(key, command)
      }

      session.write(`${command}${payload?.execute ? '\r' : ''}`)
      connTrace('paste-command-written', `tab=${tabId}`, `mode=${session.mode}`)
      return { ok: true as const }
    }
  )

  rendererIpc.handle('terminal:get-context', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    const key = tabId ? getSessionKey(event.sender.id, tabId) : ''
    let state = key ? connectionStates.get(key) : undefined
    const expectedHost = state?.expectedHost ?? ''
    const output = key ? (terminalOutputBuffers.get(key) ?? '') : ''
    // Match injection-guard: prefer the runtime anchor learned after login so
    // IP-configured connections that show a hostname prompt stay aligned.
    const effectiveExpectedHost = (state ? runtimeAnchorHost(state) : undefined) ?? expectedHost
    const promptEvidence = executionStates.get(key)?.promptText ?? ''
    const resolved = state
      ? resolveSessionAlignment({
          output: promptEvidence,
          expectedHost: effectiveExpectedHost || state.expectedHost,
          aliases: state.aliases,
          clusterHostRegex: state.clusterHostRegex,
          localHost: hostname()
        })
      : undefined

    // Remember the jump-box hostname while logging in (often differs from the
    // configured IP expectedHost). Used later to detect fall-back-to-jump drift.
    if (
      state &&
      key &&
      !state.jumpPromptHost &&
      !runtimeAnchorHost(state) &&
      resolved?.promptHost &&
      resolved.promptHost !== 'local-shell'
    ) {
      const withJump: ConnectionState = {
        ...state,
        jumpPromptHost: normalizeHostToken(resolved.promptHost)
      }
      setConnectionState(key, withJump)
      state = withJump
    }

    // Live buffer only. After SSH drop / respawn the SSOT host is stale; a
    // missing or local-shell prompt must not look like the current remote.
    const promptHost = resolved?.promptHost
    const manualSshActive = Boolean(
      state?.manualSshActive &&
      promptHost !== 'local-shell' &&
      !(promptHost && isLocalMachinePromptHost(promptHost, hostname()))
    )
    const gateAlignment = state ? state.alignment : (resolved?.alignment ?? 'unknown')
    const alignment = gateAlignment
    const hasSsotTarget = Boolean(expectedHost || state?.clusterHostRegex)
    const sessionAligned = hasSsotTarget ? alignment : 'unknown'
    // SSOT ready stays independent of transient gate drift so the renderer can
    // skip re-login when the PTY is still on a remote verified session.
    const ready = Boolean(state?.ready)
    const returnToJumpHost = Boolean(state && promptHost && isReturnToJumpHost(state, promptHost))
    connTrace(
      'getContext',
      `tab=${tabId}`,
      `aligned=${alignment}`,
      `expected=${expectedHost || '-'}`,
      `runtime=${state?.runtimeExpectedHost || '-'}`,
      `aliases=${state?.aliases.join(',') || '-'}`,
      `ready=${ready ? 'yes' : 'no'}`,
      `returnJump=${returnToJumpHost ? 'yes' : 'no'}`,
      `restoring=${tabId && key && restoringSessionKeys.has(key) ? 'yes' : 'no'}`,
      `outputBytes=${Buffer.byteLength(output)}`
    )

    if (!tabId) {
      return { mode: 'none', output: '', cwd: '', shell: '', restoring: false }
    }
    const session = sessions.get(key)
    const restoring = restoringSessionKeys.has(key)
    const phase = connectionPhase(state, alignment, Boolean(session), restoring)
    const identity = {
      paneRole: parseTemporarySubterminalTabId(tabId)
        ? ('subterminal' as const)
        : ('main' as const),
      paneId: tabId,
      owner: state?.owner ?? 'user',
      executionMode: state?.expectedHost || manualSshActive ? ('ssh' as const) : ('local' as const),
      connectionId: state?.connectionId,
      connectionName: state?.connectionName,
      expectedTarget: (state ? runtimeAnchorHost(state) : undefined) ?? state?.expectedHost,
      observedHost: promptHost,
      connectionPhase: phase,
      connectionOrigin: state?.connectionOrigin ?? 'manual-shell',
      monitorPolicy: state?.monitorPolicy ?? 'manual',
      targetScope: state?.targetScope ?? 'host',
      sshHopChain: state?.sshHopChain ?? [],
      manualSshActive,
      clusterHostRegex: state?.clusterHostRegex,
      sessionGeneration: session?.id ?? 0,
      activity: session ? executionStates.get(key)?.phase : 'session-exited',
      sshHops: state?.sshHops ?? []
    }
    if (!session) {
      // No live PTY: never report aligned/ready from stale SSOT or output buffer.
      // Restore/reconnect must recreate a session instead of short-circuiting.
      return {
        mode: 'none',
        output,
        cwd: '',
        shell: '',
        expectedHost: expectedHost || undefined,
        sessionAligned: 'unknown' as const,
        alignment: 'unknown' as const,
        promptHost,
        aliases: state?.aliases ?? [],
        ready: false,
        jumpPromptHost: state?.jumpPromptHost,
        runtimeExpectedHost: state?.runtimeExpectedHost,
        returnToJumpHost,
        restoring,
        ...identity
      }
    }

    return {
      mode: session.mode,
      pid: session.pid,
      cwd: session.cwd,
      shell: session.shell,
      output,
      expectedHost: expectedHost || undefined,
      sessionAligned,
      alignment,
      promptHost,
      aliases: state?.aliases ?? [],
      ready,
      jumpPromptHost: state?.jumpPromptHost,
      runtimeExpectedHost: state?.runtimeExpectedHost,
      returnToJumpHost,
      restoring,
      ...identity
    }
  })

  rendererIpc.on(
    'terminal:resize',
    (event, dimensions: { cols?: number; rows?: number; tabId?: string }) => {
      const tabId = normalizeTabId(dimensions?.tabId)
      if (!tabId) return
      const session = sessions.get(getSessionKey(event.sender.id, tabId))
      if (!session) return

      session.resize(
        sanitizeDimension(dimensions?.cols, 80),
        sanitizeDimension(dimensions?.rows, 24)
      )
    }
  )

  rendererIpc.on('terminal:stop', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) return
    const key = getSessionKey(event.sender.id, tabId)
    stopSession(key)
    invalidateTerminalPlans(key)
    connectionStates.delete(key)
    sessionWebContents.delete(key)
    restoringSessionKeys.delete(key)
    releaseTemporarySubterminalByTabId(event.sender.id, tabId)
  })

  rendererIpc.on('terminal:clear', (event, payload?: { tabId?: string }) => {
    const tabId = normalizeTabId(payload?.tabId)
    if (!tabId) return
    sessions.get(getSessionKey(event.sender.id, tabId))?.clear()
  })
}

export function stopAllTerminalSessions(): void {
  for (const key of sessions.keys()) invalidateTerminalPlans(key)
  handoffDataOnly.clear()
  uncertainCommands.clear()
  executionStates.clear()
  commandControllers.clear()
  sessionManager.clear()
  visibleTerminalEvents.flushAll()
}

function stopSession(key: string): void {
  invalidateTerminalPlans(key)
  uncertainCommands.delete(key)
  commandControllers.delete(key)
  sessionManager.stop(key)
  executionStates.delete(key)
  // Keep owner and connection identity across a soft restart, but clear liveness.
  invalidateConnectionSessionLiveness(key)
}

function invalidateConnectionSessionLiveness(key: string): void {
  const state = connectionStates.get(key)
  if (!state) return
  setConnectionState(key, {
    ...state,
    alignment: 'unknown',
    ready: false,
    connectionFault: 'lost',
    lastError: undefined
  })
}

function detectEnvironmentDriftForSession(
  key: string,
  tabId: string,
  command: string,
  session: TerminalSession
): TerminalCommandExecutionResult | undefined {
  const state = connectionStates.get(key)
  const buffer = executionStates.get(key)?.promptText ?? ''
  if (!state || !buffer) return undefined

  const verdict = evaluateInjectionGuard(state, buffer, { localHost: hostname() })
  if (verdict.alignment !== 'drifted') return undefined

  const observedHost = verdict.observedHost
  const anchorHost = verdict.effectiveExpectedHost
  if (!observedHost || !anchorHost) return undefined

  // Only exit-to-local (or laptop hostname) is a real session break. Remote→
  // remote hops are healed above via shouldReanchor; never fire recovery for them.
  setConnectionState(key, {
    ...state,
    promptHost: observedHost,
    alignment: 'drifted',
    ready: false,
    connectionFault: 'degraded'
  })
  const driftKey = `${anchorHost}|${observedHost}`

  // Defensive diagnostic: dump the full session state whenever the guard blocks
  // injection. This is the single source of truth for why runtimeExpectedHost
  // may be null/stale and which terminal the command was routed to.
  console.error('[EnvGuard] Blocked injection:', {
    terminalId: tabId,
    expectedHost: state?.expectedHost,
    runtimeExpectedHost: state?.runtimeExpectedHost,
    observedHost,
    promptHost: state?.promptHost,
    ready: state?.ready,
    alignment: state?.alignment,
    aliases: state?.aliases,
    commandBytes: Buffer.byteLength(command),
    anchorHost
  })

  return {
    ok: false,
    command,
    mode: session.mode,
    cwd: session.cwd,
    output: '',
    environmentDrift: true,
    code: 'SSH_TARGET_UNAVAILABLE',
    connectionPhase: 'ssh-lost',
    recoveryAction: 'reconnect-or-select-target',
    observedHost,
    expectedHost: anchorHost,
    driftKey,
    error: `Terminal left target environment (expected ${anchorHost}, observed ${observedHost}). Command was not injected.`
  }
}

function ensureTemporarySubterminal(
  webContents: WebContents,
  parentTabId: string,
  terminalName: string,
  options?: TemporarySubterminalOpenOptions
): { ok: true; entry: TemporarySubterminalEntry } | { ok: false; error: string } {
  const poolKey = getSessionKey(webContents.id, parentTabId)
  const pool = temporarySubterminals.get(poolKey) ?? []
  const existing = pool.find((entry) => entry.name === terminalName)

  if (existing) {
    if (!sessions.has(getSessionKey(webContents.id, existing.tabId))) {
      startTemporaryTerminalSession(webContents, existing.tabId, options)
      existing.detached = false
      existing.busy = false
    }
    existing.lastUsedAt = Date.now()
    return { ok: true, entry: existing }
  }

  if (pool.length >= MAX_TEMPORARY_SUBTERMINALS) {
    return {
      ok: false,
      error: `At most ${MAX_TEMPORARY_SUBTERMINALS} temporary sub-terminals can run under one terminal. Reuse one of: ${pool
        .map((entry) => entry.name)
        .join(', ')}.`
    }
  }

  const entry: TemporarySubterminalEntry = {
    name: terminalName,
    tabId: createTemporarySubterminalTabId(parentTabId, terminalName),
    busy: false,
    detached: false,
    lastUsedAt: Date.now()
  }
  pool.push(entry)
  temporarySubterminals.set(poolKey, pool)
  startTemporaryTerminalSession(webContents, entry.tabId, options)

  return { ok: true, entry }
}

function startTemporaryTerminalSession(
  webContents: WebContents,
  tabId: string,
  options?: TemporarySubterminalOpenOptions
): void {
  const key = getSessionKey(webContents.id, tabId)
  stopSession(key)

  const launchConfig = resolveShellLaunchConfig()
  const sessionId = nextSessionId
  nextSessionId += 1
  const session = createTerminalSession({
    sessionId,
    shell: launchConfig.shell,
    args: resolveTerminalArgs(launchConfig.args, options?.initialCommand),
    cwd: launchConfig.cwd,
    env: launchConfig.env,
    cols: sanitizeDimension(options?.cols, 100),
    rows: sanitizeDimension(options?.rows, 24),
    webContents,
    tabId,
    key
  })

  terminalOutputBuffers.set(key, '')
  terminalAutomationFilterStates.delete(key)
  sessions.set(key, session)
  noteSessionMode(key, session.mode)
}

function releaseTemporarySubterminalByTabId(senderId: number, tabId: string): void {
  const parsed = parseTemporarySubterminalTabId(tabId)
  if (!parsed) return

  const poolKey = getSessionKey(senderId, parsed.parentTabId)
  const pool = temporarySubterminals.get(poolKey)
  if (!pool) return

  const next = pool.filter((entry) => entry.tabId !== tabId)
  if (next.length === 0) temporarySubterminals.delete(poolKey)
  else temporarySubterminals.set(poolKey, next)
}

function clearTemporarySubterminalDetached(senderId: number, tabId: string): void {
  const parsed = parseTemporarySubterminalTabId(tabId)
  if (!parsed) return

  const poolKey = getSessionKey(senderId, parsed.parentTabId)
  const entry = (temporarySubterminals.get(poolKey) ?? []).find((item) => item.tabId === tabId)
  if (!entry) return
  entry.detached = false
  entry.lastUsedAt = Date.now()
}

function normalizeTemporaryTerminalName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, '-').slice(0, 40)

  return normalized || 'temporary'
}

function createTemporarySubterminalTabId(parentTabId: string, terminalName: string): string {
  return `${parentTabId}::subterminal::${encodeURIComponent(terminalName)}`
}

export function resolveParentTerminalTabId(tabId: string): string {
  const parsed = parseTemporarySubterminalTabId(tabId)
  return parsed?.parentTabId ?? tabId.trim()
}

function parseTemporarySubterminalTabId(
  tabId: string
): { parentTabId: string; name: string } | undefined {
  const marker = '::subterminal::'
  const markerIndex = tabId.indexOf(marker)
  if (markerIndex === -1) return undefined

  const parentTabId = tabId.slice(0, markerIndex)
  const encodedName = tabId.slice(markerIndex + marker.length)
  try {
    return { parentTabId, name: decodeURIComponent(encodedName) }
  } catch {
    return { parentTabId, name: encodedName }
  }
}

function createTerminalSession(input: {
  sessionId: number
  shell: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
  webContents: WebContents
  tabId: string
  key: string
}): TerminalSession {
  sessionWebContents.set(input.key, input.webContents)
  executionStates.set(input.key, new TerminalExecutionState())
  let creating = true
  const current = (): boolean => creating || sessions.get(input.key)?.id === input.sessionId
  const events: TerminalSessionEvents = {
    onData: (data) => {
      if (current()) {
        observeTerminalTransport(input.key, data)
        sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:data', data)
      }
    },
    onDisplay: (data) => {
      if (current()) sendVisibleTerminalData(input.webContents, input.tabId, input.key, data)
    },
    onPrompt: (cwd) => {
      if (!current()) return
      const session = sessions.get(input.key)
      if (session?.id === input.sessionId) session.cwd = cwd
      sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:prompt', {
        tabId: input.tabId,
        cwd,
        prompt: formatPipePrompt(cwd)
      })
    },
    onExit: (event) => {
      if (!current()) return
      executionStates.get(input.key)?.begin('session-exited')
      uncertainCommands.delete(input.key)
      notifyTerminalExit(input.key, event)
      sendIfAlive(input.webContents, input.tabId, input.key, 'terminal:exit', {
        tabId: input.tabId,
        sessionId: input.sessionId,
        ...event
      })
      deleteIfCurrent(input.key, input.sessionId)
    }
  }
  try {
    try {
      return createPtySession(input, events)
    } catch (error) {
      events.onData(
        `\r\n\x1b[33mPTY unavailable (${error instanceof Error ? error.message : String(error)}). Falling back to shell pipes.\x1b[0m\r\n`
      )
      return createPipeSession(input, events)
    }
  } finally {
    creating = false
  }
}

function resolveTerminalArgs(defaultArgs: string[], initialCommand: string | undefined): string[] {
  const command = initialCommand?.trim()
  if (!command) return defaultArgs

  return process.platform === 'win32' ? [command] : ['-lc', command]
}

function deleteIfCurrent(key: string, sessionId: number): void {
  if (sessionManager.finish(key, sessionId)) invalidateConnectionSessionLiveness(key)
}

function waitForSessionExit(key: string): Promise<void> {
  return new Promise((resolve) => {
    if (!sessions.has(key)) {
      resolve()
      return
    }
    const waiters =
      terminalExitWaiters.get(key) ?? new Set<(event: TerminalExitNotification) => void>()
    const listener = (): void => resolve()
    waiters.add(listener)
    terminalExitWaiters.set(key, waiters)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function notifyTerminalExit(key: string, event: TerminalExitNotification): void {
  sessionManager.notifyExit(key, event)
}

function interruptCommandSession(key: string, session: TerminalSession): void {
  if (sessions.get(key)?.id !== session.id) return

  session.interrupt()
}

function normalizeCommandTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return TERMINAL_COMMAND_TIMEOUT_MS
  return Math.max(
    TERMINAL_COMMAND_MIN_TIMEOUT_MS,
    Math.min(TERMINAL_COMMAND_MAX_TIMEOUT_MS, Math.round(timeoutMs))
  )
}

export function isInteractiveCommand(data: string): boolean {
  return classifyPipeCommand(data) === 'interactive'
}

function sanitizeDimension(value: unknown, fallback: number): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.round(numeric))
}

function appendTerminalContext(key: string, data: string): void {
  const current = terminalOutputBuffers.get(key) ?? ''
  const next = `${current}${data}`
  const output = next.slice(-MAX_CONTEXT_BUFFER)
  terminalOutputBuffers.set(key, output)
}

function observeTerminalTransport(key: string, data: string): void {
  const activity = executionStates.get(key)
  if (!activity) return
  const observation = activity.consume(data)
  const state = connectionStates.get(key)
  if (!state) return
  if (observation.prompt) {
    const hop = observeSshHopPrompt(state, observation.prompt, hostname())
    if (hop) {
      setConnectionState(key, hop)
      return
    }
  }
  if (observation.disconnected && !pendingCommandPromises.has(key)) {
    // A nested connection closing does not prove the original connection was lost.
    if ((state.sshHops?.length ?? 0) > 1 || state.pendingSshHop) {
      const returning = { ...state, pendingSshExit: true }
      const hop = observation.prompt
        ? observeSshHopPrompt(returning, observation.prompt, hostname())
        : undefined
      setConnectionState(key, hop ?? returning)
      return
    }
    if (state.expectedHost || state.manualSshActive)
      setConnectionState(key, {
        ...state,
        ready: false,
        alignment: 'unknown',
        connectionFault: 'lost'
      })
    return
  }
  if (!observation.shellReady || pendingCommandPromises.has(key) || !state.expectedHost) return
  const alignment = resolveGateAlignment(state, activity.promptText, hostname())
  // A prompt change alone fences execution, but never triggers destructive recovery.
  if (alignment === 'drifted')
    setConnectionState(key, { ...state, ready: false, alignment, connectionFault: 'degraded' })
  else if (alignment === 'aligned' && state.connectionFault !== 'lost') {
    const recovered = recoverTimedOutSshSession(state, activity.promptText, hostname())
    setConnectionState(
      key,
      recovered ?? { ...state, ready: true, alignment, connectionFault: undefined }
    )
  }
}

function flushVisibleTerminalData(key: string): void {
  visibleTerminalEvents.flush(key)
}
function sendVisibleTerminalData(
  webContents: WebContents,
  tabId: string,
  key: string,
  data: string
): void {
  visibleTerminalEvents.send(webContents, tabId, key, data)
}

function sendIfAlive(
  webContents: WebContents,
  tabId: string,
  key: string,
  channel: string,
  payload: unknown
): void {
  if (channel === 'terminal:data' && typeof payload === 'string') {
    const visiblePayload = filterAutomationControlOutput(key, payload)
    if (visiblePayload) sendVisibleTerminalData(webContents, tabId, key, visiblePayload)

    terminalDataWaiters.get(key)?.forEach((listener) => listener(payload))
    const uncertain = uncertainCommands.get(key)
    if (uncertain && sessions.get(key)?.id === uncertain.sessionId) {
      uncertain.buffer = (uncertain.buffer + payload).slice(-64000)
      const activity = executionStates.get(key)
      if (
        parseCommandBuffer(
          `${uncertain.startMarker}\n${uncertain.buffer}`,
          uncertain.startMarker,
          uncertain.endMarker
        ).done ||
        (uncertain.interrupted && activity?.phase === 'shell-ready' && !activity.alternateScreen)
      ) {
        uncertainCommands.delete(key)
        activity?.begin('shell-ready')
      }
    }
    return
  }

  safeWebContentsSend(webContents, channel, payload)
}

function filterAutomationControlOutput(key: string, data: string): string {
  const state = terminalAutomationFilterStates.get(key)
  const filtered = state
    ? filterAutomationControlOutputWithState(data, state)
    : filterAutomationControlLines(data)

  return suppressAutomationEcho(key, filtered)
}

/**
 * Drop the raw echo line of an automation-pasted command from the visible
 * terminal (the command is displayed once via session.display). Enabled by
 * default; CRESCENT_DEBUG_CONN=1 keeps the raw echo for debugging.
 */
function suppressAutomationEcho(key: string, data: string): string {
  const suppression = automationEchoSuppressions.get(key)
  if (!suppression || debugConnEnabled()) return data
  if (Date.now() > suppression.until) {
    automationEchoSuppressions.delete(key)
    return data
  }

  const parts = data.split(/(\r?\n)/)
  let output = ''
  let skipNewline = false

  for (const part of parts) {
    if (/^\r?\n$/.test(part)) {
      if (!skipNewline) output += part
      skipNewline = false
      continue
    }

    if (isAutomationEchoLine(part, suppression.echo)) {
      skipNewline = true
      continue
    }

    skipNewline = false
    output += part
  }

  return output
}

/**
 * True when a terminal data line is the raw echo of an automation-pasted
 * command. The line may be prefixed by the shell prompt; custom prompt themes
 * (p10k, starship, bracketed prompts) do not match `stripPromptPrefix`, so the
 * compacted command is also matched as a trailing segment. The command itself
 * is displayed once via `session.display`, which is why the echo is dropped.
 */
function normalizeTabId(tabId: string | undefined): string {
  return tabId?.trim() ?? ''
}

const RESERVED_TERMINAL_TAB_IDS = new Set(['default', 'local'])

function isUsableTerminalTabId(tabId: string): boolean {
  if (!tabId) return false
  return !RESERVED_TERMINAL_TAB_IDS.has(tabId.toLowerCase())
}

function getSessionKey(senderId: number, tabId: string): string {
  return `${senderId}:${tabId}`
}

function pendingCommandTabIds(senderId: number): string[] {
  const prefix = `${senderId}:`
  const ids: string[] = []
  for (const key of pendingCommandPromises.keys()) {
    if (!key.startsWith(prefix)) continue
    const tabId = key.slice(prefix.length)
    if (tabId) ids.push(tabId)
  }
  return ids
}

function isUserInputLocked(senderId: number, tabId: string): boolean {
  // Explicit transport states allow password entry or manual control of a running TUI.
  const activity = executionStates.get(getSessionKey(senderId, tabId))
  if (
    activity?.phase === 'awaiting-input' ||
    (activity?.phase === 'interactive-application' && activity.alternateScreen)
  )
    return false
  return shouldBlockTerminalUserInput({
    hasPendingCommand: pendingCommandPromises.has(getSessionKey(senderId, tabId)),
    isAgentExecutionTab: isPtyExecutionTabLocked(tabId)
  })
}
