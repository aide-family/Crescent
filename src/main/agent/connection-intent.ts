import {
  explainLocalFileOperationBypass,
  hasExplicitLocalFileOperationIntent
} from '../../shared/agent-local-intent'
import type { AgentConnectionIntentResult } from './types'

export function buildLocalOnlyConnectionIntentResult(
  input: string
): AgentConnectionIntentResult | undefined {
  if (!hasExplicitLocalFileOperationIntent(input)) return undefined

  return {
    ok: false,
    shouldConnect: false,
    confidence: 100,
    executeAfterLogin: false,
    matchBasis: 'none',
    reason: explainLocalFileOperationBypass()
  }
}
