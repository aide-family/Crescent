import type { AgentSkillOption, AgentSkillSearchResult } from '../../../shared/agent-types'
import { shellQuote } from './connection-commands'

export function filterLocalSkills(skills: AgentSkillOption[], query: string): AgentSkillOption[] {
  const normalizedQuery = normalizeSkillSearchQuery(query)
  if (!normalizedQuery) return skills

  return skills.filter((skill) =>
    normalizeSkillSearchQuery([skill.name, skill.description].filter(Boolean).join(' ')).includes(
      normalizedQuery
    )
  )
}

export function buildInstalledSkillNameSet(skills: AgentSkillOption[]): Set<string> {
  return new Set(skills.map((skill) => normalizeSkillIdentity(skill.name)))
}

export function isSkillSearchResultInstalled(
  result: AgentSkillSearchResult,
  installedSkillNames: Set<string>
): boolean {
  return [result.installSkill, result.name]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => installedSkillNames.has(normalizeSkillIdentity(value)))
}

export function buildSkillInstallCommand(result: AgentSkillSearchResult): string {
  return [
    'npx',
    '-y',
    'skills',
    'add',
    shellQuote(result.installSource),
    '--yes',
    '--global',
    result.installSkill ? `--skill ${shellQuote(result.installSkill)}` : ''
  ]
    .filter(Boolean)
    .join(' ')
}

export function formatInstallCount(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`

  return String(value)
}

export function catalogSkillPageUrl(result: AgentSkillSearchResult): string {
  if (result.url?.trim()) return result.url.trim()
  const source = result.source.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '')
  const skillId = result.installSkill || result.name
  return `https://skills.sh/${source}/${skillId}`
}

export function skillFileLanguage(relativePath: string | undefined): string {
  const name = relativePath?.split('/').pop()?.toLowerCase() ?? ''
  if (!name || name === 'skill.md') return 'markdown'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'markdown'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash'
    case 'py':
      return 'python'
    case 'ts':
    case 'tsx':
      return 'ts'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'json':
      return 'json'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'toml':
      return 'toml'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'rb':
      return 'ruby'
    case 'ps1':
      return 'powershell'
    case 'bat':
    case 'cmd':
      return 'batch'
    case 'css':
      return 'css'
    case 'html':
    case 'htm':
      return 'html'
    case 'xml':
      return 'xml'
    case 'sql':
      return 'sql'
    default:
      return 'text'
  }
}

export function isSkillMarkdownFile(relativePath: string | undefined): boolean {
  return skillFileLanguage(relativePath) === 'markdown'
}

export function formatSkillFileAsMarkdownCode(relativePath: string, content: string): string {
  const language = skillFileLanguage(relativePath)
  const fence = '```'
  return `${fence}${language}\n${content.replace(/\n$/, '')}\n${fence}\n`
}

function normalizeSkillSearchQuery(value: string): string {
  return value.toLowerCase().replace(/[\s"'`,.:;/\\|()[\]{}_-]+/g, '')
}

function normalizeSkillIdentity(value: string): string {
  return value.toLowerCase().replace(/[\s_.-]+/g, '')
}
