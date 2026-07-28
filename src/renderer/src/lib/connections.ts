import type { ConnectionConfig } from '../../../shared/agent-types'

export function formatConnectionTarget(connection: ConnectionConfig): string {
  const user = connection.user ? `${connection.user}@` : ''
  const port = connection.port ? `:${connection.port}` : ''

  return `${user}${connection.host}${port}`
}

export function filterConnections(
  connections: ConnectionConfig[],
  query: string
): ConnectionConfig[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return connections

  return connections.filter((connection) =>
    normalizeSearchText(
      [
        connection.name,
        connection.host,
        connection.user,
        connection.port,
        connection.identityFile,
        connection.description,
        connection.source,
        ...(connection.sshOptions ?? []),
        ...(connection.actions ?? [])
      ]
        .filter(Boolean)
        .join(' ')
    ).includes(normalizedQuery)
  )
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}
