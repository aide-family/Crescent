import { useMemo } from 'react'

import type { Dictionary } from '@renderer/i18n'
import { LOCAL_CONNECTION_ID } from '../lib/app-runtime'
import { buildSshCommand, parseLoginActions, parseSshOptions } from '../lib/connection-commands'
import { filterConnections } from '../lib/connections'
import type { ConnectionConfig, ConnectionInput } from '../../../shared/agent-types'
import {
  MAX_CLUSTER_HOST_REGEX_LENGTH,
  validateClusterHostRegex,
  type ClusterHostPatternReason,
  type ClusterHostPatternValidation
} from '../../../shared/connection-state'

export type ConnectionSaveInputResult =
  | { ok: true; value: ConnectionInput }
  | {
      ok: false
      reason: 'missing-name' | 'missing-host' | 'invalid-cluster-regex'
      detail?: string
      clusterReason?: ClusterHostPatternReason
    }

export function createEmptyConnectionForm(): ConnectionInput {
  return {
    name: '',
    host: '',
    user: '',
    password: '',
    passwordEnvVar: '',
    rootPassword: '',
    port: 22,
    identityFile: '',
    sshOptions: [],
    description: '',
    actions: [],
    clusterHostRegex: ''
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
    rootPassword: connection.rootPassword,
    port: connection.port ?? 22,
    identityFile: connection.identityFile,
    sshOptions: connection.sshOptions,
    description: connection.description,
    actions: connection.actions,
    clusterHostRegex: connection.clusterHostRegex ?? ''
  }
}

export function formatClusterHostPatternError(
  result: Extract<ClusterHostPatternValidation, { ok: false }>,
  t: Dictionary
): string {
  if (result.reason === 'too-long') {
    return t.connections.clusterHostRegexTooLong.replace(
      '{max}',
      String(MAX_CLUSTER_HOST_REGEX_LENGTH)
    )
  }
  if (result.reason === 'too-complex') return t.connections.clusterHostRegexTooComplex
  return t.connections.clusterHostRegexInvalid
}

export function formatConnectionSaveError(
  result: Extract<ConnectionSaveInputResult, { ok: false }>,
  t: Dictionary
): string {
  if (result.reason === 'missing-name') return t.connections.saveMissingName
  if (result.reason === 'missing-host') return t.connections.saveMissingHost
  return formatClusterHostPatternError(
    {
      ok: false,
      reason: result.clusterReason ?? 'invalid',
      error: result.detail ?? ''
    },
    t
  )
}

export function normalizeConnectionInputForSave(
  connectionForm: ConnectionInput,
  connectionActionsText: string,
  connectionSshOptionsText: string
): ConnectionSaveInputResult {
  const actions = parseLoginActions(connectionActionsText)
  const sshOptions = parseSshOptions(connectionSshOptionsText)
  const name = connectionForm.name.trim()
  const host = connectionForm.host.trim()

  if (!name) return { ok: false, reason: 'missing-name' }
  if (!host) return { ok: false, reason: 'missing-host' }

  const clusterHostRegexResult = validateClusterHostRegex(connectionForm.clusterHostRegex)
  if (!clusterHostRegexResult.ok) {
    return {
      ok: false,
      reason: 'invalid-cluster-regex',
      clusterReason: clusterHostRegexResult.reason,
      detail: clusterHostRegexResult.error
    }
  }

  return {
    ok: true,
    value: {
      id: connectionForm.id,
      name,
      host,
      user: connectionForm.user?.trim() || undefined,
      password: connectionForm.password?.trim() || undefined,
      passwordEnvVar: connectionForm.passwordEnvVar?.trim() || undefined,
      rootPassword: connectionForm.rootPassword?.trim() || undefined,
      port: connectionForm.port || undefined,
      identityFile: connectionForm.identityFile?.trim() || undefined,
      sshOptions,
      description: connectionForm.description?.trim() || undefined,
      actions,
      clusterHostRegex: clusterHostRegexResult.value
    }
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
  clusterHostRegexValidation: ClusterHostPatternValidation
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

  const clusterHostRegexValidation = useMemo(
    () => validateClusterHostRegex(connectionForm.clusterHostRegex),
    [connectionForm.clusterHostRegex]
  )

  const connectionFormReady = useMemo(
    () =>
      Boolean(
        connectionForm.name.trim() && connectionForm.host.trim() && clusterHostRegexValidation.ok
      ),
    [clusterHostRegexValidation.ok, connectionForm.host, connectionForm.name]
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
    clusterHostRegexValidation,
    connectionCommandPreview
  }
}
