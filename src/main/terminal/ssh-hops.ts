import { isIpv4Literal } from '../../shared/ssh-destination'
import type { ConnectionState, SshHop } from '../../shared/connection-state'
import { runtimeAnchorHost } from '../../shared/connection-state'
import {
  isPromptHostAligned,
  isLocalMachinePromptHost,
  type PromptSignal
} from '../../shared/terminal-prompt-host'

/** Keep the configured source/credentials separate from the current shell layer. */
export function beginManualSshHop(state: ConnectionState, host: string): ConnectionState {
  const previousHost = runtimeAnchorHost(state) ?? state.expectedHost ?? state.promptHost
  const sshHops: SshHop[] = state.sshHops?.length
    ? state.sshHops
    : previousHost && state.expectedHost
      ? [{ host: previousHost, source: 'connection', shellLevel: 1 }]
      : []
  return {
    ...state,
    sshHops,
    pendingSshHop: { host, previousHost },
    pendingSshExit: false,
    manualSshActive: true,
    ready: false,
    alignment: 'unknown'
  }
}

/** Called only for a fresh trailing shell prompt, after escape/application filtering. */
export function observeSshHopPrompt(
  state: ConnectionState,
  signal: PromptSignal,
  localHost?: string
): ConnectionState | undefined {
  const hops = state.sshHops ?? []
  if (signal.kind === 'waiting') return undefined
  const host = signal.kind === 'host' ? signal.host : undefined
  if (state.pendingSshHop) {
    const pending = state.pendingSshHop
    // Failed login returned to the caller. Retain its original provenance.
    if (host && pending.previousHost && isPromptHostAligned(host, pending.previousHost))
      return {
        ...state,
        pendingSshHop: undefined,
        manualSshActive: hops.some((h) => h.source === 'manual'),
        ready: true,
        alignment: 'aligned'
      }
    // A hostless prompt cannot attest a new remote destination.
    if (!host || isLocalMachinePromptHost(host, localHost)) return undefined
    if (hops.length >= 48) return undefined
    if (!isPromptHostAligned(host, pending.host) && !isIpv4Literal(pending.host)) return undefined
    const next = [
      ...hops,
      {
        host,
        previousHost: pending.previousHost,
        source: 'manual' as const,
        shellLevel: hops.length + 1
      }
    ]
    return {
      ...state,
      sshHops: next,
      sshHopChain: next.map((h) => h.host),
      pendingSshHop: undefined,
      runtimeExpectedHost: host,
      promptHost: host,
      manualSshActive: true,
      ready: true,
      alignment: 'aligned',
      connectionFault: undefined
    }
  }
  if (state.pendingSshExit && hops.length) {
    const previous = hops.at(-2)
    if (previous && host && isPromptHostAligned(host, previous.host)) {
      const next = hops.slice(0, -1)
      return {
        ...state,
        sshHops: next,
        sshHopChain: next.map((h) => h.host),
        pendingSshExit: false,
        runtimeExpectedHost: previous.host,
        promptHost: host,
        manualSshActive: next.some((h) => h.source === 'manual'),
        ready: true,
        alignment: 'aligned',
        connectionFault: undefined
      }
    }
    if (!previous && !state.expectedHost && signal.kind === 'local')
      return {
        ...state,
        sshHops: [],
        sshHopChain: [],
        pendingSshExit: false,
        manualSshActive: false,
        runtimeExpectedHost: undefined,
        promptHost: undefined,
        ready: true,
        alignment: 'unknown'
      }
  }
  return undefined
}
