export const CRESCENT_GITHUB_URL = 'https://github.com/aide-family/Crescent'

export const CRESCENT_GITHUB_RELEASES_URL = 'https://github.com/aide-family/Crescent/releases'

export const CRESCENT_GITHUB_RELEASE_DOWNLOAD =
  'https://github.com/aide-family/Crescent/releases/download'

export function crescentReleaseTagUrl(version: string | undefined | null): string {
  const trimmed = version?.trim() ?? ''
  if (!trimmed || trimmed === '…') return CRESCENT_GITHUB_RELEASES_URL

  const tag = trimmed.replace(/^v/i, '')
  if (!tag) return CRESCENT_GITHUB_RELEASES_URL
  return `${CRESCENT_GITHUB_RELEASES_URL}/tag/v${tag}`
}
