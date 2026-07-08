import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'

import type { AgentSkillContext, AgentSkillOption } from './types'

const MAX_MATCHED_SKILLS = 3
const MAX_SKILL_CONTENT_CHARS = 16_000

export function listAgentSkills(): AgentSkillOption[] {
  const roots = [
    join(homedir(), '.codex', 'skills'),
    join(homedir(), '.codex', 'skills', '.system'),
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.codex', '.agents', 'skills')
  ]
  const seen = new Set<string>()
  const skills: AgentSkillOption[] = []

  for (const root of roots) {
    for (const path of findSkillFiles(root)) {
      if (seen.has(path)) continue
      seen.add(path)
      skills.push(readSkill(path, root))
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

export function buildAgentSkillContext(input: string): AgentSkillContext {
  const catalog = listAgentSkills()
  const referenced = findReferencedSkills(input, catalog)
  const matched = referenced.length
    ? referenced.map((skill) => ({ skill, score: 1000, reason: 'referenced' as const }))
    : scoreSkills(input, catalog)
        .filter((item) => item.score > 0)
        .slice(0, MAX_MATCHED_SKILLS)
        .map((item) => ({ ...item, reason: 'matched' as const }))

  const matchedWithContent = matched.map(({ skill, reason }) => ({
    ...skill,
    reason,
    content: readSkillContent(skill.path)
  }))

  return {
    catalog,
    matched: matchedWithContent,
    promptBlock: formatSkillPromptBlock(catalog, matchedWithContent)
  }
}

function findSkillFiles(root: string): string[] {
  if (!existsSync(root)) return []

  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const skillPath = join(root, entry.name, 'SKILL.md')
    if (existsSync(skillPath)) files.push(skillPath)
  }

  return files
}

function readSkill(path: string, root: string): AgentSkillOption {
  const content = readFileSync(path, 'utf8')
  const name = extractSkillName(content) || basename(path.replace(/\/SKILL\.md$/, ''))

  return {
    id: name,
    name,
    description: extractSkillDescription(content),
    path,
    source: root
  }
}

function findReferencedSkills(input: string, catalog: AgentSkillOption[]): AgentSkillOption[] {
  const referencedNames = new Set<string>()
  const referencedPaths = new Set<string>()

  for (const match of input.matchAll(/(?:使用 skill|Use skill):\s*([^\n]+)/gi)) {
    referencedNames.add(match[1].trim())
  }

  for (const match of input.matchAll(/SKILL\.md:\s*([^\n]+)/gi)) {
    referencedPaths.add(match[1].trim())
  }

  return catalog.filter(
    (skill) => referencedNames.has(skill.name) || referencedPaths.has(skill.path)
  )
}

function scoreSkills(
  input: string,
  catalog: AgentSkillOption[]
): Array<{
  skill: AgentSkillOption
  score: number
}> {
  const normalizedInput = normalizeSearchText(input)
  const inputTokens = new Set(tokenizeSearchText(input))

  return catalog
    .map((skill) => {
      const name = normalizeSearchText(skill.name)
      const description = normalizeSearchText(skill.description)
      const sourceText = `${skill.name} ${skill.description}`
      let score = 0

      if (name && normalizedInput.includes(name)) score += 120
      if (description && normalizedInput.includes(description)) score += 80

      for (const token of tokenizeSearchText(sourceText)) {
        if (token.length < 2) continue
        if (inputTokens.has(token)) score += 20
        else if (normalizedInput.includes(token)) score += 8
      }

      return { skill, score }
    })
    .sort(
      (left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name)
    )
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[\s"'`。，、,.:：;；/\\|()[\]{}_-]+/g, '')
}

function tokenizeSearchText(value: string): string[] {
  const tokens = new Set<string>()
  const normalized = value.toLowerCase()

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_.-]*/g)) {
    for (const part of match[0].split(/[_.-]+/)) {
      if (part.length >= 2) tokens.add(part)
    }
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const text = match[0]
    tokens.add(text)
    for (let index = 0; index < text.length - 1; index += 1) {
      tokens.add(text.slice(index, index + 2))
    }
  }

  return [...tokens]
}

function readSkillContent(path: string): string {
  try {
    return readFileSync(path, 'utf8').slice(0, MAX_SKILL_CONTENT_CHARS)
  } catch (error) {
    return `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`
  }
}

function formatSkillPromptBlock(
  catalog: AgentSkillOption[],
  matched: AgentSkillContext['matched']
): string {
  const catalogLines = catalog.map((skill) =>
    [`- ${skill.name}`, skill.description ? `: ${skill.description}` : '', ` (${skill.path})`].join(
      ''
    )
  )
  const lines = [
    'Local agent skills are available on this machine.',
    'Use a skill when the user explicitly references it or when the task clearly matches its description.',
    'Crescent has already read the loaded SKILL.md files from the local filesystem in the app process and included their content below.',
    'Do not call terminal commands such as cat, sed, awk, less, head, tail, or grep to read SKILL.md or other local skill instruction files.',
    'When using a loaded skill, rely on the content in this Agent skills block and follow its workflow.',
    '',
    'Available skills:',
    ...catalogLines
  ]

  if (matched.length > 0) {
    lines.push('', 'Loaded skill content for this request:')
    for (const skill of matched) {
      lines.push(
        '',
        `## ${skill.name} (${skill.reason})`,
        `Path: ${skill.path}`,
        '```markdown',
        skill.content,
        '```'
      )
    }
  }

  return lines.join('\n')
}

function extractSkillName(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim()

  return name || heading || ''
}

function extractSkillDescription(content: string): string {
  const explicitDescription = content.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (explicitDescription) return explicitDescription.slice(0, 240)

  const paragraph =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(
        (line) => line && !line.startsWith('#') && !line.startsWith('---') && !line.includes(':')
      ) ?? ''

  return paragraph.slice(0, 240)
}
