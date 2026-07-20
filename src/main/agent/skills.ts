import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { spawn } from 'child_process'
import { homedir, tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'

import type {
  AgentSkillContext,
  AgentSkillInstallResult,
  AgentSkillOption,
  AgentSkillSearchResult
} from './types'

const MAX_MATCHED_SKILLS = 3
const MAX_SKILL_CONTENT_CHARS = 16_000
const DEFAULT_SKILL_ROOT = '~/.agents/skills'
const ESCAPE_CHAR = String.fromCharCode(27)
const BELL_CHAR = String.fromCharCode(7)
const ANSI_CSI_PATTERN = new RegExp(`${ESCAPE_CHAR}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(
  `${ESCAPE_CHAR}\\][^${BELL_CHAR}]*(?:${BELL_CHAR}|${ESCAPE_CHAR}\\\\)`,
  'g'
)

interface SkillInstallRunOptions {
  onOutput?: (chunk: string) => void
  signal?: AbortSignal
}

interface SkillInstallCommandResult {
  ok: boolean
  output: string
  canceled?: boolean
}

export interface AgentSkillInstallSession {
  promise: Promise<AgentSkillInstallResult>
  cancel: () => void
}

export function listAgentSkills(skillRoot?: string): AgentSkillOption[] {
  const seen = new Set<string>()
  const skills: AgentSkillOption[] = []
  const root = resolveSkillRoot(skillRoot)

  for (const path of findSkillFiles(root)) {
    if (seen.has(path)) continue
    seen.add(path)
    skills.push(readSkill(path, root))
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
  skillRoot?: string
}): Promise<AgentSkillInstallResult> {
  return installAgentSkillWithOutput(input)
}

export function startAgentSkillInstall(
  input: { installSource?: string; installSkill?: string; skillRoot?: string },
  onOutput: (chunk: string) => void
): AgentSkillInstallSession {
  const controller = new AbortController()

  return {
    promise: installAgentSkillWithOutput(input, {
      onOutput,
      signal: controller.signal
    }),
    cancel: () => controller.abort()
  }
}

async function installAgentSkillWithOutput(
  input: {
    installSource?: string
    installSkill?: string
    skillRoot?: string
  },
  options: SkillInstallRunOptions = {}
): Promise<AgentSkillInstallResult> {
  const installSource = input.installSource?.trim()
  if (!installSource) throw new Error('Skill install source is empty.')

  const installSkill = input.installSkill?.trim()
  const beforeInstallPaths = new Set(listAgentSkills(input.skillRoot).map((skill) => skill.path))

  const firstAttempt = await runSkillInstallCommand(
    installSource,
    installSkill,
    input.skillRoot,
    options
  )
  if (firstAttempt.canceled) throw new Error('Skill install canceled.')

  if (firstAttempt.ok) {
    return {
      ok: true,
      output: firstAttempt.output,
      skills: listAgentSkills(input.skillRoot)
    }
  }

  const skillsAfterFirstAttempt = listAgentSkills(input.skillRoot)
  if (wasSkillInstalled(skillsAfterFirstAttempt, installSkill, installSource)) {
    return {
      ok: true,
      output: firstAttempt.output,
      skills: skillsAfterFirstAttempt
    }
  }

  if (installSkill && isMissingRequestedSkill(firstAttempt.output)) {
    const fallbackAttempt = await runSkillInstallCommand(
      installSource,
      undefined,
      input.skillRoot,
      options
    )
    if (fallbackAttempt.canceled) throw new Error('Skill install canceled.')

    const skillsAfterFallback = listAgentSkills(input.skillRoot)
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

function runSkillInstallCommand(
  installSource: string,
  installSkill?: string,
  skillRoot?: string,
  options: SkillInstallRunOptions = {}
): Promise<SkillInstallCommandResult> {
  const gitUrl = normalizeGitInstallSource(installSource)
  if (gitUrl) {
    return runGitSkillInstallCommand(gitUrl, installSource, installSkill, skillRoot, options)
  }

  return runSkillsCliInstallCommand(installSource, installSkill, skillRoot, options)
}

async function runGitSkillInstallCommand(
  gitUrl: string,
  installSource: string,
  installSkill?: string,
  skillRoot?: string,
  options: SkillInstallRunOptions = {}
): Promise<SkillInstallCommandResult> {
  const resolvedSkillRoot = resolveSkillRoot(skillRoot)
  const tempDir = mkdtempSync(join(tmpdir(), 'crescent-skill-'))
  let output = `git clone --depth 1 ${gitUrl}\n`
  options.onOutput?.(output)

  try {
    const cloneResult = await runSpawnCommand(
      'git',
      ['clone', '--depth', '1', gitUrl, tempDir],
      options
    )
    output += cloneResult.output
    if (cloneResult.canceled || !cloneResult.ok) return cloneResult

    mkdirSync(resolvedSkillRoot, { recursive: true })
    const skillDirectories = findSkillDirectories(tempDir)
    const selectedSkillDirectories = selectInstallSkillDirectories(skillDirectories, installSkill)
    if (selectedSkillDirectories.length === 0) {
      return {
        ok: false,
        output: sanitizeInstallOutput(
          [
            output,
            installSkill
              ? `No matching skills found for: ${installSkill}`
              : `No SKILL.md files found in ${installSource}`
          ].join('\n')
        )
      }
    }

    for (const directory of selectedSkillDirectories) {
      const skillPath = join(directory, 'SKILL.md')
      const content = readFileSync(skillPath, 'utf8')
      const skillName = extractSkillName(content) || basename(directory)
      const destination = join(resolvedSkillRoot, sanitizeSkillDirectoryName(skillName))
      options.onOutput?.(`\nInstalling ${skillName} -> ${destination}\n`)
      rmSync(destination, { recursive: true, force: true })
      cpSync(directory, destination, { recursive: true })
      output += `\nInstalled ${skillName} -> ${destination}\n`
    }

    return { ok: true, output: sanitizeInstallOutput(output) }
  } catch (error) {
    return {
      ok: false,
      output: sanitizeInstallOutput(
        [output, error instanceof Error ? error.message : String(error)].join('\n')
      )
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function runSkillsCliInstallCommand(
  installSource: string,
  installSkill?: string,
  skillRoot?: string,
  options: SkillInstallRunOptions = {}
): Promise<SkillInstallCommandResult> {
  const args = ['-y', 'skills', 'add', installSource, '--yes', '--global']
  if (installSkill) args.push('--skill', installSkill)
  const resolvedSkillRoot = resolveSkillRoot(skillRoot)
  const skillHome =
    basename(resolvedSkillRoot) === 'skills' ? dirname(resolvedSkillRoot) : undefined
  let stdout = ''
  let stderr = ''

  return new Promise((resolveResult) => {
    if (options.signal?.aborted) {
      resolveResult({ ok: false, output: 'Skill install canceled.', canceled: true })
      return
    }

    const child = spawn('npx', args, {
      env: {
        ...process.env,
        ...(skillHome ? { CODEX_HOME: skillHome, AGENTS_HOME: skillHome } : {}),
        CRESCENT_SKILL_ROOT: resolvedSkillRoot
      },
      stdio: 'pipe'
    })
    let settled = false
    let canceled = false
    let forceKillTimeout: NodeJS.Timeout | undefined

    const settle = (result: SkillInstallCommandResult): void => {
      if (settled) return

      settled = true
      clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
      options.signal?.removeEventListener('abort', cancel)
      resolveResult(result)
    }

    const appendOutput = (kind: 'stdout' | 'stderr', data: Buffer): void => {
      const chunk = data.toString()
      if (kind === 'stdout') stdout += chunk
      else stderr += chunk

      options.onOutput?.(sanitizeInstallChunk(chunk))
    }

    const cancel = (): void => {
      canceled = true
      options.onOutput?.('\nSkill install canceled by user.\n')
      child.kill('SIGTERM')
      forceKillTimeout = setTimeout(() => {
        if (settled || !child.pid) return

        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Process already exited.
        }
      }, 2500)
    }

    const timeout = setTimeout(() => {
      canceled = true
      options.onOutput?.('\nSkill install timed out and was canceled.\n')
      child.kill('SIGTERM')
      forceKillTimeout = setTimeout(() => {
        if (settled || !child.pid) return

        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Process already exited.
        }
      }, 2500)
    }, 180_000)

    options.signal?.addEventListener('abort', cancel, { once: true })

    child.stdout.on('data', (data: Buffer) => appendOutput('stdout', data))
    child.stderr.on('data', (data: Buffer) => appendOutput('stderr', data))
    child.on('error', (error) => {
      settle({
        ok: false,
        output: sanitizeInstallOutput([stdout, stderr, error.message].filter(Boolean).join('\n')),
        canceled
      })
    })
    child.on('close', (code) => {
      settle({
        ok: !canceled && code === 0,
        output: sanitizeInstallOutput([stdout, stderr].filter(Boolean).join('\n')),
        canceled
      })
    })
  })
}

function runSpawnCommand(
  command: string,
  args: string[],
  options: SkillInstallRunOptions = {}
): Promise<SkillInstallCommandResult> {
  let stdout = ''
  let stderr = ''

  return new Promise((resolveResult) => {
    if (options.signal?.aborted) {
      resolveResult({ ok: false, output: 'Skill install canceled.', canceled: true })
      return
    }

    const child = spawn(command, args, { stdio: 'pipe' })
    let settled = false
    let canceled = false
    let forceKillTimeout: NodeJS.Timeout | undefined

    const settle = (result: SkillInstallCommandResult): void => {
      if (settled) return

      settled = true
      clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
      options.signal?.removeEventListener('abort', cancel)
      resolveResult(result)
    }

    const cancel = (): void => {
      canceled = true
      options.onOutput?.('\nSkill install canceled by user.\n')
      child.kill('SIGTERM')
      forceKillTimeout = setTimeout(() => {
        if (settled || !child.pid) return

        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Process already exited.
        }
      }, 2500)
    }

    const timeout = setTimeout(() => {
      canceled = true
      options.onOutput?.('\nSkill install timed out and was canceled.\n')
      child.kill('SIGTERM')
      forceKillTimeout = setTimeout(() => {
        if (settled || !child.pid) return

        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // Process already exited.
        }
      }, 2500)
    }, 180_000)

    const appendOutput = (kind: 'stdout' | 'stderr', data: Buffer): void => {
      const chunk = data.toString()
      if (kind === 'stdout') stdout += chunk
      else stderr += chunk

      options.onOutput?.(sanitizeInstallChunk(chunk))
    }

    options.signal?.addEventListener('abort', cancel, { once: true })
    child.stdout.on('data', (data: Buffer) => appendOutput('stdout', data))
    child.stderr.on('data', (data: Buffer) => appendOutput('stderr', data))
    child.on('error', (error) => {
      settle({
        ok: false,
        output: sanitizeInstallOutput([stdout, stderr, error.message].filter(Boolean).join('\n')),
        canceled
      })
    })
    child.on('close', (code) => {
      settle({
        ok: !canceled && code === 0,
        output: sanitizeInstallOutput([stdout, stderr].filter(Boolean).join('\n')),
        canceled
      })
    })
  })
}

function normalizeGitInstallSource(source: string): string | undefined {
  const trimmed = source.trim()
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}.git`
  if (/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(trimmed)) {
    return trimmed.endsWith('.git') ? trimmed : `${trimmed}.git`
  }
  if (/^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(trimmed)) {
    return trimmed.endsWith('.git') ? trimmed : `${trimmed}.git`
  }

  return undefined
}

function findSkillDirectories(root: string, depth = 0): string[] {
  if (depth > 5 || !existsSync(root)) return []
  if (existsSync(join(root, 'SKILL.md'))) return [root]

  const directories: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue

    directories.push(...findSkillDirectories(join(root, entry.name), depth + 1))
  }

  return directories
}

function selectInstallSkillDirectories(
  directories: string[],
  installSkill: string | undefined
): string[] {
  if (!installSkill) return directories

  const normalizedInstallSkill = normalizeSkillName(installSkill)
  return directories.filter((directory) => {
    const content = readFileSync(join(directory, 'SKILL.md'), 'utf8')
    const skillName = extractSkillName(content) || basename(directory)

    return (
      normalizeSkillName(skillName) === normalizedInstallSkill ||
      normalizeSkillName(basename(directory)) === normalizedInstallSkill
    )
  })
}

function sanitizeSkillDirectoryName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'skill'
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

function sanitizeInstallChunk(value: string): string {
  return value
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')
    .replace(/\r/g, '\n')
    .replace(/\[[0-9]+[A-Z]/g, '')
}

export function deleteAgentSkill(path: string, skillRoot?: string): AgentSkillOption[] {
  const skillPath = resolve(path)
  const skill = listAgentSkills(skillRoot).find(
    (candidate) => resolve(candidate.path) === skillPath
  )
  if (!skill) throw new Error('Skill not found.')
  if (!skill.removable) throw new Error('This skill is protected and cannot be deleted.')

  rmSync(dirname(skillPath), { recursive: true, force: false })
  return listAgentSkills(skillRoot)
}

export function buildAgentSkillContext(input: string, skillRoot?: string): AgentSkillContext {
  const catalog = listAgentSkills(skillRoot)
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

  return resolvedPath.startsWith(`${resolvedRoot}/`)
}

function resolveSkillRoot(value: string | undefined): string {
  const trimmed = value?.trim() || DEFAULT_SKILL_ROOT
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))

  return resolve(trimmed)
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
