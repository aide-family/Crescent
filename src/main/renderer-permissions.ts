export function isAllowedRendererPermission(
  permission: string,
  details?: { mediaTypes?: string[]; mediaType?: string }
): boolean {
  if (permission === 'clipboard-sanitized-write') return true
  if (permission !== 'media') return false
  const types = details?.mediaTypes ?? (details?.mediaType ? [details.mediaType] : [])
  return types.length > 0 && types.every((type) => type === 'audio')
}
