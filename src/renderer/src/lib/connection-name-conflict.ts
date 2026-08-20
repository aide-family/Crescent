import type { ConnectionConfig, ConnectionInput } from '../../../shared/agent-types'

export function findCustomConnectionNameConflict(
  connections: Array<Pick<ConnectionConfig, 'id' | 'name' | 'source'>>,
  input: Pick<ConnectionInput, 'id' | 'name'>
): Pick<ConnectionConfig, 'id' | 'name'> | undefined {
  const name = input.name.trim()
  if (!name) return undefined
  const currentId = input.id?.trim()
  return connections.find(
    (connection) =>
      connection.source === 'custom' &&
      connection.id !== currentId &&
      connection.name.trim() === name
  )
}

export function applyConnectionNameOverwrite(
  input: ConnectionInput,
  existingId: string
): { input: ConnectionInput; deleteId?: string } {
  const currentId = input.id?.trim()
  return {
    input: { ...input, id: existingId },
    deleteId: currentId && currentId !== existingId ? currentId : undefined
  }
}
