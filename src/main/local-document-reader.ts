import { localDocumentError } from './local-document-errors'
import { constants } from 'node:fs'
import { open, realpath, lstat, opendir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { redactSensitiveText } from '../shared/secret-redaction'
import {
  LOCAL_DOCUMENT_MAX_BYTES,
  LOCAL_DOCUMENT_PAGE_BYTES,
  type LocalDocumentRequest,
  type LocalDocumentPage,
  type LocalDocumentNode
} from '../shared/local-documents'

export function sensitiveDocumentPath(path: string): boolean {
  return /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.env(?:\.[^\\/]*)?|shadow|credentials(?:\.[^\\/]*)?|id_rsa|id_ed25519)(?:[\\/]|$)|(?:^|[\\/])\.kube[\\/]config$/i.test(
    path
  )
}
function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
/** All paths are canonicalized against explicitly granted roots. Final symlinks/devices are rejected. */
export class LocalDocumentReader {
  constructor(private readonly roots: string[]) {}
  async resolvePath(path: string, workspace: string): Promise<string> {
    const expanded = path.replace(/^~(?=$|[/\\])/, homedir())
    const primary = resolve(workspace, expanded)
    try {
      return await this.authorize(primary)
    } catch (error) {
      if (isAbsolute(expanded) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const matches: string[] = []
    for (const root of this.roots) {
      try {
        matches.push(await this.authorize(resolve(root, expanded)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const unique = [...new Set(matches)]
    if (unique.length === 1) return unique[0]
    if (unique.length > 1)
      throw new Error('Ambiguous document path; use the absolute path of the selected directory')
    return this.authorize(primary)
  }
  async authorize(path: string): Promise<string> {
    try {
      return await this.authorizePath(path)
    } catch (error) {
      throw localDocumentError(error)
    }
  }
  private async authorizePath(path: string): Promise<string> {
    if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0'))
      throw new Error('Invalid document path')
    const absolute = resolve(path)
    if (sensitiveDocumentPath(absolute))
      throw new Error('Sensitive document path is not readable by this tool')
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error('Symlinks and special files are not supported')
    const canonical = await realpath(absolute)
    const candidates = await Promise.allSettled(this.roots.map((root) => realpath(root)))
    const roots = candidates.flatMap((candidate) =>
      candidate.status === 'fulfilled' ? [candidate.value] : []
    )
    if (sensitiveDocumentPath(canonical) || !roots.some((root) => within(root, canonical)))
      throw new Error('Document path is outside the authorized roots')
    return canonical
  }
  async list(path: string, signal?: AbortSignal): Promise<LocalDocumentNode[]> {
    try {
      return await this.listDirectory(path, signal)
    } catch (error) {
      throw localDocumentError(error)
    }
  }
  private async listDirectory(path: string, signal?: AbortSignal): Promise<LocalDocumentNode[]> {
    const canonical = await this.authorize(path)
    const directory = await opendir(canonical)
    const nodes: LocalDocumentNode[] = []
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (nodes.length >= 200) break
      const child = join(canonical, entry.name)
      if (
        entry.isSymbolicLink() ||
        sensitiveDocumentPath(child) ||
        (!entry.isDirectory() && !entry.isFile())
      )
        continue
      nodes.push({ path: child, name: entry.name, directory: entry.isDirectory() })
    }
    return nodes.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)
    )
  }
  async readPdf(path: string, signal?: AbortSignal): Promise<{ path: string; base64: string }> {
    const canonical = await this.authorize(path)
    const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024)
        throw new Error('PDF preview limit is 2 MiB')
      const check = await lstat(canonical)
      if (
        check.ino !== metadata.ino ||
        check.dev !== metadata.dev ||
        (await this.authorize(canonical)) !== canonical
      )
        throw new Error('PDF changed during authorization')
      signal?.throwIfAborted()
      const data = await file.readFile()
      if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF document')
      return { path: canonical, base64: data.toString('base64') }
    } finally {
      await file.close()
    }
  }
  async read(
    input: LocalDocumentRequest,
    signal?: AbortSignal,
    internalOptions?: { rawForIndex: true }
  ): Promise<LocalDocumentPage> {
    try {
      return await this.readText(input, signal, internalOptions)
    } catch (error) {
      throw localDocumentError(error)
    }
  }
  private async readText(
    input: LocalDocumentRequest,
    signal?: AbortSignal,
    internalOptions?: { rawForIndex: true }
  ): Promise<LocalDocumentPage> {
    const path = await this.authorize(input.path)
    const offset = input.offset ?? 1
    const limit = input.limit ?? 200
    if (
      !Number.isInteger(offset) ||
      offset < 1 ||
      offset > 1000000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200))
    )
      throw new Error('Invalid document range/search')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > LOCAL_DOCUMENT_MAX_BYTES)
        throw new Error('Text documents must be regular files of at most 20 MiB')
      const check = await lstat(path)
      if (check.ino !== stat.ino || check.dev !== stat.dev || (await this.authorize(path)) !== path)
        throw new Error('Document changed during authorization')
      const header = Buffer.alloc(4)
      await file.read(header, 0, 4, 0)
      const encoding =
        header[0] === 0xff && header[1] === 0xfe
          ? 'utf-16le'
          : header[0] === 0xfe && header[1] === 0xff
            ? 'utf-16be'
            : 'utf-8'
      const decoder = new TextDecoder(encoding, { fatal: true })
      const result: LocalDocumentPage = {
        path,
        encoding,
        lines: [],
        hasMore: false,
        scannedLines: 0
      }
      let position = 0
      let pending = ''
      let bytes = 0
      let insidePrivateKey = false
      const consume = (line: string): boolean => {
        const beginsPrivateKey = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line)
        if (!internalOptions?.rawForIndex && (insidePrivateKey || beginsPrivateKey)) {
          insidePrivateKey = !/-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line)
          line = '[REDACTED PRIVATE KEY]'
        }
        result.scannedLines++
        if (
          result.scannedLines < offset ||
          (input.query && !line.toLowerCase().includes(input.query.toLowerCase()))
        )
          return true
        if (
          result.lines.length >= limit ||
          bytes + Buffer.byteLength(line) > LOCAL_DOCUMENT_PAGE_BYTES
        ) {
          result.hasMore = true
          return false
        }
        const text = internalOptions?.rawForIndex
          ? line.replace(/\r$/, '')
          : redactSensitiveText(line.replace(/\r$/, ''))
        bytes += Buffer.byteLength(text)
        result.lines.push({ line: result.scannedLines, text })
        return true
      }
      const chunk = Buffer.alloc(65536)
      while (position < stat.size) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(chunk, 0, chunk.length, position)
        if (!bytesRead) break
        position += bytesRead
        const text = decoder.decode(chunk.subarray(0, bytesRead), { stream: position < stat.size })
        if (
          text.includes('\0') ||
          [...text].some((char) => {
            const code = char.charCodeAt(0)
            return (code >= 1 && code <= 8) || (code >= 14 && code <= 31)
          })
        )
          throw new Error('Binary/control data is not a text document')
        pending += text
        if (pending.length > LOCAL_DOCUMENT_PAGE_BYTES && !pending.includes('\n'))
          throw new Error('Document line exceeds preview limit')
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          if (!consume(pending.slice(0, newline))) return result
          pending = pending.slice(newline + 1)
        }
        if (result.scannedLines > 1000000) throw new Error('Document line limit exceeded')
      }
      if (pending) consume(pending)
      return result
    } finally {
      await file.close()
    }
  }
}
