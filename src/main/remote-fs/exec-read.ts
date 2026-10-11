import type { Client, ClientChannel } from 'ssh2'

import type { RemoteFsEntry, RemoteFsEntryType } from '../../shared/remote-fs-types'
import { joinRemotePath } from './path'

const EXEC_STDERR_CAP = 4_096
const LIST_STDOUT_CAP = 2 * 1024 * 1024

/** Single-quote a path for a POSIX shell (safe for spaces and metacharacters). */
export function shellQuoteUnix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type ExecCaptureResult = {
  stdout: Buffer
  stderr: string
  code: number | null
}

/** Run a non-interactive remote command and capture stdout (capped). */
export function execCapture(
  client: Client,
  command: string,
  maxBytes: number
): Promise<ExecCaptureResult> {
  const limit = Math.max(0, Math.floor(maxBytes))
  return new Promise((resolve, reject) => {
    client.exec(command, (execError, stream) => {
      if (execError || !stream) {
        reject(
          execError instanceof Error ? execError : new Error(String(execError ?? 'exec failed'))
        )
        return
      }
      collectExec(stream, limit, resolve, reject)
    })
  })
}

/**
 * Read up to maxBytes via ssh2 exec when SFTP OPEN/READ fails.
 * Tries `head -c`, then `dd`, then capped `cat`.
 */
export async function readViaExec(client: Client, path: string, maxBytes: number): Promise<Buffer> {
  if (maxBytes <= 0) return Buffer.alloc(0)
  const limit = Math.floor(maxBytes)
  if (!Number.isFinite(limit) || limit <= 0) return Buffer.alloc(0)

  const quoted = shellQuoteUnix(path)
  const ddCount = Math.max(1, Math.ceil(limit / (64 * 1024)))
  const commands = [
    `head -c ${limit} ${quoted}`,
    `dd if=${quoted} bs=65536 count=${ddCount} 2>/dev/null`,
    `cat ${quoted}`
  ]

  let lastError: Error | undefined
  for (const command of commands) {
    try {
      const result = await execCapture(client, command, limit)
      if (result.stdout.length > 0) {
        return result.stdout.subarray(0, limit)
      }
      // Empty file: head/dd succeed with exit 0 and no bytes.
      if (result.code === 0 || result.code == null) {
        return Buffer.alloc(0)
      }
      lastError = new Error(formatExecFailure('read', result))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError ?? new Error('Remote exec read failed.')
}

/** List a directory via `ls -la` when SFTP readdir fails. */
export async function listViaExec(client: Client, path: string): Promise<RemoteFsEntry[]> {
  const quoted = shellQuoteUnix(path)
  // Prefer GNU long-iso timestamps; fall back to classic ls -la.
  const attempts = [`LC_ALL=C ls -la --time-style=long-iso ${quoted}`, `LC_ALL=C ls -la ${quoted}`]

  let lastError: Error | undefined
  for (const command of attempts) {
    try {
      const result = await execCapture(client, command, LIST_STDOUT_CAP)
      if (result.stdout.length === 0 && result.code != null && result.code !== 0) {
        lastError = new Error(formatExecFailure('list', result))
        continue
      }
      const text = result.stdout.toString('utf8')
      const entries = parseLsLa(text, path)
      // Non-zero with zero parseable rows is a real failure (e.g. permission).
      if (entries.length === 0 && result.code != null && result.code !== 0) {
        lastError = new Error(formatExecFailure('list', result))
        continue
      }
      return entries
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError ?? new Error('Remote exec list failed.')
}

/**
 * Parse `ls -la` / `ls -la --time-style=long-iso` output into remote entries.
 * Skips `total` / `.` / `..`. Best-effort; size/mtime may be 0/undefined.
 */
export function parseLsLa(stdout: string, parentPath: string): RemoteFsEntry[] {
  const entries: RemoteFsEntry[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line || /^total\s+\d+/i.test(line)) continue

    const parsed = parseLsLaLine(line)
    if (!parsed) continue
    if (parsed.name === '.' || parsed.name === '..') continue

    const type = typeFromLsMarker(parsed.marker)
    const isDir = type === 'dir'
    let name = parsed.name
    let linkTarget: string | undefined
    if (type === 'link') {
      const arrow = name.indexOf(' -> ')
      if (arrow >= 0) {
        linkTarget = name.slice(arrow + 4)
        name = name.slice(0, arrow)
      }
    }

    entries.push({
      name,
      path: joinRemotePath(parentPath, name),
      isDir,
      type,
      size: parsed.size,
      mode: parsed.mode,
      mtime: parsed.mtime,
      linkTarget
    })
  }
  return entries
}

function typeFromLsMarker(marker: string): RemoteFsEntryType {
  if (marker === 'd') return 'dir'
  if (marker === 'l') return 'link'
  if (marker === '-' || marker === 'f') return 'file'
  return 'other'
}

type ParsedLsLine = {
  marker: string
  mode: string
  size: number
  mtime?: number
  name: string
}

function parseLsLaLine(line: string): ParsedLsLine | null {
  // mode [optional ACL/SELinux] links owner group size <date...> name
  const match = line.match(
    /^([bcdlps-])([rwxsStT-]{9})([.+@])?\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/
  )
  if (!match) return null

  const marker = match[1]!
  const perms = match[2]!
  const size = Number(match[7]) || 0
  const rest = match[8]!.trim()
  if (!rest) return null

  const mode = `${marker}${perms}`

  // GNU long-iso: 2024-10-09 12:34:56 name
  const iso = rest.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/)
  if (iso) {
    const epoch = Date.parse(`${iso[1]}T${iso[2]}${iso[2]!.length === 5 ? ':00' : ''}Z`)
    return {
      marker,
      mode,
      size,
      mtime: Number.isFinite(epoch) ? Math.floor(epoch / 1000) : undefined,
      name: iso[3]!
    }
  }

  // Classic: Mon DD HH:MM name  OR  Mon DD YYYY name
  const classic = rest.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+([\d:]+|\d{4})\s+(.+)$/)
  if (classic) {
    return {
      marker,
      mode,
      size,
      name: classic[4]!
    }
  }

  // Last resort: treat entire remainder as the name (no date).
  return { marker, mode, size, name: rest }
}

function formatExecFailure(kind: 'read' | 'list', result: ExecCaptureResult): string {
  const detail = result.stderr.trim() || (result.code != null ? `exit ${result.code}` : 'no output')
  return `Remote exec ${kind} failed: ${detail}`
}

function collectExec(
  stream: ClientChannel,
  maxBytes: number,
  resolve: (result: ExecCaptureResult) => void,
  reject: (error: Error) => void
): void {
  const chunks: Buffer[] = []
  let total = 0
  let stderr = ''
  let settled = false
  let exitCode: number | null = null

  const settle = (fn: () => void): void => {
    if (settled) return
    settled = true
    fn()
  }

  const destroyQuietly = (): void => {
    try {
      stream.close()
    } catch {
      // ignore
    }
    try {
      stream.destroy()
    } catch {
      // ignore
    }
  }

  const finish = (): void => {
    settle(() =>
      resolve({
        stdout: Buffer.concat(chunks, total),
        stderr,
        code: exitCode
      })
    )
  }

  stream.on('data', (chunk: Buffer | string) => {
    if (settled) return
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const room = maxBytes - total
    if (room <= 0) {
      destroyQuietly()
      finish()
      return
    }
    if (buf.length <= room) {
      chunks.push(buf)
      total += buf.length
      if (total >= maxBytes) {
        destroyQuietly()
        finish()
      }
      return
    }
    chunks.push(buf.subarray(0, room))
    total += room
    destroyQuietly()
    finish()
  })

  stream.stderr.on('data', (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (stderr.length < EXEC_STDERR_CAP) {
      stderr = (stderr + text).slice(0, EXEC_STDERR_CAP)
    }
  })

  stream.on('exit', (code: number | null) => {
    if (typeof code === 'number') exitCode = code
  })

  stream.on('close', () => {
    if (settled) return
    finish()
  })

  stream.on('error', (error) => {
    destroyQuietly()
    settle(() => reject(error instanceof Error ? error : new Error(String(error))))
  })
}
