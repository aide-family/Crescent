import {
  isReturnToJumpHost,
  resolveSessionAlignment,
  runtimeAnchorHost,
  type ConnectionState
} from '../../shared/connection-state'
import { hasLikelyShellPrompt } from './command-interrupt'

/**
 * A sticky `lost` or `degraded` fault does not outrank a live on-target prompt.
 * Command echoes that merely contain `user@host` are not a prompt; the newest
 * line must look like a shell prompt and align with the expected host.
 * A local shell, a jump-box fallback, or no prompt leaves the fault in place.
 */
export function recoverSshSessionOnTargetPrompt(
  state: ConnectionState,
  output: string,
  localHost?: string
): ConnectionState | undefined {
  if (!state.expectedHost) return undefined
  if (state.connectionFault !== 'lost' && state.connectionFault !== 'degraded') return undefined
  // eslint-disable-next-line no-control-regex
  if (!hasLikelyShellPrompt(output.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, ''))) return undefined

  const observed = resolveSessionAlignment({
    output,
    expectedHost: runtimeAnchorHost(state) ?? state.expectedHost,
    aliases: state.aliases,
    clusterHostRegex: state.clusterHostRegex,
    localHost
  })
  if (observed.alignment !== 'aligned' || !observed.promptHost) return undefined
  if (observed.promptHost === 'local-shell') return undefined
  if (isReturnToJumpHost(state, observed.promptHost)) return undefined

  return {
    ...state,
    promptHost: observed.promptHost,
    alignment: 'aligned',
    ready: true,
    connectionFault: undefined,
    lastError: undefined
  }
}

/** A timeout alone does not prove SSH was lost. Require a fresh target prompt. */
export function recoverTimedOutSshSession(
  state: ConnectionState,
  freshOutput: string,
  localHost?: string
): ConnectionState | undefined {
  if (state.connectionFault !== 'degraded') return undefined
  return recoverSshSessionOnTargetPrompt(state, freshOutput, localHost)
}
