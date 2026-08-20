import { homedir } from 'os'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'

export function getCrescentDir(): string {
  return join(homedir(), '.crescent')
}

export function getCrescentConfigPath(): string {
  return join(getCrescentDir(), 'config.json')
}

export function getCrescentMemoryPath(): string {
  return join(getCrescentDir(), 'memory.json')
}

export function getCrescentAttachmentsDir(): string {
  return join(getCrescentDir(), 'attachments')
}

export function getCrescentWikiDir(): string {
  return join(getCrescentDir(), 'wiki')
}

export function getCrescentLogsDir(): string {
  const override = process.env.CRESCENT_LOG_DIR?.trim()
  if (override) return resolve(override)
  return join(getCrescentDir(), 'logs')
}

export const CRESCENT_USER_SKILLS_TILDE = '~/.crescent/skills'
export const GLOBAL_AGENT_SKILLS_TILDE = '~/.agents/skills'

export function getCrescentUserSkillsDir(): string {
  return join(getCrescentDir(), 'skills')
}

export function getGlobalAgentSkillsDir(): string {
  return join(homedir(), '.agents', 'skills')
}

export function getCrescentSystemSkillsDir(): string {
  const override = process.env.CRESCENT_SYSTEM_SKILL_ROOT?.trim()
  if (override) return resolve(override)

  const resourceSystemSkillsDir = process.resourcesPath
    ? join(process.resourcesPath, 'system-skills')
    : ''
  if (resourceSystemSkillsDir && existsSync(resourceSystemSkillsDir)) {
    return resourceSystemSkillsDir
  }

  return join(getCrescentProjectRoot(), 'system-skills')
}

export function getCrescentDatabasePath(): string {
  return join(getCrescentDir(), 'crescent.db')
}

export function getCrescentProjectRoot(): string {
  const override = process.env.CRESCENT_PROJECT_ROOT?.trim()
  if (override) return resolve(override)

  const candidates = [
    process.cwd(),
    process.resourcesPath ? join(process.resourcesPath, 'app.asar') : '',
    process.resourcesPath ? join(process.resourcesPath, 'app') : '',
    resolve(__dirname, '..', '..')
  ].filter(Boolean)

  for (const candidate of candidates) {
    const root = findProjectRoot(candidate)
    if (root) return root
  }

  return process.cwd()
}

function findProjectRoot(start: string): string | undefined {
  let current = resolve(start)

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'system-skills'))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return undefined
}
