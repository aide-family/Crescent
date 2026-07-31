/** Built-in id for the local terminal "connection" (non-SSH). */
export const LOCAL_CONNECTION_ID = 'builtin-local-terminal'

/** Resolve ops-feedback scope: real SSH connection, or local terminal fallback. */
export function resolveOpsConnectionId(connectionId?: string | null): string {
  const trimmed = connectionId?.trim()
  return trimmed || LOCAL_CONNECTION_ID
}

export function isLocalOpsConnectionId(connectionId: string | undefined | null): boolean {
  return !connectionId?.trim() || connectionId.trim() === LOCAL_CONNECTION_ID
}
