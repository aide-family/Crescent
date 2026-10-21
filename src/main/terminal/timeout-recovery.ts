import {
  resolveSessionAlignment,
  runtimeAnchorHost,
  type ConnectionState
} from '../../shared/connection-state'
import { TerminalExecutionState } from './execution-state'

/** A timeout alone does not prove SSH was lost. Require a fresh target prompt. */
export function recoverTimedOutSshSession(
  state: ConnectionState,
  freshOutput: string,
  localHost?: string
): ConnectionState | undefined {
  if (state.connectionFault !== 'degraded' || !state.expectedHost) return undefined
  const activity = new TerminalExecutionState()
  const evidence = activity.consume(freshOutput)
  if (!evidence.shellReady || activity.alternateScreen) return undefined

  const observed = resolveSessionAlignment({
    output: activity.promptText,
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
