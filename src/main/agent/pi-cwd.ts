import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

import { getCrescentDir } from '../crescent-paths'
import type { AgentConfig } from './types'

export function getDefaultWorkspaceCwd(): string {
  return join(getCrescentDir(), 'workspace')
}

export function resolveAgentWorkspaceCwd(config: Pick<AgentConfig, 'workspaceCwd'>): string {
  const configured = config.workspaceCwd?.trim()
  const cwd = configured
    ? resolve(configured.replace(/^~(?=$|[/\\])/, homedir()))
    : getDefaultWorkspaceCwd()

  ensureWorkspaceCwd(cwd)
  return cwd
}

export function ensureWorkspaceCwd(cwd: string): void {
  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true })
  }
}
