import type { RemoteFsListInput, RemoteFsReadInput } from '../../shared/remote-fs-types'
import { rendererIpc } from '../ipc-security'
import { disposeAllRemoteFsSessions } from './client'
import { listRemoteFs, readRemoteFs } from './operations'

export function registerRemoteFsIpc(): void {
  rendererIpc.handle('remote-fs:list', async (_event, payload: unknown) => {
    const input = parseListInput(payload)
    return listRemoteFs(input.connectionId, input.path)
  })

  rendererIpc.handle('remote-fs:read', async (_event, payload: unknown) => {
    const input = parseReadInput(payload)
    return readRemoteFs(input.connectionId, input.path)
  })
}

export function stopRemoteFsSessions(): void {
  disposeAllRemoteFsSessions()
}

function parseListInput(payload: unknown): RemoteFsListInput {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const connectionId = String(record.connectionId ?? '').trim()
  if (!connectionId) throw new Error('Missing connectionId.')
  const path = record.path == null ? undefined : String(record.path)
  return { connectionId, path }
}

function parseReadInput(payload: unknown): RemoteFsReadInput {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const connectionId = String(record.connectionId ?? '').trim()
  const path = String(record.path ?? '').trim()
  if (!connectionId) throw new Error('Missing connectionId.')
  if (!path) throw new Error('Missing path.')
  return { connectionId, path }
}
