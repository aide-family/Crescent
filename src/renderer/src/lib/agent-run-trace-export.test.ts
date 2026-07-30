import { describe, expect, it } from 'vitest'

import { buildTraceFromAgentLogEntry } from './agent-run-trace-export'
import en from '../i18n/en'

describe('agent-run-trace-export', () => {
  it('rebuilds a trace from assistant markdown logs', () => {
    const t = en
    const entry = {
      id: 12,
      kind: 'assistant' as const,
      createdAt: '2026-07-30T01:00:00.000Z',
      text: [
        `**${t.input.actions}**`,
        '',
        '- Used tool: create_order',
        '',
        '<details>',
        `<summary>${t.input.actionDetails}</summary>`,
        '',
        '#### 1. Used tool: create_order',
        '',
        'Arguments:',
        '```text',
        'Authorization: Bearer secret',
        '```',
        '',
        '</details>',
        '',
        `**${t.input.result}**`,
        '',
        'Order created',
        '',
        '---',
        `${t.input.elapsed}: 1200ms`
      ].join('\n')
    }

    const trace = buildTraceFromAgentLogEntry({
      entry,
      tabId: 'tab-1',
      t
    })

    expect(trace.steps[0]?.title).toContain('create_order')
    expect(trace.steps[0]?.detail).toContain('[REDACTED]')
    expect(trace.steps[0]?.detail).not.toContain('Bearer secret')
    expect(trace.resultSummary).toBe('Order created')
    expect(trace.elapsedMs).toBe(1200)
  })
})
