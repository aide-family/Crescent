import { homedir } from 'os'
import { join } from 'path'

export function getCrescentDir(): string {
  return join(homedir(), '.crescent')
}

export function getCrescentConfigPath(): string {
  return join(getCrescentDir(), 'config.json')
}

export function getCrescentMemoryPath(): string {
  return join(getCrescentDir(), 'memory.json')
}

export function getCrescentWikiDir(): string {
  return join(getCrescentDir(), 'wiki')
}

export function getCrescentDatabasePath(): string {
  return join(getCrescentDir(), 'crescent.db')
}
