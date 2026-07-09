import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { execFile } from 'child_process'
import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { promisify } from 'util'

import type {
  AgentSkillContext,
  AgentSkillInstallResult,
  AgentSkillOption,
  AgentSkillSearchResult
} from './types'

const MAX_MATCHED_SKILLS = 3
const MAX_SKILL_CONTENT_CHARS = 16_000
const execFileAsync = promisify(execFile)
const SKILL_ROOTS = [
  join(homedir(), '.codex', 'skills'),
  join(homedir(), '.codex', 'skills', '.system'),
  join(homedir(), '.agents', 'skills'),
  join(homedir(), '.codex', '.agents', 'skills')
]
const PROTECTED_SKILL_ROOTS = new Set([join(homedir(), '.codex', 'skills', '.system')])
const ESCAPE_CHAR = String.fromCharCode(27)
const BELL_CHAR = String.fromCharCode(7)
const ANSI_CSI_PATTERN = new RegExp(`${ESCAPE_CHAR}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(
  `${ESCAPE_CHAR}\\][^${BELL_CHAR}]*(?:${BELL_CHAR}|${ESCAPE_CHAR}\\\\)`,
  'g'
)

export function listAgentSkills(): AgentSkillOption[] {
  const seen = new Set<string>()
  const skills: AgentSkillOption[] = []

  for (const root of SKILL_ROOTS) {
    for (const path of findSkillFiles(root)) {
      if (seen.has(path)) continue
      seen.add(path)
      skills.push(readSkill(path, root))
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

export async function searchAgentSkills(query: string): Promise<AgentSkillSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const response = await fetch(`https://www.skills.sh/api/search?q=${encodeURIComponent(trimmed)}`)
  if (!response.ok) {
    throw new Error(`skills.sh search failed: ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as unknown
  return normalizeSkillSearchResults(payload).slice(0, 30)
}

export async function installAgentSkill(input: {
  installSource?: string
  installSkill?: string
}): Promise<AgentSkillInstallResult> {
  const installSource = input.installSource?.trim()
  if (!installSource) throw new Error('Skill install source is empty.')

  const installSkill = input.installSkill?.trim()
  const beforeInstallPaths = new Set(listAgentSkills().map((skill) => skill.path))

  const firstAttempt = await runSkillInstallCommand(installSource, installSkill)
  if (firstAttempt.ok) {
    return {
      ok: true,
      output: firstAttempt.output,
      skills: listAgentSkills()
    }
  }

  const skillsAfterFirstAttempt = listAgentSkills()
  if (wasSkillInstalled(skillsAfterFirstAttempt, installSkill, installSource)) {
    return {
      ok: true,
      output: firstAttempt.output,
      skills: skillsAfterFirstAttempt
    }
  }

  if (installSkill && isMissingRequestedSkill(firstAttempt.output)) {
    const fallbackAttempt = await runSkillInstallCommand(installSource)
    const skillsAfterFallback = listAgentSkills()
    if (fallbackAttempt.ok || hasNewInstalledSkill(skillsAfterFallback, beforeInstallPaths)) {
      return {
        ok: true,
        output: [firstAttempt.output, fallbackAttempt.output].filter(Boolean).join('\n\n'),
        skills: skillsAfterFallback,
        fallbackInstalledAll: true,
        requestedSkill: installSkill
      }
    }

    throw new Error([firstAttempt.output, fallbackAttempt.output].filter(Boolean).join('\n\n'))
  }

  throw new Error(firstAttempt.output)
}

async function runSkillInstallCommand(
  installSource: string,
  installSkill?: string
): Promise<{ ok: boolean; output: string }> {
  const args = ['-y', 'skills', 'add', installSource, '--yes', '--global']
  if (installSkill) args.push('--skill', installSkill)
  let stdout = ''
  let stderr = ''

  try {
    const result = await execFileAsync('npx', args, {
      timeout: 180_000,
      maxBuffer: 1024 * 1024
    })
    stdout = result.stdout
    stderr = result.stderr
  } catch (error) {
    return {
      ok: false,
      output:
        normalizeExecErrorOutput(error) || (error instanceof Error ? error.message : String(error))
    }
  }

  return {
    ok: true,
    output: sanitizeInstallOutput([stdout, stderr].filter(Boolean).join('\n'))
  }
}

function normalizeExecErrorOutput(error: unknown): string {
  if (!isRecord(error)) return ''

  return sanitizeInstallOutput(
    [error['message'], error['stdout'], error['stderr']]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
  )
}

function wasSkillInstalled(
  skills: AgentSkillOption[],
  installSkill: string | undefined,
  installSource: string
): boolean {
  const expectedNames = new Set(
    [installSkill, inferSkillNameFromInstallSource(installSource)]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalizeSkillName)
  )

  return skills.some((skill) => expectedNames.has(normalizeSkillName(skill.name)))
}

function hasNewInstalledSkill(skills: AgentSkillOption[], previousPaths: Set<string>): boolean {
  return skills.some((skill) => !previousPaths.has(skill.path))
}

function isMissingRequestedSkill(output: string): boolean {
  return /No matching skills found for:/i.test(output)
}

function inferSkillNameFromInstallSource(installSource: string): string {
  return basename(installSource.replace(/\.git$/, '')).replace(/-skill$/, '')
}

function normalizeSkillName(value: string): string {
  return value.toLowerCase().replace(/[\s_.-]+/g, '')
}

function sanitizeInstallOutput(value: string): string {
  return value
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\[[0-9]+[A-Z]/g, '').trimEnd())
    .filter((line, index, lines) => line.trim() || lines[index - 1]?.trim())
    .join('\n')
    .trim()
}

export function deleteAgentSkill(path: string): AgentSkillOption[] {
  const skillPath = resolve(path)
  const skill = listAgentSkills().find((candidate) => resolve(candidate.path) === skillPath)
  if (!skill) throw new Error('Skill not found.')
  if (!skill.removable) throw new Error('This skill is protected and cannot be deleted.')

  rmSync(dirname(skillPath), { recursive: true, force: false })
  return listAgentSkills()
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
    source: root,
    removable: isRemovableSkillPath(path, root)
  }
}

function isRemovableSkillPath(path: string, root: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  if (PROTECTED_SKILL_ROOTS.has(root)) return false

  return resolvedPath.startsWith(`${resolvedRoot}/`)
}

function normalizeSkillSearchResults(payload: unknown): AgentSkillSearchResult[] {
  const candidates = extractSkillSearchCandidates(payload)
  const seen = new Set<string>()
  const results: AgentSkillSearchResult[] = []

  for (const candidate of candidates) {
    const result = normalizeSkillSearchResult(candidate)
    if (!result) continue
    const key = `${result.installSource}#${result.installSkill ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push(result)
  }

  return results
}

function extractSkillSearchCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []

  for (const key of ['skills', 'results', 'items', 'data']) {
    const value = payload[key]
    if (Array.isArray(value)) return value
  }

  return Object.values(payload).flatMap((value) => extractSkillSearchCandidates(value))
}

function normalizeSkillSearchResult(value: unknown): AgentSkillSearchResult | undefined {
  if (!isRecord(value)) return undefined

  const name = stringField(value, ['name', 'skill', 'title', 'slug'])
  const description = stringField(value, ['description', 'summary', 'readme']) ?? ''
  const source =
    stringField(value, ['source', 'package', 'repository', 'repo', 'ownerRepo']) ??
    inferSourceFromUrl(stringField(value, ['url', 'href', 'htmlUrl', 'githubUrl']))
  const url = stringField(value, ['url', 'href', 'htmlUrl', 'skillUrl'])
  const installCommand = stringField(value, ['installCommand', 'install', 'command'])
  const parsedInstall = parseSkillInstallCommand(installCommand)
  const installSource =
    parsedInstall.installSource ??
    stringField(value, ['installSource']) ??
    inferInstallSource(value, source, url)
  const installSkill =
    parsedInstall.installSkill ??
    stringField(value, ['installSkill', 'skillName']) ??
    inferInstallSkill(value, name)

  if (!name || !installSource) return undefined

  return {
    id: `${installSource}:${installSkill ?? name}`,
    name,
    description: description.slice(0, 260),
    source: source ?? installSource,
    url,
    installSource,
    installSkill,
    installs: numberField(value, ['installs', 'installCount', 'downloads'])
  }
}

function parseSkillInstallCommand(command: string | undefined): {
  installSource?: string
  installSkill?: string
} {
  if (!command) return {}

  const source = command.match(/\bskills\s+add\s+(\S+)/)?.[1]
  const skill = command.match(/--skill\s+(\S+)/)?.[1]
  return { installSource: source, installSkill: skill }
}

function inferInstallSource(
  value: Record<string, unknown>,
  source: string | undefined,
  url: string | undefined
): string | undefined {
  const githubUrl = stringField(value, ['githubUrl', 'repositoryUrl', 'repoUrl'])
  if (githubUrl) return githubUrl
  if (source && /^[\w.-]+\/[\w.-]+$/.test(source)) return source

  return inferSourceFromUrl(url)
}

function inferInstallSkill(
  value: Record<string, unknown>,
  name: string | undefined
): string | undefined {
  const explicit = stringField(value, ['skill', 'slug'])
  if (explicit && explicit !== name) return explicit
  if (value['skills'] || value['skillCount']) return undefined

  return name
}

function inferSourceFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined

  const githubMatch = url.match(/github\.com\/([^/?#]+\/[^/?#]+)/)
  if (githubMatch) return `https://github.com/${githubMatch[1].replace(/\.git$/, '')}`

  const skillsMatch = url.match(/skills\.sh\/([^/?#]+\/[^/?#]+)/)
  if (skillsMatch) return skillsMatch[1]

  return undefined
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return undefined
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(record[key])
    if (Number.isFinite(value)) return value
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
