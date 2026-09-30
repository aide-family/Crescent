import {
  resolveSessionAlignment,
  runtimeAnchorHost,
  type ConnectionState
} from '../../shared/connection-state'
import { hasLikelyShellPrompt } from './command-interrupt'

/** A timeout alone does not prove SSH was lost. Require a fresh target prompt. */
export function recoverTimedOutSshSession(
  state: ConnectionState,
  freshOutput: string,
  localHost?: string
): ConnectionState | undefined {
  if (state.connectionFault !== 'degraded' || !state.expectedHost) return undefined
  // An echoed command can contain user@host; only a completed shell prompt
  // after the timeout is proof that the interactive shell is usable again.
  // eslint-disable-next-line no-control-regex
  if (!hasLikelyShellPrompt(freshOutput.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, ''))) return undefined

  const observed = resolveSessionAlignment({
    output: freshOutput,
    expectedHost: runtimeAnchorHost(state) ?? state.expectedHost,
    aliases: state.aliases,
    clusterHostRegex: state.clusterHostRegex,
    localHost
  })
  if (observed.alignment !== 'aligned' || !observed.promptHost) return undefined

  return {
    ...state,
    promptHost: observed.promptHost,
    alignment: 'aligned',
    ready: true,
    connectionFault: undefined,
    lastError: undefined
  }
}
