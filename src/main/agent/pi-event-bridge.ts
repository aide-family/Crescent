import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'

import {
  buildQuotaResetHint,
  classifyProviderError,
  formatQuotaWaitingStatus,
  formatRetryAfterLabel,
  summarizeProviderErrorForStatus
} from '../../shared/provider-error'
import type { AgentEvent } from './types'

export interface PiEventBridgeMeta {
  runId: string
  tabId?: string
  /** Host locale for resetHint / waiting status (`zh*` → zh). */
  locale?: string
}

const MAX_TOOL_RESULT_CHARS = 8_000

/**
 * Map Pi coding-agent session events onto Crescent renderer AgentEvent shapes
 * that useAgentRuns already understands (token / tool / thought / status / error).
 * The host emits `done` itself from the final assistant text after prompt() resolves,
 * so `agent_end` needs no bridge mapping.
 */
export function mapPiSessionEventToAgentEvents(
  event: AgentSessionEvent,
  meta: PiEventBridgeMeta
): AgentEvent[] {
  const base = { runId: meta.runId, tabId: meta.tabId }

  switch (event.type) {
    case 'agent_start':
      return []
    case 'turn_start':
      return []
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
    case 'auto_retry_start': {
      const locale = resolveBridgeLocale(meta.locale)
      const classified = classifyProviderError(event.errorMessage ?? '')
      if (classified.kind === 'quota_exceeded') {
        // Stop surfacing raw JSON retries; host will abort further attempts.
        const resetHint = buildQuotaResetHint(classified.retryAfterMs, locale)
        return [
          {
            type: 'status',
            message: formatQuotaWaitingStatus(classified, locale),
            ...base
          },
          {
            type: 'error',
            message: 'AccountQuotaExceeded',
            kind: 'quota',
            code: 'quota_exceeded',
            provider: classified.provider,
            resetHint,
            retryAfterMs: classified.retryAfterMs,
            ...base
          }
        ]
      }
      const summary = summarizeProviderErrorForStatus(event.errorMessage ?? '')
      const waitHint =
        classified.retryAfterMs != null
          ? formatRetryAfterLabel(classified.retryAfterMs, locale)
          : locale === 'zh'
            ? '等待恢复'
            : 'waiting to recover'
      return [
        {
          type: 'status',
          message: `Retrying (${event.attempt}/${event.maxAttempts}): ${summary} — ${waitHint}`,
          ...base
        }
      ]
    }
    case 'compaction_start':
      return [{ type: 'status', message: `Compacting context (${event.reason})…`, ...base }]
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
  let lastText = ''
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const role = (message as { role?: string }).role
    if (role !== 'assistant') continue
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') {
      const trimmed = content.trim()
      if (trimmed) lastText = trimmed
      continue
    }
    if (!Array.isArray(content)) continue
    const parts: string[] = []
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string'
      ) {
        const text = (part as { text: string }).text.trim()
        if (text) parts.push(text)
      }
    }
    if (parts.length > 0) lastText = parts.join('\n').trim()
  }
  return lastText
}

function resolveBridgeLocale(locale: string | undefined): 'zh' | 'en' {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
