import type { RemoteFsEntryType } from '../../shared/remote-fs-types'

const MODE_CHARS = 'rwxrwxrwx' as const
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const S_IFREG = 0o100000

/** Format a numeric unix mode as `drwxr-xr-x`-style string. */
export function formatUnixMode(mode: number | undefined, type: RemoteFsEntryType): string {
  if (mode == null || !Number.isFinite(mode)) return ''
  const perms = mode & 0o777
  let out = typePrefix(type)
  for (let i = 0; i < 9; i += 1) {
    const bit = 1 << (8 - i)
    out += perms & bit ? MODE_CHARS[i] : '-'
  }
  return out
}

function typePrefix(type: RemoteFsEntryType): string {
  if (type === 'dir') return 'd'
  if (type === 'link') return 'l'
  return '-'
}

/** Classify from unix mode bits (ssh2 readdir attrs are Attributes, not Stats). */
export function entryTypeFromMode(mode: number | undefined): RemoteFsEntryType {
  if (mode == null || !Number.isFinite(mode)) return 'other'
  const type = mode & S_IFMT
  if (type === S_IFDIR) return 'dir'
  if (type === S_IFLNK) return 'link'
  if (type === S_IFREG) return 'file'
  return 'other'
}

/**
 * Classify using mode bits and OpenSSH `longname` first character.
 * Incomplete attrs are common on some servers / hidden entries.
 */
export function entryTypeFromAttrs(attrs: { mode?: number; longname?: string }): RemoteFsEntryType {
  const fromMode = entryTypeFromMode(attrs.mode)
  if (fromMode !== 'other') return fromMode

  const longname = attrs.longname?.trim()
  if (!longname) return 'other'
  const marker = longname[0]
  if (marker === 'd') return 'dir'
  if (marker === 'l') return 'link'
  if (marker === '-' || marker === 'f') return 'file'
  return 'other'
}

/** True when the entry should navigate as a directory in the browser. */
export function isNavigableDirectory(type: RemoteFsEntryType, isDir: boolean): boolean {
  return isDir || type === 'dir'
}
