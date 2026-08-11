export interface PromptWaitDeps {
  getContext: () => Promise<{ promptHost?: string }>
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
    /**
     * When set, a host prompt is only accepted once it aligns with this target
     * (e.g. web1.zhangke after a multi-hop `ssh web1.zhangke`). This prevents
     * confirm-login from running on an intermediate jump-host prompt.
     */
    expectedHost?: string
  }
): Promise<PromptWaitSignal> {
  const { tabId } = options
  const timeoutMs = options.timeoutMs ?? 20_000
  const pollMs = options.pollMs ?? 200
  const dataDebounceMs = options.dataDebounceMs ?? 80
  const expectedHost = options.expectedHost?.trim() || undefined

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
        const promptHost = context.promptHost
        if (promptHost && promptHost !== 'local-shell') {
          if (!expectedHost || isHostAligned(promptHost, expectedHost)) {
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
  })
}

/** Host alignment for the prompt-wait (short host vs FQDN, exact or suffix). */
export function isHostAligned(observedHost: string, expectedHost: string): boolean {
  const observed = observedHost.trim().toLowerCase()
  const expected = expectedHost.trim().toLowerCase()
  if (!observed || !expected) return false
  if (observed === expected) return true
  return (
    observed.endsWith(`.${expected}`) ||
    expected.endsWith(`.${observed}`) ||
    observed.startsWith(`${expected}.`) ||
    expected.startsWith(`${observed}.`)
  )
}
