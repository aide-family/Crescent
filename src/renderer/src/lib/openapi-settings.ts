import type { AgentValidationResult } from '../../../shared/agent-types'

export function filterOpenApiValidationTools(
  validation: AgentValidationResult | undefined
): NonNullable<AgentValidationResult['tools']> {
  return validation?.tools?.filter((tool) => tool.source === 'openapi') ?? []
}

export function summarizeOpenApiDocument(document: string): {
  kind: 'empty' | 'url' | 'file' | 'inline'
  preview: string
} {
  const trimmed = document.trim()
  if (!trimmed) return { kind: 'empty', preview: '' }
  if (/^https?:\/\//i.test(trimmed)) return { kind: 'url', preview: trimmed }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { kind: 'inline', preview: `${trimmed.length} chars JSON` }
  }
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    /^file:\/\//i.test(trimmed) ||
    /\.(json|ya?ml)$/i.test(trimmed)
  ) {
    return { kind: 'file', preview: trimmed }
  }

  return { kind: 'inline', preview: `${trimmed.length} chars` }
}
