import { shell } from 'electron'

export function isAllowedExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function openExternalUrlIfAllowed(url: string): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) return false
  try {
    await shell.openExternal(new URL(url).toString())
    return true
  } catch {
    return false
  }
}
