import { redactSensitiveText } from './secret-redaction'

/** Pi default: compact when contextTokens > contextWindow - reserveTokens. */
export const COMPACTION_RESERVE_TOKENS = 16_384
export const SESSION_OUTLINE_RECENT_LIMIT = 12
export const SESSION_OUTLINE_MAX_CHARS = 4_000
export const SESSION_OUTLINE_GOAL_MAX_CHARS = 240
export const SESSION_OUTLINE_EXCERPT_MAX_CHARS = 500
export const SESSION_OUTLINE_BULLET_MAX_CHARS = 240
export const SESSION_OUTLINE_EARLIER_LIMIT = 40
export const SESSION_OUTLINE_CHANGE_LIMIT = 20

export type OutlineLocale = 'zh' | 'en'
export type SessionOutlineStatus = 'completed' | 'interrupted'

export interface SessionOutlineEntry {
  id: string
  createdAt: string
  runId?: string
  status: SessionOutlineStatus
  goal: string
  conclusions: string[]
  changes: string[]
  unfinished: string[]
}

export interface SessionOutlineDocument {
  recent: SessionOutlineEntry[]
  earlierConclusions: string[]
  earlierChanges: string[]
  earlierUnfinished: string[]
}

export interface OutlineFacts {
  conclusions: string[]
  changes: string[]
  unfinished: string[]
}

export const sessionOutlineMessages = {
  zh: {
    recorded: '已记录本轮会话大纲',
    interruptedRecorded: '已记录中断轮次的关键信息',
    deferred: '本轮结束后再压缩上下文',
    afterTurn: '本轮已结束，开始压缩上下文',
    emptyInterrupted: '中断时尚无结论或变更',
    interruptedUnfinished: '本轮被中断，后续步骤未完成',
    header: '# 会话大纲',
    preamble:
      '把下面的条目当作已经确认的事实。不要补充未列出的结论。中断条目要从未完成项继续，不要把中断前的变更再做一遍。',
    earlierConclusions: '较早结论',
    earlierChanges: '较早变更',
    earlierUnfinished: '较早未完成',
    completed: '已完成',
    interrupted: '已中断',
    goal: '目标',
    conclusions: '结论',
    changes: '变更',
    unfinished: '未完成',
    truncated: '…（已截断）'
  },
  en: {
    recorded: 'Recorded this turn in the session outline',
    interruptedRecorded: 'Recorded key facts from the interrupted turn',
    deferred: 'Context compaction will run after this turn finishes',
    afterTurn: 'This turn has finished; compacting context',
    emptyInterrupted: 'Interrupted before any conclusion or change',
    interruptedUnfinished: 'The turn was interrupted before the remaining steps finished',
    header: '# Session outline',
    preamble:
      'Treat the entries below as established facts. Do not add conclusions that are not listed. For an interrupted turn, continue from the unfinished items and do not repeat changes that already happened.',
    earlierConclusions: 'Earlier conclusions',
    earlierChanges: 'Earlier changes',
    earlierUnfinished: 'Earlier unfinished work',
    completed: 'Completed',
    interrupted: 'Interrupted',
    goal: 'Goal',
    conclusions: 'Conclusions',
    changes: 'Changes',
    unfinished: 'Unfinished',
    truncated: '…(truncated)'
  }
} as const

export function resolveOutlineLocale(locale: string | undefined): OutlineLocale {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function outlineRecordedStatus(status: SessionOutlineStatus, locale: OutlineLocale): string {
  const copy = sessionOutlineMessages[locale]
  return status === 'interrupted' ? copy.interruptedRecorded : copy.recorded
}

export function deferredCompactionStatus(locale: OutlineLocale): string {
  return sessionOutlineMessages[locale].deferred
}

export function postTurnCompactionStatus(locale: OutlineLocale): string {
  return sessionOutlineMessages[locale].afterTurn
}

export function emptyOutlineDocument(): SessionOutlineDocument {
  return {
    recent: [],
    earlierConclusions: [],
    earlierChanges: [],
    earlierUnfinished: []
  }
}

export function shouldCancelThresholdCompaction(input: {
  agentLoopActive: boolean
  reason: string | undefined
}): boolean {
  return input.agentLoopActive && input.reason === 'threshold'
}

export function shouldCompactAfterTurn(input: {
  pendingThresholdCompact: boolean
  contextTokens?: number | null
  contextWindow?: number | null
}): boolean {
  if (input.pendingThresholdCompact) return true
  const tokens = input.contextTokens
  const contextWindow = input.contextWindow
  if (typeof tokens !== 'number' || typeof contextWindow !== 'number' || contextWindow <= 0) {
    return false
  }
  return tokens > contextWindow - COMPACTION_RESERVE_TOKENS
}

export function isDeferredThresholdCancel(
  event: { type?: string; reason?: string; aborted?: boolean },
  pendingThresholdCompact: boolean
): boolean {
  return Boolean(
    pendingThresholdCompact &&
    event.type === 'compaction_end' &&
    event.reason === 'threshold' &&
    event.aborted
  )
}

export function isSessionOutlineEntry(value: unknown): value is SessionOutlineEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as SessionOutlineEntry
  return (
    typeof entry.id === 'string' &&
    entry.id.trim().length > 0 &&
    typeof entry.createdAt === 'string' &&
    (entry.status === 'completed' || entry.status === 'interrupted') &&
    typeof entry.goal === 'string' &&
    Array.isArray(entry.conclusions) &&
    Array.isArray(entry.changes) &&
    Array.isArray(entry.unfinished)
  )
}

export function normalizeOutlineDocument(value: unknown): SessionOutlineDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyOutlineDocument()
  const record = value as Partial<SessionOutlineDocument>
  return {
    recent: Array.isArray(record.recent) ? record.recent.filter(isSessionOutlineEntry) : [],
    earlierConclusions: uniqueStrings(
      stringList(record.earlierConclusions),
      SESSION_OUTLINE_EARLIER_LIMIT
    ),
    earlierChanges: uniqueStrings(stringList(record.earlierChanges), SESSION_OUTLINE_EARLIER_LIMIT),
    earlierUnfinished: uniqueStrings(
      stringList(record.earlierUnfinished),
      SESSION_OUTLINE_EARLIER_LIMIT
    )
  }
}

export function parseOutlineExtraction(raw: string): OutlineFacts | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const body = fenced?.[1]?.trim() || trimmed
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(body.slice(start, end + 1)) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Partial<OutlineFacts>
    const facts: OutlineFacts = {
      conclusions: uniqueStrings(stringList(record.conclusions), 8),
      changes: uniqueStrings(stringList(record.changes), SESSION_OUTLINE_CHANGE_LIMIT),
      unfinished: uniqueStrings(stringList(record.unfinished), 6)
    }
    if (!facts.conclusions.length && !facts.changes.length && !facts.unfinished.length) {
      return undefined
    }
    return facts
  } catch {
    return undefined
  }
}

export function fallbackOutlineFacts(input: {
  status: SessionOutlineStatus
  assistantText: string
  changes: string[]
  locale: OutlineLocale
}): OutlineFacts {
  const copy = sessionOutlineMessages[input.locale]
  const excerpt = clip(input.assistantText, SESSION_OUTLINE_EXCERPT_MAX_CHARS)
  const changes = uniqueStrings(input.changes, SESSION_OUTLINE_CHANGE_LIMIT)
  const conclusions = excerpt ? [excerpt] : []
  const unfinished = input.status === 'interrupted' ? [copy.interruptedUnfinished] : []
  if (input.status === 'interrupted' && conclusions.length === 0 && changes.length === 0) {
    conclusions.push(copy.emptyInterrupted)
  }
  return { conclusions, changes, unfinished }
}

export function buildOutlineEntry(input: {
  id: string
  createdAt: string
  runId?: string
  status: SessionOutlineStatus
  goal: string
  assistantText: string
  toolChanges: string[]
  extracted?: OutlineFacts
  locale: OutlineLocale
}): SessionOutlineEntry {
  const fallback = fallbackOutlineFacts({
    status: input.status,
    assistantText: input.assistantText,
    changes: input.toolChanges,
    locale: input.locale
  })
  const extracted = input.extracted
  let unfinished = extracted?.unfinished.length ? extracted.unfinished : fallback.unfinished
  if (input.status === 'interrupted' && unfinished.length === 0) {
    unfinished = [sessionOutlineMessages[input.locale].interruptedUnfinished]
  }
  if (input.status === 'completed' && extracted && extracted.unfinished.length === 0) {
    unfinished = []
  }
  const conclusions = extracted?.conclusions.length ? extracted.conclusions : fallback.conclusions
  const changes = extracted?.changes.length ? extracted.changes : fallback.changes
  return {
    id: input.id,
    createdAt: input.createdAt,
    runId: input.runId,
    status: input.status,
    goal: redactSensitiveText(clip(input.goal, SESSION_OUTLINE_GOAL_MAX_CHARS)),
    conclusions: conclusions.map((item) => redactSensitiveText(item)),
    changes: changes.map((item) => redactSensitiveText(item)),
    unfinished: unfinished.map((item) => redactSensitiveText(item))
  }
}

export function appendOutlineEntry(
  document: SessionOutlineDocument,
  entry: SessionOutlineEntry
): SessionOutlineDocument {
  const recent = [...document.recent, entry]
  const next: SessionOutlineDocument = {
    recent,
    earlierConclusions: [...document.earlierConclusions],
    earlierChanges: [...document.earlierChanges],
    earlierUnfinished: [...document.earlierUnfinished]
  }
  while (next.recent.length > SESSION_OUTLINE_RECENT_LIMIT) {
    const oldest = next.recent.shift()
    if (!oldest) break
    next.earlierConclusions = uniqueStrings(
      [...next.earlierConclusions, ...oldest.conclusions],
      SESSION_OUTLINE_EARLIER_LIMIT
    )
    next.earlierChanges = uniqueStrings(
      [...next.earlierChanges, ...oldest.changes],
      SESSION_OUTLINE_EARLIER_LIMIT
    )
    next.earlierUnfinished = uniqueStrings(
      [...next.earlierUnfinished, ...oldest.unfinished],
      SESSION_OUTLINE_EARLIER_LIMIT
    )
  }
  return next
}

export function formatSessionOutline(
  document: SessionOutlineDocument,
  locale: OutlineLocale
): string {
  const normalized = normalizeOutlineDocument(document)
  if (
    normalized.recent.length === 0 &&
    normalized.earlierConclusions.length === 0 &&
    normalized.earlierChanges.length === 0 &&
    normalized.earlierUnfinished.length === 0
  ) {
    return ''
  }

  const copy = sessionOutlineMessages[locale]
  const header = `${copy.header}\n${copy.preamble}`
  const earlier = renderEarlier(normalized, locale)
  const recent = normalized.recent.map((entry, index) => renderEntry(entry, index + 1, locale))
  let parts = [earlier, ...recent].filter(Boolean)
  let text = [header, ...parts].join('\n\n')
  if (text.length <= SESSION_OUTLINE_MAX_CHARS) return text

  parts = [...recent]
  text = [header, ...parts].join('\n\n')
  while (text.length > SESSION_OUTLINE_MAX_CHARS && parts.length > 1) {
    parts.shift()
    text = [header, ...parts].join('\n\n')
  }
  if (text.length <= SESSION_OUTLINE_MAX_CHARS) return text
  const mark = copy.truncated
  return `${text.slice(0, Math.max(0, SESSION_OUTLINE_MAX_CHARS - mark.length))}${mark}`
}

export function buildOutlineCompactionInstructions(outline: string, extra?: string): string {
  const parts = [
    'Preserve every conclusion, operational change, and unfinished item from the session outline verbatim in Critical Context. Keep facts from interrupted turns even if those turns were aborted. Do not invent findings that are not in the outline or the kept messages.'
  ]
  const body = outline.trim()
  if (body) parts.push(body)
  const focus = extra?.trim()
  if (focus) parts.push(`Operator focus: ${focus}`)
  return parts.join('\n\n')
}

export function collectTurnToolChanges(messages: unknown[]): string[] {
  let start = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageRole(messages[index]) === 'user') {
      start = index + 1
      break
    }
  }

  const changes: string[] = []
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object') continue
    const record = message as {
      role?: unknown
      content?: unknown
      toolName?: unknown
      details?: unknown
    }
    if (record.role === 'assistant' && Array.isArray(record.content)) {
      for (const part of record.content) {
        const change = changeFromToolCall(part)
        if (change) changes.push(change)
      }
    }
    if (record.role === 'toolResult') {
      const change = changeFromToolResult(record)
      if (change) changes.push(change)
    }
  }
  return uniqueStrings(changes, SESSION_OUTLINE_CHANGE_LIMIT)
}

function renderEarlier(document: SessionOutlineDocument, locale: OutlineLocale): string {
  const copy = sessionOutlineMessages[locale]
  const sections = [
    renderBulletSection(copy.earlierConclusions, document.earlierConclusions),
    renderBulletSection(copy.earlierChanges, document.earlierChanges),
    renderBulletSection(copy.earlierUnfinished, document.earlierUnfinished)
  ].filter(Boolean)
  return sections.join('\n\n')
}

function renderEntry(entry: SessionOutlineEntry, index: number, locale: OutlineLocale): string {
  const copy = sessionOutlineMessages[locale]
  const status = entry.status === 'interrupted' ? copy.interrupted : copy.completed
  const lines = [`## ${index} · ${status}`, `${copy.goal}: ${entry.goal || '—'}`]
  const conclusions = renderBulletSection(copy.conclusions, entry.conclusions)
  const changes = renderBulletSection(copy.changes, entry.changes)
  const unfinished = renderBulletSection(copy.unfinished, entry.unfinished)
  if (conclusions) lines.push(conclusions)
  if (changes) lines.push(changes)
  if (unfinished) lines.push(unfinished)
  return lines.join('\n')
}

function renderBulletSection(title: string, items: string[]): string {
  if (!items.length) return ''
  return [`### ${title}`, ...items.map((item) => `- ${item}`)].join('\n')
}

function changeFromToolCall(part: unknown): string | undefined {
  if (!part || typeof part !== 'object') return undefined
  const block = part as { type?: unknown; name?: unknown; arguments?: unknown; input?: unknown }
  if (block.type !== 'toolCall') return undefined
  const name = typeof block.name === 'string' ? block.name : 'tool'
  return changeFromArgs(name, block.arguments ?? block.input)
}

function changeFromToolResult(record: {
  toolName?: unknown
  details?: unknown
}): string | undefined {
  const name = typeof record.toolName === 'string' ? record.toolName : 'tool'
  return changeFromArgs(name, record.details)
}

function changeFromArgs(name: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  const command = stringField(record, 'command') || stringField(record, 'cmd')
  if (command) return clip(command, SESSION_OUTLINE_BULLET_MAX_CHARS)
  const path =
    stringField(record, 'path') ||
    stringField(record, 'file_path') ||
    stringField(record, 'filePath')
  if (path && /write|edit|apply|patch|replace/i.test(name)) {
    return clip(`${name} ${path}`, SESSION_OUTLINE_BULLET_MAX_CHARS)
  }
  return undefined
}

function messageRole(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const role = (message as { role?: unknown }).role
  return typeof role === 'string' ? role : ''
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = clip(value, SESSION_OUTLINE_BULLET_MAX_CHARS)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= limit) break
  }
  return result
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}
