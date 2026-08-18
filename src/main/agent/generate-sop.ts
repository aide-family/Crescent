import { AgentBrain } from './brain'
import type { AgentConfig, WikiDocument } from './types'
import { saveWikiDocument } from './wiki'

export const SOP_GENERATE_TIMEOUT_MS = 30_000

export interface GenerateSopInput {
  summary: string
  locale?: string
  /** Used when completion fails or returns empty; title auto-prefixed SOP： when saved. */
  fallbackTitle?: string
  fallbackContent?: string
  /** Existing draft to revise. */
  draft?: string
  /** Operator notes for AI refinement. */
  notes?: string
}

export interface GenerateSopResult {
  ok: boolean
  title?: string
  content?: string
  document?: WikiDocument
  /** True when title/content came from the model rather than fallback. */
  generated?: boolean
  error?: string
  timedOut?: boolean
}

export type SopChatParams = {
  temperature: number
  messages: Array<{ role: 'system' | 'user'; content: string }>
  /** Must never be set on the SOP path. */
  tools?: unknown
  tool_choice?: unknown
  functions?: unknown
}

export type SopChatFn = (
  params: SopChatParams,
  options?: { signal?: AbortSignal }
) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>

export type SopSaveFn = (input: { title: string; content: string }) => Promise<WikiDocument>

/** Strip any tool-calling fields so SOP generation cannot invoke tools. */
export function stripToolsFromChatParams<T extends Record<string, unknown>>(params: T): T {
  const rest = { ...params }
  delete rest.tools
  delete rest.tool_choice
  delete rest.functions
  return rest
}

/** Parse model output into title + markdown body. */
export function parseGeneratedSopMarkdown(raw: string): { title: string; content: string } | null {
  const text = raw.trim()
  if (!text) return null

  const titleMatch = text.match(/^TITLE:\s*(.+)$/im)
  let title = titleMatch?.[1]?.trim() ?? ''
  let content = text
  if (titleMatch) {
    content = text.replace(titleMatch[0], '').trim()
  }

  // Strip optional markdown fences around the body.
  content = content
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  if (!content) return null
  if (!title) {
    const heading = content.match(/^#\s+(.+)$/m)
    title = heading?.[1]?.trim() || content.slice(0, 40).replace(/\s+/g, ' ')
  }
  title = ensureSopTitle(title)
  return { title, content }
}

export function ensureSopTitle(title: string): string {
  const trimmed = title.trim() || 'SOP'
  if (trimmed.startsWith('SOP：') || trimmed.startsWith('SOP:')) return trimmed
  return `SOP：${trimmed}`
}

export function buildGenerateSopSystemPrompt(locale?: string): string {
  const localeHint = (locale ?? '').toLowerCase().startsWith('zh')
    ? 'Write the SOP entirely in Simplified Chinese.'
    : 'Write the SOP entirely in English.'

  return [
    'You turn a Crescent ops session summary into a reusable SOP markdown document.',
    'This is a single text completion: do not call tools, do not browse disk, do not write files.',
    'Do not invent filesystem paths or secret credentials.',
    'Use only the summary provided by the user message.',
    localeHint,
    'Command examples in the SOP must be currently valid CLI usage.',
    'Never use deprecated flags such as `kubectl version --short` (use `kubectl version` or omit version checks).',
    'For deep-dive steps: each abnormal object gets its own section, but commands for multiple objects may run in the same bash invocation concurrently (`;` / `&` within one call as appropriate for readonly inspection).',
    'Respond with:',
    '1) First line exactly: TITLE: <short title without SOP： prefix>',
    '2) Then a markdown body with these sections:',
    '- 适用范围 / Scope',
    '- 前置条件 / Prerequisites',
    '- 操作步骤 / Steps',
    '- 报告模板 / Report template',
    '- 注意事项 / Cautions',
    'Keep it practical and concise.'
  ].join('\n')
}

/**
 * Single-shot completion (no tools) to draft SOP markdown.
 * Does not touch the filesystem; callers should save via saveWikiDocument.
 */
export async function generateSopFromSummary(
  input: GenerateSopInput,
  options?: {
    config?: AgentConfig
    chat?: SopChatFn
    timeoutMs?: number
  }
): Promise<GenerateSopResult> {
  const summary = input.summary.trim()
  if (!summary) {
    return { ok: false, error: 'Summary is empty.' }
  }

  const timeoutMs = options?.timeoutMs ?? SOP_GENERATE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const system = buildGenerateSopSystemPrompt(input.locale)

  try {
    const chat: SopChatFn =
      options?.chat ??
      ((params, opts) => {
        if (!options?.config) {
          throw new Error('Agent config is required for SOP generation.')
        }
        const brain = new AgentBrain(options.config)
        const safe = stripToolsFromChatParams(params as Record<string, unknown>)
        return brain.chat(
          {
            temperature: safe.temperature as number,
            messages: safe.messages as Array<{ role: 'system' | 'user'; content: string }>
          },
          opts
        )
      })

    const requestParams = stripToolsFromChatParams({
      temperature: 0.2,
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: buildGenerateSopUserMessage(input) }
      ]
    })

    const completion = await chat(requestParams, { signal: controller.signal })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseGeneratedSopMarkdown(raw)
    if (!parsed) {
      return { ok: false, error: 'Model returned empty or unparsable SOP.' }
    }
    return { ok: true, title: parsed.title, content: parsed.content, generated: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = controller.signal.aborted || /aborted|timeout|timed out/i.test(message)
    return {
      ok: false,
      error: message,
      timedOut
    }
  } finally {
    clearTimeout(timer)
  }
}

export function buildGenerateSopUserMessage(input: GenerateSopInput): string {
  const parts = ['# Session summary', input.summary.trim()]
  const draft = input.draft?.trim()
  if (draft) {
    parts.push('', '# Current draft', draft)
  }
  const notes = input.notes?.trim()
  if (notes) {
    parts.push('', '# Operator notes', notes)
  }
  if (draft || notes) {
    parts.push(
      '',
      'Revise the current draft using the operator notes. Keep the required SOP sections.'
    )
  }
  return parts.join('\n')
}

/**
 * Save a generated SOP via saveWikiDocument. Does not fall back to raw seed text.
 */
export async function generateAndSaveSop(
  input: GenerateSopInput,
  options?: {
    config?: AgentConfig
    chat?: SopChatFn
    save?: SopSaveFn
    timeoutMs?: number
  }
): Promise<GenerateSopResult> {
  const generated = await generateSopFromSummary(input, options)
  if (!generated.ok || !generated.title?.trim() || !generated.content?.trim()) {
    return {
      ok: false,
      error: generated.error || 'No SOP content to save.',
      timedOut: generated.timedOut,
      generated: false
    }
  }

  const save = options?.save ?? ((payload) => saveWikiDocument(payload))
  const document = await save({ title: generated.title.trim(), content: generated.content.trim() })

  return {
    ok: true,
    title: document.title,
    content: document.content,
    document,
    generated: true
  }
}
