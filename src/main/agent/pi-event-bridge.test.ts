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

  it('maps tool execution start with command', () => {
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
        phase: 'started',
        toolCallId: 'call-1',
        command: 'ls',
        message: JSON.stringify({ command: 'ls' }),
        runId: 'run-1',
        tabId: 'tab-1'
      }
    ])
  })

  it('maps tool execution end with result text', () => {
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      isError: false,
      result: { content: [{ type: 'text', text: 'file.txt\n' }] }
    } as unknown as AgentSessionEvent

    expect(mapPiSessionEventToAgentEvents(event, meta)).toEqual([
      {
        type: 'tool',
        name: 'bash',
        phase: 'finished',
        toolCallId: 'call-1',
        isError: false,
        message: 'file.txt\n',
        runId: 'run-1',
        tabId: 'tab-1'
      }
    ])
  })

  it('maps thinking deltas to thought events', () => {
    const event = {
      type: 'message_update',
      message: { role: 'assistant', content: [], timestamp: Date.now() },
      assistantMessageEvent: { type: 'thinking_delta', delta: '用' }
    } as unknown as AgentSessionEvent

    expect(mapPiSessionEventToAgentEvents(event, meta)).toEqual([
      { type: 'thought', message: '用', runId: 'run-1', tabId: 'tab-1' }
    ])
  })

  it('extracts assistant text from messages', () => {
    const text = extractAssistantTextFromMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    ])
    expect(text).toBe('done')
  })

  it('uses the last assistant message text as the final result', () => {
    const text = extractAssistantTextFromMessages([
      { role: 'assistant', content: [{ type: 'text', text: '先检查 pods。' }] },
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: [{ type: 'text', text: 'Loki 健康。' }] }
    ])
    expect(text).toBe('Loki 健康。')
  })

  it('maps AccountQuotaExceeded auto_retry_start to kind:quota and does not emit Retrying (2/2)', () => {
    const event = {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 2,
      delayMs: 1000,
      errorMessage:
        '429: {"code":"AccountQuotaExceeded","message":"You have reached your API usage limit","type":"Limit"}'
    } as unknown as AgentSessionEvent

    const events = mapPiSessionEventToAgentEvents(event, meta)
    expect(events.some((e) => e.type === 'status' && /^Retrying\b/.test(e.message))).toBe(false)
    const error = events.find((e) => e.type === 'error')
    expect(error).toMatchObject({
      type: 'error',
      kind: 'quota',
      code: 'quota_exceeded',
      message: 'AccountQuotaExceeded'
    })
    expect(JSON.stringify(events)).not.toContain('"type":"Limit"')
  })

  it('keeps transient 429 auto_retry_start as Retrying status (blind retry allowed)', () => {
    const event = {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 2,
      delayMs: 1000,
      errorMessage: '429 rate limit: Too Many Requests'
    } as unknown as AgentSessionEvent

    const events = mapPiSessionEventToAgentEvents(event, meta)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'status',
      message: expect.stringMatching(/^Retrying \(1\/2\):/)
    })
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })
})
