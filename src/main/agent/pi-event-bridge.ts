import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'

import type { AgentEvent } from './types'

export interface PiEventBridgeMeta {
  runId: string
  tabId?: string
}

/**
 * Map Pi coding-agent session events onto Crescent renderer AgentEvent shapes
 * that useAgentRuns already understands (token / tool / thought / status / error / done).
 */
export function mapPiSessionEventToAgentEvents(
  event: AgentSessionEvent,
  meta: PiEventBridgeMeta
): AgentEvent[] {
  const base = { runId: meta.runId, tabId: meta.tabId }

  switch (event.type) {
    case 'agent_start':
      return [{ type: 'status', message: 'Agent started.', ...base }]
    case 'turn_start':
      return [{ type: 'status', message: 'Thinking…', ...base }]
    case 'message_update': {
      const assistantEvent = event.assistantMessageEvent
      if (assistantEvent.type === 'text_delta' && assistantEvent.delta) {
        return [{ type: 'token', text: assistantEvent.delta, ...base }]
      }
      if (assistantEvent.type === 'thinking_delta' && assistantEvent.delta) {
        return [{ type: 'thought', message: assistantEvent.delta, ...base }]
      }
      return []
    }
    case 'tool_execution_start':
      return [
        {
          type: 'tool',
          name: event.toolName,
          message: formatToolArgs(event.args),
          ...base
        }
      ]
    case 'tool_execution_end':
      return [
        {
          type: 'tool',
          name: event.toolName,
          message: event.isError ? 'Tool failed.' : 'Tool finished.',
          ...base
        }
      ]
    case 'auto_retry_start':
      return [
        {
          type: 'status',
          message: `Retrying (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`,
          ...base
        }
      ]
    case 'compaction_start':
      return [{ type: 'status', message: `Compacting context (${event.reason})…`, ...base }]
    case 'agent_end':
      return [{ type: 'done', message: 'Agent finished.', ...base }]
    default:
      return []
  }
}

function formatToolArgs(args: unknown): string {
  if (args == null) return ''
  if (typeof args === 'string') return args.slice(0, 500)
  try {
    return JSON.stringify(args).slice(0, 500)
  } catch {
    return String(args)
  }
}

export function extractAssistantTextFromMessages(messages: unknown[]): string {
  const texts: string[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const role = (message as { role?: string }).role
    if (role !== 'assistant') continue
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') {
      texts.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string'
      ) {
        texts.push((part as { text: string }).text)
      }
    }
  }
  return texts.join('\n').trim()
}
