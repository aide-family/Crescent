import type { ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent'

import { shouldCancelThresholdCompaction } from '../../shared/session-outline'

export interface CompactionGate {
  agentLoopActive: boolean
  pendingThresholdCompact: boolean
}

export function createCompactionGate(): CompactionGate {
  return {
    agentLoopActive: false,
    pendingThresholdCompact: false
  }
}

/**
 * Cancels Pi threshold compaction while the current agent loop has started and
 * has not settled. Overflow recovery still runs. The host compacts after the turn.
 */
export function createCompactionDeferralExtension(gate: CompactionGate): InlineExtension {
  return {
    name: 'crescent-compaction-deferral',
    hidden: true,
    factory(pi: ExtensionAPI) {
      pi.on('agent_start', () => {
        gate.agentLoopActive = true
      })
      pi.on('agent_settled', () => {
        gate.agentLoopActive = false
      })
      pi.on('session_before_compact', (event) => {
        if (
          !shouldCancelThresholdCompaction({
            agentLoopActive: gate.agentLoopActive,
            reason: event.reason
          })
        ) {
          return undefined
        }
        gate.pendingThresholdCompact = true
        return { cancel: true }
      })
    }
  }
}
