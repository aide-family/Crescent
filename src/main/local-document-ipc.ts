import { dialog, type WebContents } from 'electron'
import { realpath, stat, lstat } from 'node:fs/promises'
import { rendererIpc } from './ipc-security'
import { LocalDocumentReader, sensitiveDocumentPath } from './local-document-reader'
import type { LocalDocumentRequest } from '../shared/local-documents'
import { readAgentConfig } from './crescent-store'
import { resolveAgentWorkspaceCwd } from './agent/pi-cwd'
import { localDocumentError } from './local-document-errors'
const grants = new Map<number, Set<string>>()
const pending = new Map<string, AbortController>()
export async function localDocumentReaderForOwner(
  ownerId: number,
  workspace?: string
): Promise<LocalDocumentReader> {
  const selected = [...(grants.get(ownerId) ?? [])]
  try {
    return new LocalDocumentReader([
      workspace ?? resolveAgentWorkspaceCwd(readAgentConfig()),
      ...selected
    ])
  } catch (error) {
    // A stale/inaccessible workspace must not revoke the window's selected directories.
    if (selected.length) return new LocalDocumentReader(selected)
    throw localDocumentError(error)
  }
}
export async function grantLocalDocumentPath(
  owner: WebContents,
  requestedPath: string
): Promise<void> {
  if (owner.isDestroyed()) throw new Error('Document owner window closed')
  if ((await lstat(requestedPath)).isSymbolicLink())
    throw new Error('Selected document root cannot be a symlink')
  const root = await realpath(requestedPath)
  if (sensitiveDocumentPath(requestedPath) || sensitiveDocumentPath(root))
    throw new Error('Sensitive paths cannot be granted to document tools')
  if (owner.isDestroyed()) throw new Error('Document owner window closed')
  if (!grants.has(owner.id)) {
    const cleanup = (): void => {
      grants.delete(owner.id)
      for (const [key, controller] of pending)
        if (key.startsWith(`${owner.id}:`)) {
          controller.abort()
          pending.delete(key)
        }
    }
    owner.once('destroyed', cleanup)
    owner.once('did-start-navigation', cleanup)
    grants.set(owner.id, new Set())
  }
  if (grants.get(owner.id)!.size >= 64)
    throw new Error('Too many document grants; reopen the window to reset')
  grants.get(owner.id)!.add(root)
}
export function registerLocalDocumentIpc(): void {
  rendererIpc.handle('documents:choose-root', async (event) => {
    const selection = await dialog.showOpenDialog({
      title: '授权本次窗口读取本地目录（内容可经明确插入发送给模型）',
      properties: ['openDirectory']
    })
    if (selection.canceled || !selection.filePaths[0]) return undefined
    const root = await realpath(selection.filePaths[0])
    if (sensitiveDocumentPath(root) || !(await stat(root)).isDirectory())
      throw new Error('Sensitive/invalid document root')
    await grantLocalDocumentPath(event.sender, selection.filePaths[0])
    return root
  })
  rendererIpc.handle('documents:pdf', async (event, payload?: { path?: string }) => {
    if (typeof payload?.path !== 'string') throw new Error('Invalid PDF path')
    return (await localDocumentReaderForOwner(event.sender.id)).readPdf(payload.path)
  })
  rendererIpc.handle('documents:list', async (event, payload?: { path?: string }) => {
    if (typeof payload?.path !== 'string') throw new Error('Invalid path')
    return (await localDocumentReaderForOwner(event.sender.id)).list(payload.path)
  })
  rendererIpc.handle(
    'documents:read',
    async (event, payload: LocalDocumentRequest & { requestId: string }) => {
      if (!payload || !/^[\w-]{1,100}$/.test(payload.requestId))
        throw new Error('Invalid document request')
      const key = `${event.sender.id}:${payload.requestId}`
      if (
        pending.has(key) ||
        [...pending.keys()].filter((item) => item.startsWith(`${event.sender.id}:`)).length >= 4
      )
        throw new Error('Too many document reads')
      const controller = new AbortController()
      pending.set(key, controller)
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        return await (
          await localDocumentReaderForOwner(event.sender.id)
        ).read(payload, controller.signal)
      } finally {
        clearTimeout(timeout)
        pending.delete(key)
      }
    }
  )
  rendererIpc.handle('documents:cancel', (event, requestId: unknown) => {
    if (typeof requestId === 'string') pending.get(`${event.sender.id}:${requestId}`)?.abort()
    return { ok: true }
  })
}
