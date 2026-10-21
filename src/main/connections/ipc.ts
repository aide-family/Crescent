import { publicConnection, mergeConnectionSecrets } from '../renderer-secrets'
import { rendererIpc } from '../ipc-security'

import {
  deleteCustomConnection,
  readConnectionListMeta,
  readCustomConnections,
  readLastUsedConnectionId,
  reorderConnection,
  toggleConnectionFavorite,
  upsertCustomConnection,
  writeLastUsedConnectionId
} from '../crescent-store'
import { deleteOpsHistoryForConnection } from '../crescent-sqlite'
import type { ConnectionConfig, ConnectionInput } from '../agent/types'
import {
  applyConnectionListOrder,
  type ConnectionReorderAction
} from '../../shared/connection-list'
import { loadSshConfigConnections } from './ssh-config'
import { resolveRuntimeEnvValue } from './runtime-env'

const REORDER_ACTIONS = new Set<ConnectionReorderAction>(['up', 'down', 'top', 'bottom'])

export function registerConnectionIpc(): void {
  rendererIpc.handle('connections:list', async () => {
    return (await listConnections()).map(publicConnection)
  })

  rendererIpc.handle('connections:resolve', async (_, id: string) => {
    const connections = await listConnections({ forceRefreshSecrets: true })
    const connection = connections.find((connection) => connection.id === id)
    return connection && publicConnection(connection)
  })

  rendererIpc.handle('connections:save', async (_, input: ConnectionInput) => {
    const savedConnections = readCustomConnections()
    upsertCustomConnection(
      mergeConnectionSecrets(
        input,
        savedConnections.find((c) => c.id === input.id),
        savedConnections
      )
    )
    return (await listConnections()).map(publicConnection)
  })

  rendererIpc.handle('connections:delete', async (_, id: string) => {
    deleteCustomConnection(id)
    deleteOpsHistoryForConnection(id ?? '')
    return (await listConnections()).map(publicConnection)
  })

  rendererIpc.handle('connections:get-last-used', async () => {
    return readLastUsedConnectionId() ?? null
  })

  rendererIpc.handle('connections:set-last-used', async (_, id: string) => {
    writeLastUsedConnectionId(id)
    return readLastUsedConnectionId() ?? null
  })

  rendererIpc.handle('connections:toggle-favorite', async (_, id: unknown) => {
    const connectionId = String(id ?? '').trim()
    if (!connectionId) throw new Error('Missing connection id')
    const knownIds = await listKnownConnectionIds()
    if (!knownIds.includes(connectionId)) throw new Error(`Unknown connection id: ${connectionId}`)
    toggleConnectionFavorite(connectionId, knownIds)
    return (await listConnections()).map(publicConnection)
  })

  rendererIpc.handle('connections:reorder', async (_, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const connectionId = String(record.id ?? '').trim()
    const action = String(record.action ?? '').trim() as ConnectionReorderAction
    if (!connectionId) throw new Error('Missing connection id')
    if (!REORDER_ACTIONS.has(action)) throw new Error(`Invalid reorder action: ${action}`)
    const knownIds = await listKnownConnectionIds()
    if (!knownIds.includes(connectionId)) throw new Error(`Unknown connection id: ${connectionId}`)
    reorderConnection(connectionId, action, knownIds)
    return (await listConnections()).map(publicConnection)
  })
}

async function listKnownConnectionIds(): Promise<string[]> {
  const sshConfigConnections = loadSshConfigConnections()
  const customConnections = readCustomConnections()
  const seen = new Set<string>()
  const ids: string[] = []
  for (const connection of [...customConnections, ...sshConfigConnections]) {
    if (seen.has(connection.id)) continue
    seen.add(connection.id)
    ids.push(connection.id)
  }
  return ids
}

/** Exported for agent tools (connectionId picker). */
export async function listConnections(options?: {
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

  const meta = readConnectionListMeta()
  return applyConnectionListOrder(merged, meta)
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
