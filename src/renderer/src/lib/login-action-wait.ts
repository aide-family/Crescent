import { isPasswordPromptLine } from '../../../shared/terminal-password-prompt'
import {
  extractRecentPromptHosts,
  findNewestPromptSignal
} from '../../../shared/terminal-prompt-host'

export const LOGIN_TYPE_READY_TIMEOUT_MS = 60_000
export const LOGIN_ACTION_CONSUMED_TIMEOUT_MS = 30_000
export const LOGIN_ACTION_WAIT_POLL_MS = 200
export const LOGIN_ACTION_DATA_DEBOUNCE_MS = 80

export interface LoginActionWaitDeps {
  getContext: () => Promise<{ output?: string; promptHost?: string }>
  onData: (handler: (event: { tabId: string }) => void) => () => void
  setInterval: (fn: () => void, ms: number) => number
  clearInterval: (id: number) => void
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}

export type LoginTypeReady =
  | { kind: 'waiting'; line: string }
  | { kind: 'host'; host: string }
  | { kind: 'timeout' }

export type LoginStepConsumed =
  | { kind: 'waiting'; line: string }
  | { kind: 'host'; host: string }
  | { kind: 'local' }
  | { kind: 'timeout' }

const HOST_KEY_PROMPT = /(?:yes\/no|continue connecting)\s*[:?]?\s*$/i

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}

function looksLikeHostPromptLine(line: string): boolean {
  return (
    /[@].*[:#$]/.test(line) || /\[[\w.-]+@[\w.-]+/.test(line) || /[\w.-]+@[\w.-]+\s*[#$]/.test(line)
  )
}

/**
 * Remote host prompt with no trailing command echo.
 * `user@node-1:~$ ` is clean; `user@node-1:~$ sudo su - root` is not.
 * ANSI color wraps around root prompts must be stripped first.
 */
export function isCleanHostPromptLine(line: string): boolean {
  const trimmed = stripAnsi(line).trim()
  // Allow `[K8S-RONLY | user@host:~# ]` — prompt char may sit before a closing bracket.
  if (!/[$%#]\s*\]?\s*$/.test(trimmed)) return false
  return looksLikeHostPromptLine(trimmed)
}

export type SkipSecretOnHostInput = {
  readyKind: Exclude<LoginTypeReady['kind'], 'timeout'>
  /** Auto-prepended connection password (key-auth may already be on a host). */
  isLeadingAutoPassword: boolean
  /** Previous typed action was a shell command (e.g. sudo). */
  previousWasCommand: boolean
  /** How the previous typed action settled. */
  previousConsumedKind?: Exclude<LoginStepConsumed['kind'], 'timeout'>
}

/**
 * Skip an unused secret when a clean host prompt is already visible.
 *
 * - Leading auto SSH password: key auth already landed.
 * - After a command settled on host: NOPASSWD / no password prompt (e.g. sudo).
 * - After a prior unused-secret skip on host: keep skipping consecutive secrets
 *   (callers must leave `previousWasCommand` true / `previousConsumedKind` host).
 * Never skip solely because index > 0 and host is visible — that drops real
 * follow-up commands misclassified as secrets, and silent-skips before confirm.
 */
export function shouldSkipSecretOnHost(input: SkipSecretOnHostInput): boolean {
  if (input.readyKind !== 'host') return false
  if (input.isLeadingAutoPassword) return true
  return input.previousWasCommand && input.previousConsumedKind === 'host'
}

export function extractNewestWaitingLine(output: string): string | undefined {
  if (findNewestPromptSignal(output)?.kind !== 'waiting') return undefined
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = stripAnsi(lines[index] ?? '').trim()
    if (!trimmed) continue
    if (isPasswordPromptLine(trimmed) || HOST_KEY_PROMPT.test(trimmed)) return trimmed
  }
  return undefined
}

/** Scan the whole suffix — OP-KUBE / `sw` banners exceed the default 40-line window. */
const LOGIN_PROMPT_SCAN_LINES = 400

/**
 * Newest login-relevant signal, skipping dirty command echoes so a later
 * MOTD/banner cannot hide a clean host prompt — and a huge banner cannot
 * strand the waiter on `[root@jump]# sw xmhc`.
 */
export function resolveNewestLoginSignal(
  output: string
): Exclude<LoginStepConsumed, { kind: 'timeout' }> | undefined {
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const recent = lines.slice(-LOGIN_PROMPT_SCAN_LINES)
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const trimmed = stripAnsi(recent[index] ?? '').trim()
    if (!trimmed) continue
    if (isPasswordPromptLine(trimmed) || HOST_KEY_PROMPT.test(trimmed)) {
      return { kind: 'waiting', line: trimmed }
    }
    if (isCleanHostPromptLine(trimmed)) {
      const signal = findNewestPromptSignal(trimmed)
      if (signal?.kind === 'host') return { kind: 'host', host: signal.host }
    }
    const signal = findNewestPromptSignal(trimmed)
    if (signal?.kind === 'local') return { kind: 'local' }
    if (signal?.kind === 'waiting') {
      return { kind: 'waiting', line: extractNewestWaitingLine(trimmed) ?? trimmed }
    }
  }
  return undefined
}

function lastExtractedHost(output: string): string | undefined {
  const hosts = extractRecentPromptHosts(output, LOGIN_PROMPT_SCAN_LINES)
  return hosts[hosts.length - 1]
}

/** `sw` / SSH landings that print a banner+MOTD and never a parseable PS1. */
function isBannerSettledLanding(output: string): boolean {
  if (findNewestPromptSignal(output, LOGIN_PROMPT_SCAN_LINES)?.kind === 'waiting') return false
  return (
    /✔\s*Switched to context/i.test(output) ||
    />>> 切换到集群/.test(output) ||
    /Authorized only\.\s*All activity will be monitored/i.test(output)
  )
}

function settledHostFromBanner(output: string): { kind: 'host'; host: string } | undefined {
  if (!isBannerSettledLanding(output)) return undefined
  const host = lastExtractedHost(output)
  if (!host) return undefined
  return { kind: 'host', host }
}

export function resolveLoginTypeReady(
  output: string
): Exclude<LoginTypeReady, { kind: 'timeout' }> | undefined {
  const newest = resolveNewestLoginSignal(output)
  if (newest?.kind === 'waiting') {
    return { kind: 'waiting', line: newest.line }
  }
  if (newest?.kind === 'host') return { kind: 'host', host: newest.host }
  return undefined
}

export function resolveLoginActionConsumed(
  output: string,
  options: {
    mode: 'waiting' | 'shell'
    waitingLine?: string
    outputAtType?: string
    /** After the hard timeout: accept banner/MOTD landings that never printed PS1. */
    acceptQuietGrowth?: boolean
  }
): Exclude<LoginStepConsumed, { kind: 'timeout' }> | undefined {
  if (options.mode === 'shell') {
    const snapshot = options.outputAtType ?? ''
    if (output.length <= snapshot.length) return undefined
    const suffix = output.slice(snapshot.length)
    const newest = resolveNewestLoginSignal(suffix)
    if (newest?.kind === 'waiting') {
      return { kind: 'waiting', line: newest.line }
    }
    if (newest) return newest
    if (isBannerSettledLanding(suffix)) {
      const host = lastExtractedHost(suffix) ?? lastExtractedHost(output)
      if (host) return { kind: 'host', host }
    }
    if (options.acceptQuietGrowth) {
      if (findNewestPromptSignal(suffix, LOGIN_PROMPT_SCAN_LINES)?.kind === 'waiting') {
        return undefined
      }
      const host = lastExtractedHost(suffix) ?? lastExtractedHost(output)
      if (host) return { kind: 'host', host }
    }
    return undefined
  }

  const newest = resolveNewestLoginSignal(output)
  if (newest?.kind === 'waiting') {
    const line = newest.line
    if (options.waitingLine && line === options.waitingLine) return undefined
    if (!line) return undefined
    return { kind: 'waiting', line }
  }
  if (newest) return newest
  return settledHostFromBanner(output)
}

export function waitForLoginTypeReady(
  deps: LoginActionWaitDeps,
  options: {
    tabId: string
    timeoutMs?: number
    pollMs?: number
    dataDebounceMs?: number
    /** Settle only on password / host-key prompts. */
    requireWaiting?: boolean
  }
): Promise<LoginTypeReady> {
  return watchOutput(deps, options, (output) => {
    const ready = resolveLoginTypeReady(output)
    if (!ready) return undefined
    if (options.requireWaiting && ready.kind !== 'waiting') return undefined
    return ready
  })
}

export function waitForLoginActionConsumed(
  deps: LoginActionWaitDeps,
  options: {
    tabId: string
    mode: 'waiting' | 'shell'
    waitingLine?: string
    outputAtType?: string
    timeoutMs?: number
    pollMs?: number
    dataDebounceMs?: number
  }
): Promise<LoginStepConsumed> {
  return watchOutput(
    deps,
    {
      tabId: options.tabId,
      timeoutMs: options.timeoutMs ?? LOGIN_ACTION_CONSUMED_TIMEOUT_MS,
      pollMs: options.pollMs,
      dataDebounceMs: options.dataDebounceMs
    },
    (output) =>
      resolveLoginActionConsumed(output, {
        mode: options.mode,
        waitingLine: options.waitingLine,
        outputAtType: options.outputAtType
      })
  )
}

function watchOutput<T extends { kind: string }>(
  deps: LoginActionWaitDeps,
  options: { tabId: string; timeoutMs?: number; pollMs?: number; dataDebounceMs?: number },
  decide: (output: string) => T | undefined
): Promise<T | { kind: 'timeout' }> {
  const timeoutMs = options.timeoutMs ?? LOGIN_TYPE_READY_TIMEOUT_MS
  const pollMs = options.pollMs ?? LOGIN_ACTION_WAIT_POLL_MS
  const dataDebounceMs = options.dataDebounceMs ?? LOGIN_ACTION_DATA_DEBOUNCE_MS

  return new Promise((resolve) => {
    let settled = false
    let dataCheckTimer: number | undefined

    const settle = (value: T | { kind: 'timeout' }): void => {
      if (settled) return
      settled = true
      deps.clearInterval(poll)
      deps.clearTimeout(timeout)
      if (dataCheckTimer) deps.clearTimeout(dataCheckTimer)
      unsubscribe()
      resolve(value)
    }

    const check = (): void => {
      void deps.getContext().then((context) => {
        if (settled) return
        const decided = decide(context.output ?? '')
        if (decided) settle(decided)
      })
    }

    const unsubscribe = deps.onData((event) => {
      if (event.tabId !== options.tabId) return
      if (dataCheckTimer) deps.clearTimeout(dataCheckTimer)
      dataCheckTimer = deps.setTimeout(check, dataDebounceMs)
    })

    const poll = deps.setInterval(check, pollMs)
    const timeout = deps.setTimeout(() => settle({ kind: 'timeout' }), timeoutMs)
    check()
  })
}
