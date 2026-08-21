import { AgentBrain } from './brain'
import type { AgentConfig } from './types'
import { stripToolsFromChatParams, type SopChatFn } from './generate-sop'

export const SKILL_GENERATE_TIMEOUT_MS = 180_000

export interface GenerateSkillInput {
  summary: string
  locale?: string
  draft?: string
  notes?: string
}

export interface GenerateSkillResult {
  ok: boolean
  title?: string
  content?: string
  skillName?: string
  generated?: boolean
  error?: string
  timedOut?: boolean
}

export function parseGeneratedSkillMarkdown(
  raw: string
): { title: string; content: string; skillName: string } | null {
  let text = raw.trim()
  if (!text) return null
  text = text
    .replace(/^```(?:markdown|md|yaml)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!text) return null

  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const body = (frontmatter?.[2] ?? text).trim()
  const yaml = frontmatter?.[1] ?? ''
  const name =
    yaml
      .match(/^name:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '') ||
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    ''
  if (!body) return null
  const skillName = slugifySkillName(name || body.slice(0, 40))
  const title = name || skillName
  const content = frontmatter ? text : wrapSkillFrontmatter(skillName, title, body)
  return { title, content, skillName }
}

export function slugifySkillName(name: string): string {
  const trimmed = name.trim()
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii.length >= 2) return ascii.slice(0, 80)
  const safe = stripUnsafeSkillPathChars(trimmed)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return safe || 'skill'
}

function stripUnsafeSkillPathChars(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.charCodeAt(0)
      if (code < 32 || '<>:"/\\|?*'.includes(char)) return '-'
      return char
    })
    .join('')
}

export function wrapSkillFrontmatter(skillName: string, title: string, body: string): string {
  const heading = body.match(/^#\s+/m) ? body : `# ${title}\n\n${body}`
  return [
    '---',
    `name: ${skillName}`,
    `description: '${title.replace(/'/g, "''")}'`,
    '---',
    '',
    heading.trim(),
    ''
  ].join('\n')
}

export function buildGenerateSkillSystemPrompt(locale?: string): string {
  const localeHint = (locale ?? '').toLowerCase().startsWith('zh')
    ? 'Write the skill entirely in Simplified Chinese except YAML keys, command names, and paths.'
    : 'Write the skill entirely in English except command names and paths.'

  return [
    'You turn a Crescent ops session summary into a reusable Agent Skill (SKILL.md).',
    'This is a single text completion: do not call tools, do not browse disk, do not write files.',
    'Do not invent filesystem paths, hosts, or secret credentials.',
    'Use only the session transcript. Do not invent hosts, paths, or credentials.',
    'Honor the operator seed text for the skill name and title when present.',
    'Keep the successful workflow. Mention failed attempts only as cautions (do not retry X).',
    localeHint,
    'Respond with a SKILL.md document:',
    '1) YAML frontmatter with name (kebab-case ascii when possible), description, and optional aliases.',
    '2) Markdown body with: When to use, Goals, Workflow (numbered steps with real commands), Validation, Risks.',
    'Keep it practical and concise.'
  ].join('\n')
}

export function buildGenerateSkillUserMessage(input: GenerateSkillInput): string {
  const parts = ['# Session transcript', input.summary.trim()]
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
      'Revise the current SKILL.md draft using the operator notes. Keep frontmatter and workflow sections.'
    )
  }
  return parts.join('\n')
}

export async function generateSkillFromSummary(
  input: GenerateSkillInput,
  options?: {
    config?: AgentConfig
    chat?: SopChatFn
    timeoutMs?: number
  }
): Promise<GenerateSkillResult> {
  const summary = input.summary.trim()
  if (!summary) {
    return { ok: false, error: 'Summary is empty.' }
  }

  const timeoutMs = options?.timeoutMs ?? SKILL_GENERATE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const system = buildGenerateSkillSystemPrompt(input.locale)

  try {
    const chat: SopChatFn =
      options?.chat ??
      ((params, opts) => {
        if (!options?.config) {
          throw new Error('Agent config is required for skill generation.')
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
        { role: 'user' as const, content: buildGenerateSkillUserMessage(input) }
      ]
    })

    const completion = await chat(requestParams, { signal: controller.signal })
    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseGeneratedSkillMarkdown(raw)
    if (!parsed) {
      return { ok: false, error: 'Model returned empty or unparsable skill.' }
    }
    return {
      ok: true,
      title: parsed.title,
      content: parsed.content,
      skillName: parsed.skillName,
      generated: true
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = controller.signal.aborted || /aborted|timeout|timed out/i.test(message)
    return { ok: false, error: message, timedOut }
  } finally {
    clearTimeout(timer)
  }
}
