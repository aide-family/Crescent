import { ipcMain } from 'electron'

import {
  deleteCustomConnection,
  readCustomConnections,
  upsertCustomConnection
} from '../crescent-store'
import type { ConnectionConfig, ConnectionInput } from '../agent/types'
import { loadSshConfigConnections } from './ssh-config'

export function registerConnectionIpc(): void {
  ipcMain.handle('connections:list', () => {
    return listConnections()
  })

  ipcMain.handle('connections:save', (_, input: ConnectionInput) => {
    upsertCustomConnection(input)
    return listConnections()
  })

  ipcMain.handle('connections:delete', (_, id: string) => {
    deleteCustomConnection(id)
    return listConnections()
  })
}

function listConnections(): ConnectionConfig[] {
  const sshConfigConnections = loadSshConfigConnections()
  const customConnections = readCustomConnections()
  const seen = new Set<string>()
  const merged: ConnectionConfig[] = []

  for (const connection of [...sshConfigConnections, ...customConnections]) {
    if (seen.has(connection.id)) continue
    seen.add(connection.id)
    merged.push(connection)
  }

  return merged.sort((left, right) => {
    if (left.source !== right.source) return left.source === 'custom' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}
