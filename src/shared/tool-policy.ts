/**
 * Shared OpenAPI/MCP tool allow/deny filtering.
 * Empty allow list = no allow restriction. Deny always wins.
 */

export interface ToolNamePolicy {
  allowList?: string[]
  denyList?: string[]
}

export function normalizeToolNameList(value: unknown, maxItems = 200): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const name = String(entry ?? '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push(name)
    if (result.length >= maxItems) break
  }
  return result
}

export function applyToolNamePolicy<T extends { name: string }>(
  tools: T[],
  policy: ToolNamePolicy | undefined
): T[] {
  if (!policy) return tools

  const deny = new Set((policy.denyList ?? []).map((name) => name.trim()).filter(Boolean))
  const allowRaw = (policy.allowList ?? []).map((name) => name.trim()).filter(Boolean)
  const allow = allowRaw.length > 0 ? new Set(allowRaw) : undefined

  return tools.filter((tool) => {
    if (deny.has(tool.name)) return false
    if (allow && !allow.has(tool.name)) return false
    return true
  })
}

export function isToolNameDenied(name: string, policy: ToolNamePolicy | undefined): boolean {
  if (!policy?.denyList?.length) return false
  return policy.denyList.some((entry) => entry.trim() === name)
}

export function isToolNameAllowed(name: string, policy: ToolNamePolicy | undefined): boolean {
  if (isToolNameDenied(name, policy)) return false
  const allow = (policy?.allowList ?? []).map((entry) => entry.trim()).filter(Boolean)
  if (allow.length === 0) return true
  return allow.includes(name)
}

export function formatToolNameListText(list: string[] | undefined): string {
  return (list ?? []).join('\n')
}

export function parseToolNameListText(text: string): string[] {
  return normalizeToolNameList(
    text
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
}
