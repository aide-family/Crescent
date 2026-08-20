import { findNewestPromptSignal } from '../../../shared/terminal-prompt-host'
import { isExecutionTerminalReadyForAgent } from './connection-route'
import { hasInteractivePrompt } from './terminal-text'
import type { AgentTerminalTab } from './terminal-tabs'

export const TERMINAL_READY_WAIT_MS = 15_000

export const CLARIFY_MANUAL_CONTINUE_ID = 'manual-continue'
export const CLARIFY_OPEN_CONNECTIONS_ID = 'open-connections'

export type TerminalReadyGateOutcome =
  | { kind: 'ready' }
  | { kind: 'clarify' }
  | { kind: 'fail'; reason: string }

export function isRemoteExecutionTab(
  tab?: Pick<AgentTerminalTab, 'connectionId' | 'isSsh'>
): boolean {
  return Boolean(tab?.isSsh) || Boolean(tab?.connectionId?.trim())
}

/**
 * Decide what to do when the agent execution terminal is not ready after wait.
 * Local (non-SSH) → fail with reason. SSH/connecting → clarification card.
 */
export function resolveTerminalReadyGateOutcome(input: {
  ensureOk: boolean
  ensureError?: string
  tab?: Pick<AgentTerminalTab, 'terminalReady' | 'terminalStartError' | 'connectionId' | 'isSsh'>
  terminalMode?: string
  waitedOk: boolean
  failedToStartShellNotReady: string
}): TerminalReadyGateOutcome {
  const ready =
    input.ensureOk &&
    input.waitedOk &&
    isExecutionTerminalReadyForAgent({
      tab: input.tab,
      terminalMode: input.terminalMode
    })
  if (ready) return { kind: 'ready' }

  const reason =
    input.ensureError?.trim() ||
    input.tab?.terminalStartError?.trim() ||
    input.failedToStartShellNotReady

  if (!isRemoteExecutionTab(input.tab)) {
    return { kind: 'fail', reason }
  }

  return { kind: 'clarify' }
}

export function isTerminalSnapshotReadyForAgent(input: {
  tab?: Pick<AgentTerminalTab, 'terminalReady' | 'connectionId' | 'isSsh'>
  terminalMode?: string
  output?: string
}): boolean {
  if (!isExecutionTerminalReadyForAgent({ tab: input.tab, terminalMode: input.terminalMode })) {
    return false
  }
  if (input.output == null) return true

  const signal = findNewestPromptSignal(input.output)
  if (signal?.kind === 'waiting') return false
  if (isRemoteExecutionTab(input.tab) && signal?.kind === 'host') return true
  if (hasInteractivePrompt(input.output)) return false
  return true
}

export function buildTerminalNotReadyClarifyOptions(input: {
  connections: Array<{ id: string; label: string }>
  manualContinueLabel: string
  openConnectionsLabel: string
}): Array<{ id: string; label: string }> {
  return [
    { id: CLARIFY_MANUAL_CONTINUE_ID, label: input.manualContinueLabel },
    { id: CLARIFY_OPEN_CONNECTIONS_ID, label: input.openConnectionsLabel },
    ...input.connections
  ]
}
