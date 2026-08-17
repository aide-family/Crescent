import { isPlausibleSshHost } from './ssh-destination'
import {
  findNewestPromptSignal,
  isLocalShellPromptVisible,
  isPromptHostAligned,
  normalizeHostToken
} from './terminal-prompt-host'

/** Runtime EnvGuard anchor; port-like leftovers (`22` from `-p 22`) are ignored. */
export function runtimeAnchorHost(state: ConnectionState): string | undefined {
  const runtime = normalizeHostToken(state.runtimeExpectedHost ?? '')
  return runtime && isPlausibleSshHost(runtime) ? runtime : undefined
}

/**
 * Single source of truth for per-terminal connection state (main process).
 *
 * Consumers (gate / recovery / status bar / route / model context) must only
 * read through this shape; no private derived views.
 */

export type TerminalAlignment = 'unknown' | 'aligned' | 'drifted'
export type TerminalMode = 'none' | 'pty' | 'pipe'

export interface RecoveryBudget {
  /** Drift key (expected|observed) this budget applies to. */
  driftKey?: string
  attempts: number
  windowStartAt: number
}

export interface ConnectionState {
  mode: TerminalMode
  /** Expected connection host (set on login start; cleared on local fallback). */
  expectedHost?: string
  /**
   * Runtime environment anchor: the prompt host actually reached after login
   * (e.g. web1.zhangke after a multi-hop ssh). The injection guard compares the
   * observed prompt against this anchor once a login succeeded, instead of the
   * static configured host which only reflects the jump host.
   */
  runtimeExpectedHost?: string
  /**
   * Hostname prompt observed on the jump box during login (often differs from
   * the configured IP `expectedHost`). Returning here after a deeper runtime
   * anchor is environment drift, not a peer hop.
   */
  jumpPromptHost?: string
  /** Last observed prompt host (normalized). */
  promptHost?: string
  /** Learned aliases: observed prompt hosts that proved to be on target. */
  aliases: string[]
  alignment: TerminalAlignment
  /** True only after login was verified (prompt host matched / confirmed). */
  ready: boolean
  lastError?: string
  /** Recovery brakes: per-drift-event attempt budget. */
  recovery?: RecoveryBudget
}

export const RECOVERY_WINDOW_MS = 60_000
export const RECOVERY_MAX_ATTEMPTS = 2
/** Cap learned hop hosts so long cluster sessions cannot grow aliases unboundedly. */
export const MAX_HOST_ALIASES = 48

/** Minimal state shape for recovery-brake decisions (ConnectionState satisfies). */
export interface RecoveryStateLike {
  alignment: TerminalAlignment
  ready: boolean
  expectedHost?: string
  aliases: string[]
  recovery?: RecoveryBudget
}

export function createConnectionState(mode: TerminalMode = 'none'): ConnectionState {
  return {
    mode,
    aliases: [],
    alignment: 'unknown',
    ready: false
  }
}

/** Set (or clear) the expected host; any change invalidates ready/alignment. */
export function setConnectionExpectedHost(
  state: ConnectionState,
  host: string | null | undefined
): ConnectionState {
  const expected = normalizeHostToken(host ?? '')
  if (!expected) {
    return {
      ...state,
      expectedHost: undefined,
      runtimeExpectedHost: undefined,
      jumpPromptHost: undefined,
      alignment: 'unknown',
      ready: false,
      lastError: undefined
    }
  }
  return {
    ...state,
    expectedHost: expected,
    runtimeExpectedHost: undefined,
    jumpPromptHost: undefined,
    alignment: 'unknown',
    ready: false,
    lastError: undefined
  }
}

/** True when observed host is considered on-target (expected or learned alias). */
export function isHostOnTarget(
  observedHost: string | undefined,
  aliases: string[],
  expectedHost?: string
): boolean {
  const observed = normalizeHostToken(observedHost ?? '')
  if (!observed) return false
  if (expectedHost && isPromptHostAligned(observed, expectedHost)) return true
  return aliases.some((alias) => isPromptHostAligned(observed, alias))
}

/** True when this session previously proved alignment with a hostname prompt. */
export function wasVerifiedOnTarget(state: ConnectionState): boolean {
  return Boolean(
    state.ready &&
    state.promptHost &&
    isHostOnTarget(state.promptHost, state.aliases, state.expectedHost)
  )
}

/**
 * Gate verdict for a buffer given the current SSOT. A hostless prompt is only
 * treated as drift when the session was previously verified with a hostname
 * prompt (exit-to-local); unverified hostless prompts stay unknown.
 * Falling back to the jump box after a deeper runtime anchor is always drift.
 */
export function resolveGateAlignment(state: ConnectionState, output: string): TerminalAlignment {
  const resolved = resolveSessionAlignment({
    output,
    expectedHost: runtimeAnchorHost(state) ?? state.expectedHost,
    aliases: state.aliases
  })
  if (resolved.promptHost === 'local-shell' && !wasVerifiedOnTarget(state)) return 'unknown'
  if (resolved.promptHost && isReturnToJumpHost(state, resolved.promptHost)) return 'drifted'
  return resolved.alignment
}

/**
 * True when the session had a deeper runtime target and the live prompt is
 * back on the configured jump box (IP expectedHost and/or jumpPromptHost).
 */
export function isReturnToJumpHost(
  state: ConnectionState,
  observedHost: string | undefined
): boolean {
  const observed = normalizeHostToken(observedHost ?? '')
  const runtime = runtimeAnchorHost(state)
  if (!observed || observed === 'local-shell' || !runtime) return false
  if (isPromptHostAligned(observed, runtime)) return false

  const jump = normalizeHostToken(state.expectedHost ?? '')
  const jumpPrompt = normalizeHostToken(state.jumpPromptHost ?? '')
  if (jump && isPromptHostAligned(runtime, jump)) return false
  if (jumpPrompt && isPromptHostAligned(runtime, jumpPrompt)) return false

  if (jump && isPromptHostAligned(observed, jump)) return true
  if (jumpPrompt && isPromptHostAligned(observed, jumpPrompt)) return true
  return false
}

export interface InjectionGuardVerdict {
  /** Effective expected host used for comparison (runtime anchor first). */
  effectiveExpectedHost?: string
  observedHost?: string
  alignment: TerminalAlignment
  /** True when the guard should re-anchor the runtime host to observed. */
  shouldReanchor: boolean
}

/**
 * Pure decision core of the command-injection environment guard. The main
 * process calls this with the current session state + terminal buffer; tests
 * exercise the exact same path. A verdict of `aligned` allows injection,
 * `drifted` blocks it (and shouldReanchor tells the caller to heal a stale
 * runtime anchor only when it is safe).
 */
export function evaluateInjectionGuard(
  state: ConnectionState,
  output: string,
  options: { localHost?: string } = {}
): InjectionGuardVerdict {
  const effectiveExpectedHost = runtimeAnchorHost(state) ?? state.expectedHost
  if (!effectiveExpectedHost) {
    return { alignment: 'unknown', shouldReanchor: false }
  }

  const resolved = resolveSessionAlignment({
    output,
    expectedHost: effectiveExpectedHost,
    aliases: state.aliases
  })
  const effectiveAlignment = resolveGateAlignment(state, output)
  const observedHost = effectiveAlignment === 'drifted' ? resolved.promptHost : undefined
  if (!observedHost) {
    return {
      effectiveExpectedHost,
      alignment: effectiveAlignment,
      shouldReanchor: false
    }
  }

  // Auto-learn on an unverified session: the first non-local prompt observed
  // is treated as the target (covers password/manual logins where confirm-login
  // had no prompt host yet). A local prompt is never learned.
  const autoLearned = autoLearnUnverifiedLogin(state, observedHost, {
    localHost: options.localHost ?? ''
  })
  if (autoLearned) {
    return {
      effectiveExpectedHost,
      observedHost,
      alignment: 'aligned',
      shouldReanchor: true
    }
  }

  // Multi-hop login: before a runtime anchor exists, a non-local, non-localhost
  // prompt is the legitimate login destination (e.g. web1.zhangke after
  // `ssh web1.zhangke`).
  if (
    !runtimeAnchorHost(state) &&
    observedHost !== 'local-shell' &&
    !isPromptHostAligned(observedHost, options.localHost ?? '')
  ) {
    return {
      effectiveExpectedHost,
      observedHost,
      alignment: 'aligned',
      shouldReanchor: true
    }
  }

  // Fell back to the jump box after a deeper runtime target — block + recover.
  if (isReturnToJumpHost(state, observedHost)) {
    return {
      effectiveExpectedHost,
      observedHost,
      alignment: 'drifted',
      shouldReanchor: false
    }
  }

  // Peer remote hop (cluster node ↔ node): re-anchor instead of blocking.
  // Treating every peer hop as drift caused environment-drift recovery loops
  // and OOM. Jump-box return is handled above; exit-to-local still drifts below.
  if (
    runtimeAnchorHost(state) &&
    observedHost !== 'local-shell' &&
    !isPromptHostAligned(observedHost, options.localHost ?? '')
  ) {
    return {
      effectiveExpectedHost,
      observedHost,
      alignment: 'aligned',
      shouldReanchor: true
    }
  }

  return {
    effectiveExpectedHost,
    observedHost,
    alignment: 'drifted',
    shouldReanchor: false
  }
}

/** Learn an observed prompt host as an alias (idempotent). */
export function learnHostAlias(state: ConnectionState, observedHost: string): ConnectionState {
  const normalized = normalizeHostToken(observedHost)
  if (!normalized) return state
  if (state.aliases.some((alias) => isPromptHostAligned(normalized, alias))) return state
  const aliases = [...state.aliases, normalized]
  return {
    ...state,
    aliases: aliases.length > MAX_HOST_ALIASES ? aliases.slice(-MAX_HOST_ALIASES) : aliases
  }
}

/** Latest prompt host in a PTY buffer, normalized. */
export function resolvePromptHost(output: string): string | undefined {
  const signal = findNewestPromptSignal(output)
  if (!signal || signal.kind !== 'host') return undefined
  return signal.host
}

/**
 * Authoritative alignment for a buffer given expected host + learned aliases.
 * - observed host on target  -> aligned
 * - observed host elsewhere   -> drifted
 * - local prompt (no host)    -> drifted (remote session closed)
 * - no signal                 -> unknown
 */
export function resolveSessionAlignment(input: {
  output: string
  expectedHost?: string
  aliases: string[]
}): { alignment: TerminalAlignment; promptHost?: string } {
  const expected = normalizeHostToken(input.expectedHost ?? '')
  if (!expected) return { alignment: 'unknown' }

  const signal = findNewestPromptSignal(input.output)
  if (signal?.kind === 'waiting') {
    // Terminal is waiting for a password/verification input: no alignment
    // verdict until the interactive prompt is answered.
    return { alignment: 'unknown' }
  }
  if (signal?.kind === 'local') {
    return { alignment: 'drifted', promptHost: 'local-shell' }
  }
  if (signal?.kind === 'host') {
    if (isHostOnTarget(signal.host, input.aliases, expected)) {
      return { alignment: 'aligned', promptHost: signal.host }
    }
    return { alignment: 'drifted', promptHost: signal.host }
  }
  // No prompt signal matched: keep the legacy heuristic for local prompts that
  // fall outside the strict patterns above.
  if (isLocalShellPromptVisible(input.output)) {
    return { alignment: 'drifted', promptHost: 'local-shell' }
  }
  return { alignment: 'unknown' }
}

/** Re-evaluate state from a fresh buffer observation (no learning here). */
export function observeConnectionState(state: ConnectionState, output: string): ConnectionState {
  const resolved = resolveSessionAlignment({
    output,
    expectedHost: state.expectedHost,
    aliases: state.aliases
  })
  const promptHost = resolved.promptHost ?? state.promptHost
  const ready =
    resolved.alignment === 'aligned' ? true : resolved.alignment === 'drifted' ? false : state.ready
  return {
    ...state,
    promptHost,
    alignment: resolved.alignment,
    ready
  }
}

/**
 * Confirm a successful login: learn the observed prompt host as an alias and
 * mark ready. A prompt that still shows the LOCAL machine means the SSH session
 * never established, so confirmation fails and nothing is learned.
 */
export function confirmLoginState(
  state: ConnectionState,
  observedHost: string | undefined,
  options: { localHost?: string } = {}
): { state: ConnectionState; ok: boolean; learned: boolean } {
  const observed = normalizeHostToken(observedHost ?? '')
  if (observed === 'local-shell') {
    // A visible local prompt after login means the remote shell never took over
    // (or exited); confirmation fails and nothing is learned.
    return {
      state: {
        ...state,
        promptHost: 'local-shell',
        runtimeExpectedHost: undefined,
        alignment: 'drifted',
        ready: false
      },
      ok: false,
      learned: false
    }
  }
  if (!observed) {
    // No positive prompt evidence: keep the session usable but unverified
    // (a remote session never sets ready until a host prompt proves alignment).
    return {
      state: {
        ...state,
        runtimeExpectedHost: undefined,
        alignment: state.expectedHost ? 'unknown' : state.alignment,
        ready: state.expectedHost ? false : true
      },
      ok: true,
      learned: false
    }
  }

  const local = normalizeHostToken(options.localHost ?? '')
  if (local && isPromptHostAligned(observed, local)) {
    return {
      state: {
        ...state,
        promptHost: observed,
        runtimeExpectedHost: undefined,
        alignment: 'drifted',
        ready: false,
        lastError: `SSH did not reach the target (observed local host ${observed}).`
      },
      ok: false,
      learned: false
    }
  }

  const learnedState = learnHostAlias(state, observed)
  return {
    state: {
      ...learnedState,
      promptHost: observed,
      runtimeExpectedHost: observed,
      alignment: 'aligned',
      ready: true,
      lastError: undefined
    },
    ok: true,
    learned: learnedState.aliases.length !== state.aliases.length
  }
}

/**
 * Auto-learn for unverified logins: the first non-local prompt observed after
 * an expected host was set is treated as the target (covers password/manual
 * logins where confirm-login had no prompt host yet). Returns undefined when
 * the observed host is the local machine (failed ssh), the session is already
 * verified (`ready`), or a runtime anchor already exists (verified-then-drifted
 * — re-learning would thrash EnvGuard across hop hosts and blow memory).
 */
export function autoLearnUnverifiedLogin(
  state: ConnectionState,
  observedHost: string | undefined,
  options: { localHost?: string } = {}
): ConnectionState | undefined {
  const observed = normalizeHostToken(observedHost ?? '')
  if (!observed || observed === 'local-shell' || state.ready) return undefined
  // Once a runtime anchor exists the session was verified; EnvGuard may set
  // ready=false on hop/drift — never auto-heal that into a new anchor.
  if (runtimeAnchorHost(state)) return undefined
  const local = normalizeHostToken(options.localHost ?? '')
  if (local && isPromptHostAligned(observed, local)) return undefined
  const learned = learnHostAlias(state, observed)
  return {
    ...learned,
    promptHost: observed,
    runtimeExpectedHost: observed,
    alignment: 'aligned',
    ready: true,
    lastError: undefined
  }
}

/**
 * Promote a subterminal's verified login to its parent tab: merge learned
 * aliases and mark the parent aligned/ready (subterminal ssh result write-back).
 */
export function promoteSubterminalLogin(
  parent: ConnectionState,
  source: ConnectionState
): ConnectionState {
  return {
    ...parent,
    aliases: [...new Set([...parent.aliases, ...source.aliases])],
    promptHost: source.promptHost ?? parent.promptHost,
    runtimeExpectedHost:
      source.runtimeExpectedHost ?? source.promptHost ?? parent.runtimeExpectedHost,
    jumpPromptHost: source.jumpPromptHost ?? parent.jumpPromptHost,
    alignment: 'aligned',
    ready: true,
    lastError: undefined
  }
}

/** Recovery brake: decide whether a recovery attempt may start. */
export function shouldAttemptRecovery(
  state: RecoveryStateLike,
  driftKey: string | undefined,
  now = Date.now()
): { allowed: boolean; reason: 'ok' | 'aligned' | 'same-drift' | 'rate-limited' } {
  if (state.alignment === 'aligned' && state.ready) return { allowed: false, reason: 'aligned' }

  const budget = state.recovery
  if (!budget) return { allowed: true, reason: 'ok' }

  if (driftKey && budget.driftKey && budget.driftKey !== driftKey) {
    return { allowed: true, reason: 'ok' }
  }
  if (driftKey && budget.driftKey && budget.driftKey === driftKey && budget.attempts >= 1) {
    return { allowed: false, reason: 'same-drift' }
  }

  const windowElapsed = now - budget.windowStartAt >= RECOVERY_WINDOW_MS
  const attempts = windowElapsed ? 0 : budget.attempts
  if (attempts >= RECOVERY_MAX_ATTEMPTS) return { allowed: false, reason: 'rate-limited' }
  return { allowed: true, reason: 'ok' }
}

/** Record a recovery attempt (same drift key: at most 1; window: max N). */
export function recordRecoveryAttempt<S extends RecoveryStateLike>(
  state: S,
  driftKey: string | undefined,
  now = Date.now()
): S {
  const budget = state.recovery
  const windowElapsed = budget ? now - budget.windowStartAt >= RECOVERY_WINDOW_MS : true
  // No drift key: keep accumulating in the current window. With a key: only the
  // same key shares the budget (a new drift event resets the same-key gate).
  const sameKey = !driftKey ? true : budget?.driftKey === driftKey
  const next: RecoveryBudget = {
    driftKey: driftKey ?? budget?.driftKey,
    attempts: windowElapsed || !sameKey ? 1 : (budget?.attempts ?? 0) + 1,
    windowStartAt: windowElapsed ? now : (budget?.windowStartAt ?? now)
  }
  return { ...state, recovery: next }
}

export function resetRecoveryBudget<S extends RecoveryStateLike>(state: S): S {
  return state.recovery ? { ...state, recovery: undefined } : state
}

/** PIPE feasibility classification for one command line. */
export type PipeCommandKind = 'interactive' | 'one-shot' | 'other'

/**
 * Interactive commands (ssh remote shell, sudo password prompt, su, passwd,
 * mysql/psql REPL, sftp) require a PTY. One-shot non-interactive ssh (BatchMode
 * or a remote command without -t) runs fine in PIPE fallback.
 */
export function classifyPipeCommand(command: string): PipeCommandKind {
  const trimmed = command.trim()
  if (!trimmed) return 'other'

  if (/^sudo\s*(?:$|-i\b|-s\b|su\b)/.test(trimmed)) return 'interactive'

  const tool = trimmed.match(/^(ssh|sftp|scp|su\b|passwd\b|mysql\b|psql\b)/)?.[1]
  if (!tool) return 'other'

  const hasBatchMode = /\bBatchMode\b/i.test(trimmed) || /\s-batchmode\b/i.test(trimmed)
  if (tool === 'sftp') return hasBatchMode ? 'one-shot' : 'interactive'
  if (tool === 'scp') return hasBatchMode ? 'one-shot' : 'interactive'
  if (tool !== 'ssh') return 'interactive'

  if (hasBatchMode) return 'one-shot'
  if (/(^|\s)-t{1,3}(\s|$)/.test(trimmed)) return 'interactive'
  if (sshHasRemoteCommand(trimmed)) return 'one-shot'
  return 'interactive'
}

function sshHasRemoteCommand(command: string): boolean {
  const body = command.trim().replace(/^ssh\s+/, '')
  const tokens = body.split(/\s+/).filter(Boolean)
  const rest: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.startsWith('-')) {
      // Option with a value: -p 22 / -l user / -i file / -o BatchMode=yes
      if (
        /^-(p|P|i|l|o|E|F|J|W|b|c|m|e|g|G|I|L|M|N|O|Q|R|S|T|V|v|w|X|x|Y|y|B|K|k|s|t)$/.test(
          token
        ) &&
        tokens[index + 1] &&
        !tokens[index + 1].startsWith('-')
      ) {
        index += 1
      }
      continue
    }
    rest.push(token)
  }

  // host + at least one command token -> one-shot; host only -> remote shell.
  return rest.length >= 2
}

/** Why a run was stopped; only a real user stop renders the "manually stopped" copy. */
export type RunStopReason = 'user' | 'system-recovery' | 'gate-interrupt' | 'timeout'

/**
 * Decide the settle reason from the stop context. Real user stop wins only when
 * the user explicitly stopped; recovery/drift/timeout stops are system settle.
 */
export function resolveRunStopReason(input: {
  userInitiated: boolean
  driftBlocked?: boolean
  recoveryInFlight?: boolean
  timedOut?: boolean
}): RunStopReason {
  if (input.userInitiated) return 'user'
  if (input.driftBlocked) return 'gate-interrupt'
  if (input.recoveryInFlight) return 'system-recovery'
  if (input.timedOut) return 'timeout'
  return 'system-recovery'
}

/** Append a system/status step to a run timeline (ordered; dedupe consecutive). */
export interface StatusStepLike {
  id: string
  kind?: string
  title?: string
  detail?: string
  seq?: number
}

export function appendRunStatusStep(
  steps: StatusStepLike[],
  input: { id: string; title: string; detail?: string; seq?: number }
): StatusStepLike[] {
  const last = steps[steps.length - 1]
  if (last && last.kind === 'status' && last.title === input.title) return steps
  const seq = input.seq ?? steps.length
  return [...steps, { ...input, kind: 'status', seq }]
}

/** Stable monotonic timeline sort: by seq, then original order. */
export function sortTimelineBySeq<T extends { seq?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      seq: typeof item.seq === 'number' ? item.seq : Number.MAX_SAFE_INTEGER
    }))
    .sort((left, right) => left.seq - right.seq || left.index - right.index)
    .map((entry) => entry.item)
}
