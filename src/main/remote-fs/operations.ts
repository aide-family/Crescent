import type { Client, FileEntry, SFTPWrapper, Stats } from 'ssh2'
import { utils } from 'ssh2'

import {
  REMOTE_FS_PREVIEW_MAX_BYTES,
  type RemoteFsEntry,
  type RemoteFsListResult,
  type RemoteFsReadResult
} from '../../shared/remote-fs-types'
import { looksLikeBinaryBuffer } from './binary'
import { formatSftpError, withSftp } from './client'
import { listViaExec, readViaExec } from './exec-read'
import { entryTypeFromAttrs, formatUnixMode } from './mode'
import { joinRemotePath, sanitizeRemotePath } from './path'

const READ_CHUNK = 64 * 1024

export async function listRemoteFs(
  connectionId: string,
  pathInput?: string
): Promise<RemoteFsListResult> {
  const path = sanitizeRemotePath(pathInput, '/')
  return withSftp(connectionId, async (sftp, _connection, client) => {
    try {
      const entries = await readDirectory(sftp, path)
      return {
        path,
        count: entries.length,
        entries,
        connectionId
      }
    } catch (sftpError) {
      try {
        const entries = await listViaExec(client, path)
        return {
          path,
          count: entries.length,
          entries,
          connectionId
        }
      } catch (execError) {
        throw combineRemoteFsErrors(sftpError, execError)
      }
    }
  })
}

export async function readRemoteFs(
  connectionId: string,
  pathInput: string
): Promise<RemoteFsReadResult> {
  const path = sanitizeRemotePath(pathInput)
  if (path === '/') {
    throw new Error('Path must be a file, not a directory.')
  }

  return withSftp(connectionId, async (sftp, _connection, client) => {
    const limit = REMOTE_FS_PREVIEW_MAX_BYTES + 1

    let size = 0
    try {
      const stats = await lstatPath(sftp, path)
      if (stats.isDirectory()) {
        throw new Error('Path is a directory.')
      }

      // Symlink to a directory: follow once for type check.
      if (stats.isSymbolicLink()) {
        try {
          const followed = await statPath(sftp, path)
          if (followed.isDirectory()) {
            throw new Error('Path is a directory.')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('directory')) {
            throw error instanceof Error ? error : new Error(message)
          }
          // Dangling link or unreadable target — still try to read link path below.
        }
      }
      size = Number(stats.size) || 0
    } catch (lstatError) {
      if (isDirectoryError(lstatError)) throw lstatError
      // SFTP lstat failed (common with code=4): still try shell read.
      try {
        const buffer = await readViaExec(client, path, limit)
        return toReadResult(path, buffer.length, buffer)
      } catch (execError) {
        throw combineRemoteFsErrors(lstatError, execError)
      }
    }

    const buffer = await readFileCapped(sftp, client, path, limit, size)
    return toReadResult(path, size, buffer)
  })
}

function toReadResult(path: string, size: number, buffer: Buffer): RemoteFsReadResult {
  if (looksLikeBinaryBuffer(buffer)) {
    return {
      path,
      size,
      binary: true,
      truncated: false
    }
  }

  const truncated = buffer.length > REMOTE_FS_PREVIEW_MAX_BYTES
  const slice = truncated ? buffer.subarray(0, REMOTE_FS_PREVIEW_MAX_BYTES) : buffer
  return {
    path,
    size: size > 0 ? size : buffer.length,
    binary: false,
    truncated,
    content: slice.toString('utf8')
  }
}

function isDirectoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /directory/i.test(message)
}

/** Prefer a combined message so shell-fallback failures are visible in the UI. */
function combineRemoteFsErrors(sftpError: unknown, execError: unknown): Error {
  const sftp = formatSftpError(sftpError)
  const execMessage =
    execError instanceof Error ? execError.message : String(execError ?? 'exec failed')
  const combined = new Error(`${sftp.message} · ${execMessage}`)
  combined.cause = sftpError instanceof Error ? sftpError : sftp
  return combined
}

/**
 * Cap a single SFTP READ request so length never exceeds remaining file/preview bytes.
 * Some servers return SSH_FX_FAILURE when READ length is larger than the file.
 */
export function computeSftpReadLength(
  offset: number,
  maxBytes: number,
  fileSize: number | undefined
): number {
  const previewLeft = maxBytes - offset
  if (previewLeft <= 0) return 0
  if (fileSize != null && Number.isFinite(fileSize) && fileSize >= 0) {
    const fileLeft = fileSize - offset
    if (fileLeft <= 0) return 0
    return Math.min(READ_CHUNK, previewLeft, fileLeft)
  }
  return Math.min(READ_CHUNK, previewLeft)
}

function readDirectory(sftp: SFTPWrapper, path: string): Promise<RemoteFsEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (error, list) => {
      if (error) {
        reject(formatSftpError(error))
        return
      }
      const entries = (list ?? [])
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => mapEntry(path, item))
      resolve(entries)
    })
  })
}

function mapEntry(parent: string, item: FileEntry): RemoteFsEntry {
  const name = item.filename
  const type = entryTypeFromAttrs({ mode: item.attrs.mode, longname: item.longname })
  const isDir = type === 'dir'
  const fullPath = joinRemotePath(parent, name)
  const mode = formatUnixMode(item.attrs.mode, type)
  const mtime = item.attrs.mtime && item.attrs.mtime > 0 ? item.attrs.mtime : undefined
  return {
    name,
    path: fullPath,
    isDir,
    type,
    size: Number(item.attrs.size) || 0,
    mode: mode || undefined,
    mtime,
    linkTarget: undefined
  }
}

function lstatPath(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (error, stats) => {
      if (error || !stats) {
        reject(formatSftpError(error ?? new Error('lstat failed')))
        return
      }
      resolve(stats)
    })
  })
}

function statPath(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (error, stats) => {
      if (error || !stats) {
        reject(formatSftpError(error ?? new Error('stat failed')))
        return
      }
      resolve(stats)
    })
  })
}

/**
 * Read up to maxBytes. Prefer non-ranged createReadStream with mode:false
 * (default mode 0o666 ATTRS on OPEN breaks some servers). Fall back to
 * OPEN_MODE.READ + size-capped reads, then ssh2 exec (`head -c`) when SFTP
 * open/read fails with path-level errors (e.g. SSH_FX_FAILURE).
 */
async function readFileCapped(
  sftp: SFTPWrapper,
  client: Client,
  path: string,
  maxBytes: number,
  fileSize: number
): Promise<Buffer> {
  if (fileSize === 0 || maxBytes <= 0) {
    return Buffer.alloc(0)
  }

  try {
    return await readViaStream(sftp, path, maxBytes)
  } catch (streamError) {
    try {
      return await readViaOpenRead(sftp, path, maxBytes, fileSize)
    } catch {
      try {
        return await readViaExec(client, path, maxBytes)
      } catch (execError) {
        throw combineRemoteFsErrors(streamError, execError)
      }
    }
  }
}

function readViaStream(sftp: SFTPWrapper, path: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // mode: false avoids sending ATTRS on OPEN (ssh2 default 0o666).
    const stream = sftp.createReadStream(path, {
      flags: 'r',
      mode: false as unknown as number,
      autoClose: true
    })

    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    const destroyQuietly = (): void => {
      try {
        stream.destroy()
      } catch {
        // ignore
      }
    }

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const room = maxBytes - total
      if (room <= 0) {
        destroyQuietly()
        settle(() => resolve(Buffer.concat(chunks, total)))
        return
      }
      if (buf.length <= room) {
        chunks.push(buf)
        total += buf.length
        if (total >= maxBytes) {
          destroyQuietly()
          settle(() => resolve(Buffer.concat(chunks, total)))
        }
        return
      }
      chunks.push(buf.subarray(0, room))
      total += room
      destroyQuietly()
      settle(() => resolve(Buffer.concat(chunks, total)))
    })

    stream.on('end', () => {
      settle(() => resolve(Buffer.concat(chunks, total)))
    })

    stream.on('error', (error) => {
      destroyQuietly()
      settle(() => reject(formatSftpError(error)))
    })
  })
}

function readViaOpenRead(
  sftp: SFTPWrapper,
  path: string,
  maxBytes: number,
  fileSize: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, utils.sftp.OPEN_MODE.READ, (openError, handle) => {
      if (openError || !handle) {
        reject(formatSftpError(openError ?? new Error('open failed')))
        return
      }

      const chunks: Buffer[] = []
      let offset = 0
      let settled = false

      const closeHandle = (): Promise<void> =>
        new Promise((closeResolve) => {
          try {
            sftp.close(handle, () => closeResolve())
          } catch {
            closeResolve()
          }
        })

      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        void closeHandle().then(() => reject(formatSftpError(error)))
      }

      const finish = (): void => {
        if (settled) return
        settled = true
        void closeHandle().then(() => resolve(Buffer.concat(chunks, Math.min(offset, maxBytes))))
      }

      const step = (): void => {
        if (settled) return
        const length = computeSftpReadLength(offset, maxBytes, fileSize)
        if (length <= 0) {
          finish()
          return
        }
        const buffer = Buffer.alloc(length)
        sftp.read(handle, buffer, 0, length, offset, (readError, bytesRead, data) => {
          if (readError) {
            fail(readError)
            return
          }
          if (!bytesRead || bytesRead <= 0) {
            finish()
            return
          }
          const slice = data?.subarray(0, bytesRead) ?? buffer.subarray(0, bytesRead)
          chunks.push(Buffer.from(slice))
          offset += bytesRead
          if (offset >= maxBytes || bytesRead < length) {
            finish()
            return
          }
          step()
        })
      }

      step()
    })
  })
}
