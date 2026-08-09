export const SOP_GUIDANCE_HEADER = '# 生效 SOP 指引（用户选定）'
export const SKILL_GUIDANCE_HEADER = '# 引用 Skill 内容'
export const SOP_TRUNCATION_MARK = '…（已截断）'
export const SOP_GUIDANCE_MAX_CHARS = 4000
export const SKILL_CONTENT_MAX_CHARS = 2000

export interface SopWikiPromptPart {
  title: string
  content: string
}

export interface SkillPromptPart {
  name: string
  path: string
  content: string
}

export interface BuildPromptTextInput {
  input: string
  conversationContext?: string
  terminalContext?: string
  locale?: string
  activeWikiDocs?: SopWikiPromptPart[]
  activeSkillDocs?: SkillPromptPart[]
}

/** Build the active SOP guidance block from wiki docs; empty when none. Caps total length. */
export function buildActiveSopGuidance(docs: SopWikiPromptPart[]): string {
  if (!docs.length) return ''

  const bodyParts: string[] = []
  for (const doc of docs) {
    const title = doc.title.trim() || 'SOP'
    const content = doc.content.trim()
    bodyParts.push(`## ${title}\n${content}`)
  }

  let section = `${SOP_GUIDANCE_HEADER}\n${bodyParts.join('\n\n')}`
  if (section.length <= SOP_GUIDANCE_MAX_CHARS) return section

  const budget = Math.max(0, SOP_GUIDANCE_MAX_CHARS - SOP_TRUNCATION_MARK.length)
  section = `${section.slice(0, budget)}${SOP_TRUNCATION_MARK}`
  return section
}

/** Inline skill contents (each capped) so the model need not read SKILL.md via tools. */
export function buildActiveSkillGuidance(skills: SkillPromptPart[]): string {
  if (!skills.length) return ''

  const bodyParts: string[] = []
  for (const skill of skills) {
    const name = skill.name.trim() || 'Skill'
    const path = skill.path.trim()
    let content = skill.content.trim()
    if (content.length > SKILL_CONTENT_MAX_CHARS) {
      content = `${content.slice(0, SKILL_CONTENT_MAX_CHARS - SOP_TRUNCATION_MARK.length)}${SOP_TRUNCATION_MARK}`
    }
    bodyParts.push(
      [`## ${name}`, path ? `Path: ${path}` : '', '', content].filter(Boolean).join('\n')
    )
  }

  return `${SKILL_GUIDANCE_HEADER}\n${bodyParts.join('\n\n')}`
}

export function buildLanguageDirective(locale: string | undefined): string {
  const normalized = locale?.trim().toLowerCase() ?? ''
  if (normalized.startsWith('zh')) {
    return [
      '# Language',
      'Write all user-facing replies AND internal thinking/reasoning entirely in Simplified Chinese (简体中文).',
      'Do not mix Chinese and English in prose.',
      'Keep commands, paths, tool names, package names, and log identifiers in their original form.',
      ''
    ].join('\n')
  }
  return [
    '# Language',
    'Write all user-facing replies AND internal thinking/reasoning entirely in English.',
    'Do not mix languages in prose.',
    'Keep commands, paths, tool names, package names, and log identifiers in their original form.',
    ''
  ].join('\n')
}

/**
 * Assemble the user-facing prompt for a Pi agent run.
 * Order: language → conversation → terminal → SOP → skills → user input.
 */
export function buildPromptText(input: BuildPromptTextInput): string {
  const parts: string[] = []
  const languageDirective = buildLanguageDirective(input.locale)
  if (languageDirective) parts.push(languageDirective)
  if (input.conversationContext?.trim()) {
    parts.push(`# Recent conversation\n${input.conversationContext.trim()}\n`)
  }
  if (input.terminalContext?.trim()) {
    parts.push(`# Current terminal context\n${input.terminalContext.trim()}\n`)
  }
  const sopGuidance = buildActiveSopGuidance(input.activeWikiDocs ?? [])
  if (sopGuidance) parts.push(`${sopGuidance}\n`)
  const skillGuidance = buildActiveSkillGuidance(input.activeSkillDocs ?? [])
  if (skillGuidance) parts.push(`${skillGuidance}\n`)
  parts.push(input.input.trim())
  return parts.join('\n')
}
