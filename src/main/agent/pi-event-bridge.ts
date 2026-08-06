import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'

import type { AgentEvent } from './types'

export interface PiEventBridgeMeta {
  runId: string
  tabId?: string
}

const MAX_TOOL_RESULT_CHARS = 8_000

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
          phase: 'started',
          toolCallId: event.toolCallId,
          command: extractBashCommand(event.args),
          message: formatToolArgs(event.args),
          ...base
        }
      ]
    case 'tool_execution_end':
      return [
        {
          type: 'tool',
          name: event.toolName,
          phase: 'finished',
          toolCallId: event.toolCallId,
          isError: Boolean(event.isError),
          message: formatToolResult(event.result, event.isError),
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

function extractBashCommand(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const command = (args as { command?: unknown }).command
  return typeof command === 'string' && command.trim() ? command.trim() : undefined
}

function formatToolResult(result: unknown, isError: boolean): string {
  const text = extractToolResultText(result)
  if (text.trim()) return text.slice(0, MAX_TOOL_RESULT_CHARS)
  return isError ? 'Tool failed.' : 'Tool finished.'
}

function extractToolResultText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (typeof result !== 'object') return String(result)

  const record = result as Record<string, unknown>
  if (typeof record.output === 'string') return record.output
  if (typeof record.text === 'string') return record.text
  if (typeof record.error === 'string') return record.error

  if (Array.isArray(record.content)) {
    const texts = record.content
      .filter(
        (part): part is { type: string; text: string } =>
          Boolean(part) &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
      )
      .map((part) => part.text)
    if (texts.length > 0) return texts.join('\n')
  }

  if (record.details && typeof record.details === 'object') {
    const details = record.details as Record<string, unknown>
    if (typeof details.output === 'string') return details.output
    if (typeof details.stdout === 'string' || typeof details.stderr === 'string') {
      return [details.stdout, details.stderr].filter((part) => typeof part === 'string').join('\n')
    }
  }

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
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
