import { readSessionOutline, writeSessionOutline } from '../crescent-sqlite'
import { AgentBrain } from './brain'
import type { AgentConfig } from './types'
import {
  appendOutlineEntry,
  buildOutlineEntry,
  collectTurnToolChanges,
  parseOutlineExtraction,
  resolveOutlineLocale,
  type OutlineLocale,
  type SessionOutlineStatus
} from '../../shared/session-outline'

const EXTRACTION_TEXT_MAX_CHARS = 8_000
const EXTRACTION_CHANGES_MAX_CHARS = 4_000

export async function recordTurnOutline(input: {
  tabId: string
  runId: string
  status: SessionOutlineStatus
  goal: string
  assistantText: string
  messages: unknown[]
  locale?: string
  config: AgentConfig
}): Promise<void> {
  const tabId = input.tabId.trim()
  if (!tabId) return

  const locale = resolveOutlineLocale(input.locale)
  const toolChanges = collectTurnToolChanges(input.messages)
  const extracted =
    input.assistantText.trim() || toolChanges.length
      ? await extractOutlineFacts({
          config: input.config,
          locale,
          status: input.status,
          goal: input.goal,
          assistantText: input.assistantText,
          toolChanges
        })
      : undefined

  const entry = buildOutlineEntry({
    id: `outline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    runId: input.runId,
    status: input.status,
    goal: input.goal,
    assistantText: input.assistantText,
    toolChanges,
    extracted,
    locale
  })
  const document = appendOutlineEntry(readSessionOutline(tabId), entry)
  writeSessionOutline(tabId, document)
}

async function extractOutlineFacts(input: {
  config: AgentConfig
  locale: OutlineLocale
  status: SessionOutlineStatus
  goal: string
  assistantText: string
  toolChanges: string[]
}): Promise<ReturnType<typeof parseOutlineExtraction>> {
  const assistantText = input.assistantText.trim().slice(0, EXTRACTION_TEXT_MAX_CHARS)
  const changes = input.toolChanges.join('\n').slice(0, EXTRACTION_CHANGES_MAX_CHARS)
  try {
    const completion = await new AgentBrain(input.config).chat({
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'You extract a session outline from one Crescent operations turn.',
            'Return strict JSON only: {"conclusions":[],"changes":[],"unfinished":[]}.',
            'conclusions: facts already established in this turn. Do not guess.',
            'changes: commands, config, or file changes that already happened. Copy commands exactly.',
            'unfinished: steps that were not finished. For a completed turn, use an empty array unless the reply names leftover work.',
            'For an interrupted turn, list only what stopped. Do not invent steps that never started.',
            'Use the same language as the user goal.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `Status: ${input.status}`,
            `Language: ${input.locale}`,
            '',
            'User goal:',
            input.goal.trim().slice(0, 2_000) || '(empty)',
            '',
            input.status === 'interrupted'
              ? 'Partial assistant text collected before the interrupt:'
              : 'Assistant text:',
            assistantText || '(none)',
            '',
            'Tool changes already executed:',
            changes || '(none)'
          ].join('\n')
        }
      ]
    })
    return parseOutlineExtraction(completion.choices[0]?.message.content ?? '')
  } catch {
    return undefined
  }
}
