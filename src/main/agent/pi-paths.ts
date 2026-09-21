import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { getCrescentDir } from '../crescent-paths'

export function getCrescentPiAgentDir(): string {
  const dir = join(getCrescentDir(), 'pi-agent')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getCrescentPiAuthPath(): string {
  return join(getCrescentPiAgentDir(), 'auth.json')
}

export function getCrescentPiModelsPath(): string {
  return join(getCrescentPiAgentDir(), 'models.json')
}

export function getCrescentPiSkillsDir(): string {
  const dir = join(getCrescentPiAgentDir(), 'skills')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}
