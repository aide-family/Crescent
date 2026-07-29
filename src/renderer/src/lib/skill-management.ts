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

function normalizeSkillSearchQuery(value: string): string {
  return value.toLowerCase().replace(/[\s"'`,.:;/\\|()[\]{}_-]+/g, '')
}

function normalizeSkillIdentity(value: string): string {
  return value.toLowerCase().replace(/[\s_.-]+/g, '')
}
