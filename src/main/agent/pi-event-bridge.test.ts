import { describe, expect, it } from 'vitest'

import { mapPiSessionEventToAgentEvents, extractAssistantTextFromMessages } from './pi-event-bridge'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'

describe('mapPiSessionEventToAgentEvents', () => {
  const meta = { runId: 'run-1', tabId: 'tab-1' }

  it('maps text deltas to token events', () => {
    const event = {
      type: 'message_update',
      message: { role: 'assistant', content: [], timestamp: Date.now() },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' }
    } as unknown as AgentSessionEvent

    expect(mapPiSessionEventToAgentEvents(event, meta)).toEqual([
      { type: 'token', text: 'Hello', runId: 'run-1', tabId: 'tab-1' }
    ])
  })

  it('maps tool execution start', () => {
    const event = {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'ls' }
    } as unknown as AgentSessionEvent

    expect(mapPiSessionEventToAgentEvents(event, meta)).toEqual([
      {
        type: 'tool',
        name: 'bash',
        message: JSON.stringify({ command: 'ls' }),
        runId: 'run-1',
        tabId: 'tab-1'
      }
    ])
  })

  it('extracts assistant text from messages', () => {
    const text = extractAssistantTextFromMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    ])
    expect(text).toBe('done')
  })
})
