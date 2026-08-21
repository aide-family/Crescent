import { homedir } from 'os'
import { join, resolve } from 'path'

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

export function getCrescentDatabasePath(): string {
  return join(getCrescentDir(), 'crescent.db')
}
