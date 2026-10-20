/** Remote filesystem entry returned by list. */
export type RemoteFsEntryType = 'dir' | 'file' | 'link' | 'other'

export interface RemoteFsEntry {
  name: string
  path: string
  isDir: boolean
  type: RemoteFsEntryType
  size: number
  mode?: string
  owner?: string
  group?: string
  /** Unix epoch seconds when known. */
  mtime?: number
  linkTarget?: string
}

export interface RemoteFsListResult {
  path: string
  count: number
  entries: RemoteFsEntry[]
  connectionId: string
}

export interface RemoteFsReadResult {
  path: string
  size: number
  binary: boolean
  truncated: boolean
  content?: string
}

export interface RemoteFsListInput {
  connectionId: string
  path?: string
}

export interface RemoteFsReadInput {
  connectionId: string
  path: string
}

/** Shared preview body cap (bytes) — slice returned to the renderer. */
export const REMOTE_FS_PREVIEW_MAX_BYTES = 1024 * 1024

/** Max remote file size allowed to open (bytes). Larger files are blocked in the UI gate. */
export const REMOTE_FS_OPEN_MAX_BYTES = 500 * 1024 * 1024
