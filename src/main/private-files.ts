import { chmodSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getCrescentDir } from './crescent-paths'

/** Never follow links or change permissions outside Crescent's own data tree. */
export function securePrivateTree(root = getCrescentDir()): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (lstatSync(root).isSymbolicLink())
    throw new Error('Crescent data directory must not be a symbolic link')
  const visit = (path: string): void => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) {
      chmodSync(path, 0o700)
      for (const name of readdirSync(path)) visit(join(path, name))
    } else if (stat.isFile()) {
      // User skills may contain executable scripts.
      chmodSync(path, stat.mode & 0o111 ? 0o700 : 0o600)
    }
  }
  visit(root)
}

export function initializePrivateFiles(): void {
  process.umask(0o077)
  securePrivateTree()
}
