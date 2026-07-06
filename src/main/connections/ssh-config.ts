import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

import type { ConnectionConfig } from '../agent/types'

export function loadSshConfigConnections(
  path = join(homedir(), '.ssh', 'config')
): ConnectionConfig[] {
  if (!existsSync(path)) return []

  const content = readFileSync(path, 'utf8')
  const connections: ConnectionConfig[] = []
  let currentHosts: string[] = []
  let currentConfig: Record<string, string> = {}

  const flush = (): void => {
    for (const hostAlias of currentHosts) {
      if (!hostAlias || hasPattern(hostAlias)) continue

      const hostName = currentConfig.hostname || hostAlias
      const port = Number(currentConfig.port)
      connections.push({
        id: `ssh-${createHash('sha1').update(hostAlias).digest('hex').slice(0, 12)}`,
        source: 'ssh-config',
        name: hostAlias,
        host: hostName,
        user: currentConfig.user,
        port: Number.isFinite(port) && port > 0 ? Math.round(port) : undefined,
        identityFile: currentConfig.identityfile,
        description: `~/.ssh/config Host ${hostAlias}`
      })
    }
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line) continue

    const [rawKey, ...rawValue] = line.split(/\s+/)
    const key = rawKey.toLowerCase()
    const value = rawValue.join(' ').trim()

    if (key === 'host') {
      flush()
      currentHosts = value.split(/\s+/)
      currentConfig = {}
      continue
    }

    if (currentHosts.length === 0) continue
    if (['hostname', 'user', 'port', 'identityfile'].includes(key)) {
      currentConfig[key] = value
    }
  }

  flush()
  return connections.sort((left, right) => left.name.localeCompare(right.name))
}

function hasPattern(host: string): boolean {
  return host.includes('*') || host.includes('?') || host.startsWith('!')
}
