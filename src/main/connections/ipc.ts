import { ipcMain } from 'electron'

import {
  deleteCustomConnection,
  readCustomConnections,
  upsertCustomConnection
} from '../crescent-store'
import type { ConnectionConfig, ConnectionInput } from '../agent/types'
import { loadSshConfigConnections } from './ssh-config'
import { resolveRuntimeEnvValue } from './runtime-env'

export function registerConnectionIpc(): void {
  ipcMain.handle('connections:list', async () => {
    return listConnections()
  })

  ipcMain.handle('connections:save', async (_, input: ConnectionInput) => {
    upsertCustomConnection(input)
    return listConnections()
  })

  ipcMain.handle('connections:delete', async (_, id: string) => {
    deleteCustomConnection(id)
    return listConnections()
  })
}

async function listConnections(): Promise<ConnectionConfig[]> {
  const sshConfigConnections = loadSshConfigConnections()
  const customConnections = readCustomConnections()
  const seen = new Set<string>()
  const candidates: ConnectionConfig[] = []

  for (const connection of [...customConnections, ...sshConfigConnections]) {
    if (seen.has(connection.id)) continue
    seen.add(connection.id)
    candidates.push(connection)
  }

  const merged = await Promise.all(candidates.map(resolveConnectionRuntimeSecrets))

  return merged.sort((left, right) => {
    if (left.source !== right.source) return left.source === 'custom' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

async function resolveConnectionRuntimeSecrets(
  connection: ConnectionConfig
): Promise<ConnectionConfig> {
  const envName = connection.passwordEnvVar?.trim()
  if (!envName || connection.password) return connection

  const resolvedPassword = await resolveRuntimeEnvValue(envName)
  return resolvedPassword ? { ...connection, resolvedPassword } : connection
}
