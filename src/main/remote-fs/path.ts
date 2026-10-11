import { posix } from 'node:path'

/** Sanitize a remote absolute path for list/read. Rejects NUL and relative escapes. */
export function sanitizeRemotePath(input: string | undefined, fallback = '/'): string {
  const raw = typeof input === 'string' ? input : fallback
  if (raw.includes('\0')) {
    throw new Error('Invalid path: contains NUL.')
  }
  const trimmed = raw.trim() || fallback
  const withRoot = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const cleaned = posix.normalize(withRoot)
  if (!cleaned.startsWith('/')) {
    throw new Error('Invalid path.')
  }
  return cleaned === '' ? '/' : cleaned
}

/** Join a directory path with a child name (already sanitized parent). */
export function joinRemotePath(parent: string, name: string): string {
  if (name.includes('\0') || name.includes('/')) {
    throw new Error('Invalid entry name.')
  }
  if (parent === '/') return `/${name}`
  return sanitizeRemotePath(`${parent}/${name}`)
}

/** Parent directory of an absolute remote path. */
export function parentRemotePath(path: string): string {
  const cleaned = sanitizeRemotePath(path)
  if (cleaned === '/') return '/'
  const parent = posix.dirname(cleaned)
  return parent === '.' ? '/' : parent
}
