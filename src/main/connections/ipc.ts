import { ipcMain } from 'electron'

import {
  deleteCustomConnection,
  readCustomConnections,
  readLastUsedConnectionId,
  upsertCustomConnection,
  writeLastUsedConnectionId
} from '../crescent-store'
import { deleteOpsHistoryForConnection } from '../crescent-sqlite'
import type { ConnectionConfig, ConnectionInput } from '../agent/types'
import { loadSshConfigConnections } from './ssh-config'
import { resolveRuntimeEnvValue } from './runtime-env'

export function registerConnectionIpc(): void {
  ipcMain.handle('connections:list', async () => {
    return listConnections()
  })

  ipcMain.handle('connections:resolve', async (_, id: string) => {
    const connections = await listConnections({ forceRefreshSecrets: true })
    return connections.find((connection) => connection.id === id)
  })

  ipcMain.handle('connections:save', async (_, input: ConnectionInput) => {
    upsertCustomConnection(input)
    return listConnections()
  })

  ipcMain.handle('connections:delete', async (_, id: string) => {
    deleteCustomConnection(id)
    deleteOpsHistoryForConnection(id ?? '')
    return listConnections()
  })

  ipcMain.handle('connections:get-last-used', async () => {
    return readLastUsedConnectionId() ?? null
  })

  ipcMain.handle('connections:set-last-used', async (_, id: string) => {
    writeLastUsedConnectionId(id)
    return readLastUsedConnectionId() ?? null
  })
}

async function listConnections(options?: {
  forceRefreshSecrets?: boolean
}): Promise<ConnectionConfig[]> {
  const sshConfigConnections = loadSshConfigConnections()
  const customConnections = readCustomConnections()
  const seen = new Set<string>()
  const candidates: ConnectionConfig[] = []

  for (const connection of [...customConnections, ...sshConfigConnections]) {
    if (seen.has(connection.id)) continue
    seen.add(connection.id)
    candidates.push(connection)
  }

  const merged = await Promise.all(
    candidates.map((connection) =>
      resolveConnectionRuntimeSecrets(connection, options?.forceRefreshSecrets)
    )
  )

  return merged.sort((left, right) => {
    if (left.source !== right.source) return left.source === 'custom' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

async function resolveConnectionRuntimeSecrets(
  connection: ConnectionConfig,
  forceRefresh = false
): Promise<ConnectionConfig> {
  const envName = connection.passwordEnvVar?.trim()
  if (!envName || connection.password) return connection

  const resolvedPassword = await resolveRuntimeEnvValue(envName, { forceRefresh })
  return resolvedPassword ? { ...connection, resolvedPassword } : connection
}
