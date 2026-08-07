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
})
