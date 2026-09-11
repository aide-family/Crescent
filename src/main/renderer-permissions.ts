const ALLOWED_RENDERER_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write'])

export function isAllowedRendererPermission(permission: string): boolean {
  return ALLOWED_RENDERER_PERMISSIONS.has(permission)
}
