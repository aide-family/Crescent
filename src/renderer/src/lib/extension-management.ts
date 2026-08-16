import type { AgentExtensionOption } from '../../../shared/agent-types'

export function filterLocalExtensions(
  extensions: AgentExtensionOption[],
  query: string
): AgentExtensionOption[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return extensions
  return extensions.filter((extension) =>
    [
      extension.name,
      extension.path,
      extension.source,
      extension.description,
      ...extension.tools,
      ...extension.commands
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalized)
  )
}

export function isPiPackageSearchResultInstalled(
  result: { source: string; name: string },
  extensions: AgentExtensionOption[]
): boolean {
  const identities = new Set(
    extensions.flatMap((extension) =>
      [extension.id, extension.source, extension.name].filter((value): value is string =>
        Boolean(value)
      )
    )
  )
  return identities.has(result.source) || identities.has(result.name)
}
