import { describe, expect, it } from 'vitest'

import { buildAgentRunTrace, parseAgentRunTrace, serializeAgentRunTrace } from './agent-run-trace'

describe('agent-run-trace', () => {
  it('builds a redacted structured trace with timing', () => {
    const startedAt = Date.parse('2026-07-30T01:00:00.000Z')
    const trace = buildAgentRunTrace({
      runId: 'run-1',
      tabId: 'tab-1',
      input: 'Create order with Authorization: Bearer secret-token',
      status: 'success',
      connectionId: 'conn-1',
      startedAt,
      elapsedMs: 1500,
      actions: [
        {
          title: 'Used tool: create_order',
          detail: 'Arguments:\n{"headers":{"Authorization":"Bearer secret-token"}}'
        }
      ],
      result: 'Order created'
    })

    expect(trace.version).toBe(1)
    expect(trace.input).not.toContain('secret-token')
    expect(trace.steps[0]?.detail).toContain('[REDACTED]')
    expect(trace.steps[0]?.detail).not.toContain('secret-token')
    expect(trace.startedAt).toBe('2026-07-30T01:00:00.000Z')
    expect(trace.finishedAt).toBe('2026-07-30T01:00:01.500Z')
    expect(trace.resultSummary).toBe('Order created')
  })

  it('round-trips through JSON serialization', () => {
    const trace = buildAgentRunTrace({
      runId: 'run-2',
      tabId: 'tab-2',
      input: 'inspect cluster',
      status: 'error',
      error: 'timeout',
      actions: [{ title: 'Thought', detail: 'Checking pods' }]
    })

    const restored = parseAgentRunTrace(serializeAgentRunTrace(trace))
    expect(restored).toMatchObject({
      runId: 'run-2',
      tabId: 'tab-2',
      status: 'error',
      error: 'timeout',
      steps: [{ title: 'Thought', detail: 'Checking pods' }]
    })
  })
})
