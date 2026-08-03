import { useMemo } from 'react'

import { LOCAL_CONNECTION_ID } from '../lib/app-runtime'
import { buildSshCommand, parseLoginActions, parseSshOptions } from '../lib/connection-commands'
import { filterConnections } from '../lib/connections'
import type { ConnectionConfig, ConnectionInput } from '../../../shared/agent-types'

export function createEmptyConnectionForm(): ConnectionInput {
  return {
    name: '',
    host: '',
    user: '',
    password: '',
    passwordEnvVar: '',
    port: 22,
    identityFile: '',
    sshOptions: [],
    description: '',
    actions: []
  }
}

export function connectionToForm(connection: ConnectionConfig): ConnectionInput {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    user: connection.user,
    password: connection.password,
    passwordEnvVar: connection.passwordEnvVar,
    port: connection.port ?? 22,
    identityFile: connection.identityFile,
    sshOptions: connection.sshOptions,
    description: connection.description,
    actions: connection.actions
  }
}

export function normalizeConnectionInputForSave(
  connectionForm: ConnectionInput,
  connectionActionsText: string,
  connectionSshOptionsText: string
): ConnectionInput | null {
  const actions = parseLoginActions(connectionActionsText)
  const sshOptions = parseSshOptions(connectionSshOptionsText)
  const name = connectionForm.name.trim()
  const host = connectionForm.host.trim()

  if (!name || !host) return null

  return {
    id: connectionForm.id,
    name,
    host,
    user: connectionForm.user?.trim() || undefined,
    password: connectionForm.password?.trim() || undefined,
    passwordEnvVar: connectionForm.passwordEnvVar?.trim() || undefined,
    port: connectionForm.port || undefined,
    identityFile: connectionForm.identityFile?.trim() || undefined,
    sshOptions,
    description: connectionForm.description?.trim() || undefined,
    actions
  }
}

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
