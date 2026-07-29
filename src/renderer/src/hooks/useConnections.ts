import { useMemo } from 'react'

import { buildSshCommand, parseSshOptions } from '@renderer/lib/connection-commands'
import { filterConnections } from '@renderer/lib/connections'
import { LOCAL_CONNECTION_ID } from '@renderer/lib/app-runtime'
import type { ConnectionConfig, ConnectionInput } from '../../../shared/agent-types'

interface UseConnectionsInput {
  connections: ConnectionConfig[]
  query: string
  connectionForm: ConnectionInput
  connectionSshOptionsText: string
  localTerminalLabel: string
  localTerminalDescription: string
}

export function useConnections({
  connections,
  query,
  connectionForm,
  connectionSshOptionsText,
  localTerminalLabel,
  localTerminalDescription
}: UseConnectionsInput): {
  localConnection: ConnectionConfig
  displayConnections: ConnectionConfig[]
  filteredDisplayConnections: ConnectionConfig[]
  connectionFormReady: boolean
  connectionCommandPreview: string
} {
  const localConnection = useMemo<ConnectionConfig>(
    () => ({
      id: LOCAL_CONNECTION_ID,
      source: 'local',
      name: localTerminalLabel,
      host: '~',
      description: localTerminalDescription
    }),
    [localTerminalDescription, localTerminalLabel]
  )

  const displayConnections = useMemo(
    () => [localConnection, ...connections],
    [connections, localConnection]
  )

  const filteredDisplayConnections = useMemo(
    () => filterConnections(displayConnections, query),
    [displayConnections, query]
  )

  const connectionFormReady = useMemo(
    () => Boolean(connectionForm.name.trim() && connectionForm.host.trim()),
    [connectionForm.host, connectionForm.name]
  )

  const connectionCommandPreview = useMemo(() => {
    const host = connectionForm.host.trim()
    if (!host) return ''

    return buildSshCommand({
      id: connectionForm.id || 'preview',
      source: 'custom',
      name: connectionForm.name.trim() || 'preview',
      host,
      user: connectionForm.user?.trim() || undefined,
      port: connectionForm.port || undefined,
      identityFile: connectionForm.identityFile?.trim() || undefined,
      sshOptions: parseSshOptions(connectionSshOptionsText)
    })
  }, [connectionForm, connectionSshOptionsText])

  return {
    localConnection,
    displayConnections,
    filteredDisplayConnections,
    connectionFormReady,
    connectionCommandPreview
  }
}
