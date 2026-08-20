import { isPasswordPromptLine } from '../../../shared/terminal-password-prompt'
import { findNewestPromptSignal, type PromptSignal } from '../../../shared/terminal-prompt-host'

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

export function extractNewestWaitingLine(output: string): string | undefined {
  if (findNewestPromptSignal(output)?.kind !== 'waiting') return undefined
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index]?.trim() ?? ''
    if (!trimmed) continue
    if (isPasswordPromptLine(trimmed) || HOST_KEY_PROMPT.test(trimmed)) return trimmed
  }
  return undefined
}

export function resolveLoginTypeReady(
  output: string
): Exclude<LoginTypeReady, { kind: 'timeout' }> | undefined {
  const signal = findNewestPromptSignal(output)
  if (signal?.kind === 'waiting') {
    return { kind: 'waiting', line: extractNewestWaitingLine(output) ?? '' }
  }
  if (signal?.kind === 'host') return { kind: 'host', host: signal.host }
  return undefined
}

export function resolveLoginActionConsumed(
  output: string,
  options: {
    mode: 'waiting' | 'shell'
    waitingLine?: string
    outputAtType?: string
  }
): Exclude<LoginStepConsumed, { kind: 'timeout' }> | undefined {
  if (options.mode === 'shell') {
    const snapshot = options.outputAtType ?? ''
    if (output.length <= snapshot.length) return undefined
    const suffix = output.slice(snapshot.length)
    const signal = findNewestPromptSignal(suffix)
    if (signal?.kind === 'waiting') {
      return { kind: 'waiting', line: extractNewestWaitingLine(suffix) ?? '' }
    }
    return signalToConsumed(signal)
  }

  const signal = findNewestPromptSignal(output)
  if (signal?.kind === 'waiting') {
    const line = extractNewestWaitingLine(output) ?? ''
    if (options.waitingLine && line === options.waitingLine) return undefined
    if (!line) return undefined
    return { kind: 'waiting', line }
  }
  return signalToConsumed(signal)
}

function signalToConsumed(
  signal: PromptSignal | undefined
): Exclude<LoginStepConsumed, { kind: 'timeout' }> | undefined {
  if (signal?.kind === 'host') return { kind: 'host', host: signal.host }
  if (signal?.kind === 'local') return { kind: 'local' }
  return undefined
}

export function waitForLoginTypeReady(
  deps: LoginActionWaitDeps,
  options: { tabId: string; timeoutMs?: number; pollMs?: number; dataDebounceMs?: number }
): Promise<LoginTypeReady> {
  return watchOutput(deps, options, resolveLoginTypeReady)
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
