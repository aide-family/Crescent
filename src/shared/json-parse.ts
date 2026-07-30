/**
 * Extract a JSON value from model output that may be wrapped in markdown fences
 * or surrounded by prose.
 */
export function extractJsonPayload(content: string): string | undefined {
  const trimmed = content.trim()
  if (!trimmed) return undefined

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed

  const objectStart = trimmed.indexOf('{')
  const objectEnd = trimmed.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1)
  }

  const arrayStart = trimmed.indexOf('[')
  const arrayEnd = trimmed.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1)
  }

  return undefined
}

export function parseJsonFromModelContent<T = unknown>(content: string): T {
  const payload = extractJsonPayload(content)
  if (!payload) throw new SyntaxError('No JSON payload found in model content')

  return JSON.parse(payload) as T
}
