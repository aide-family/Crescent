import {
  findNewestPromptSignal,
  isPromptHostAligned,
  normalizeHostToken
} from '../../../shared/terminal-prompt-host'

export interface PromptWaitDeps {
  getContext: () => Promise<{ promptHost?: string; output?: string }>
  onData: (handler: (event: { tabId: string }) => void) => () => void
  setInterval: (fn: () => void, ms: number) => number
  clearInterval: (id: number) => void
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  now: () => number
}

export type PromptWaitSignal = 'host' | 'local' | 'none'

export function waitForRemotePrompt(
  deps: PromptWaitDeps,
  options: {
    tabId: string
    timeoutMs?: number
    pollMs?: number
    dataDebounceMs?: number
    expectedHost?: string
    aliases?: string[]
    localHost?: string
    acceptAnyRemoteHost?: boolean
    previousHost?: string
  }
): Promise<PromptWaitSignal> {
  const { tabId } = options
  const timeoutMs = options.timeoutMs ?? 20_000
  const pollMs = options.pollMs ?? 200
  const dataDebounceMs = options.dataDebounceMs ?? 80
  const expectedHost = options.expectedHost?.trim() || undefined
  const previousHost = options.previousHost?.trim() || undefined

  return new Promise((resolve) => {
    let lastSignal: PromptWaitSignal = 'none'
    let seenTransitionalHost = false
    let settled = false
    let dataCheckTimer: number | undefined

    const settle = (signal: PromptWaitSignal): void => {
      if (settled) return
      settled = true
      deps.clearInterval(poll)
      deps.clearTimeout(timeout)
      if (dataCheckTimer) deps.clearTimeout(dataCheckTimer)
      unsubscribe()
      resolve(signal)
    }

    const check = (): void => {
      void deps.getContext().then((context) => {
        if (settled) return
        const signal = context.output != null ? findNewestPromptSignal(context.output) : undefined
        const promptHost =
          signal?.kind === 'host'
            ? signal.host
            : signal?.kind === 'local'
              ? 'local-shell'
              : signal?.kind === 'waiting'
                ? undefined
                : context.promptHost
        if (promptHost && promptHost !== 'local-shell') {
          if (
            isLoginPromptReady(promptHost, {
              expectedHost,
              aliases: options.aliases,
              localHost: options.localHost,
              acceptAnyRemoteHost: options.acceptAnyRemoteHost,
              previousHost
            })
          ) {
            settle('host')
            return
          }
          // Intermediate jump-host prompt: keep waiting for the real target.
          seenTransitionalHost = true
          lastSignal = 'none'
          return
        }
        if (promptHost === 'local-shell') lastSignal = 'local'
      })
    }

    const unsubscribe = deps.onData((event) => {
      if (event.tabId !== tabId) return
      if (dataCheckTimer) deps.clearTimeout(dataCheckTimer)
      dataCheckTimer = deps.setTimeout(check, dataDebounceMs)
    })

    const poll = deps.setInterval(check, pollMs)
    const timeout = deps.setTimeout(
      () => settle(seenTransitionalHost ? 'none' : lastSignal),
      timeoutMs
    )
    check()
  })
}

/** Strip `user@` from an ssh target (`user@192.0.2.10` → `192.0.2.10`). */
export function stripSshTarget(value: string): string {
  const trimmed = value.trim()
  const at = trimmed.lastIndexOf('@')
  if (at > 0 && at < trimmed.length - 1) return trimmed.slice(at + 1)
  return trimmed
}

export function isIpv4Literal(value: string): boolean {
  const host = stripSshTarget(value)
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
}

/**
 * True when a remote prompt is enough to treat login as ready:
 * FQDN/alias match, or IP expected vs hostname observed (learn alias next).
 */
export function isLoginPromptReady(
  promptHost: string,
  options: {
    expectedHost?: string
    aliases?: string[]
    localHost?: string
    acceptAnyRemoteHost?: boolean
    previousHost?: string
  } = {}
): boolean {
  const observed = normalizeHostToken(stripSshTarget(promptHost))
  if (!observed || observed === 'local-shell') return false

  const local = normalizeHostToken(stripSshTarget(options.localHost ?? ''))
  if (local && isPromptHostAligned(observed, local)) return false

  const previous = normalizeHostToken(stripSshTarget(options.previousHost ?? ''))
  if (previous && isPromptHostAligned(observed, previous)) return false

  if (options.acceptAnyRemoteHost) return true

  const expected = normalizeHostToken(stripSshTarget(options.expectedHost ?? ''))
  if (!expected) return true
  if (isPromptHostAligned(observed, expected)) return true
  if (options.aliases?.some((alias) => isPromptHostAligned(observed, alias))) return true
  if (isIpv4Literal(expected) && !isIpv4Literal(observed)) return true
  return false
}

/** Host alignment for the prompt-wait (short host vs FQDN, exact or suffix). */
export function isHostAligned(observedHost: string, expectedHost: string): boolean {
  return isPromptHostAligned(stripSshTarget(observedHost), stripSshTarget(expectedHost))
}
