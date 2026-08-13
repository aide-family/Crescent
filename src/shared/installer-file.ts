import { CRESCENT_GITHUB_RELEASE_DOWNLOAD } from './app-links'

export { CRESCENT_GITHUB_URL } from './app-links'

export interface InstallerFileInfo {
  url: string
  filename: string
}

export function uniqueDownloadPath(
  dir: string,
  filename: string,
  exists: (path: string) => boolean,
  joinPath: (dir: string, name: string) => string
): string {
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot) : ''
  const base = dot > 0 ? filename.slice(0, dot) : filename
  let candidate = joinPath(dir, filename)
  let index = 1
  while (exists(candidate)) {
    candidate = joinPath(dir, `${base} (${index})${ext}`)
    index += 1
  }
  return candidate
}

export function pickPreferredInstallerFile(input: {
  version: string
  path?: string
  files?: Array<{ url: string }>
  platform?: NodeJS.Platform
}): InstallerFileInfo | undefined {
  const platform = input.platform ?? process.platform
  const preferredExts =
    platform === 'darwin'
      ? ['.dmg', '.zip']
      : platform === 'win32'
        ? ['.exe']
        : ['.AppImage', '.deb', '.rpm']

  const candidates = [
    ...(input.files ?? []).map((file) => file.url),
    ...(input.path ? [input.path] : [])
  ].filter((value) => value.trim().length > 0)

  const ranked = preferredExts
    .map((ext) => candidates.find((value) => value.toLowerCase().includes(ext.toLowerCase())))
    .find((value): value is string => Boolean(value))

  const selected = ranked ?? candidates[0]
  if (!selected) return undefined

  const filename = fileBasename(stripQuery(selected)) || selected
  const url = /^https?:\/\//i.test(selected)
    ? selected
    : `${CRESCENT_GITHUB_RELEASE_DOWNLOAD}/v${input.version.replace(/^v/i, '')}/${filename}`

  return { url, filename }
}

function stripQuery(value: string): string {
  const query = value.indexOf('?')
  return query >= 0 ? value.slice(0, query) : value
}

function fileBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(slash + 1) : normalized
}
