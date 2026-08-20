export type SkillMarkdownParts = {
  name: string
  description: string
  body: string
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function parseSkillMarkdown(source: string): SkillMarkdownParts {
  const text = source.replace(/^\uFEFF/, '')
  const match = text.match(FRONTMATTER_PATTERN)
  if (!match) {
    return { name: '', description: '', body: text }
  }

  const scalars = parseFrontmatterScalars(match[1] ?? '', ['name', 'description'])
  return {
    name: scalars.name ?? '',
    description: scalars.description ?? '',
    body: text.slice(match[0].length)
  }
}

function parseFrontmatterScalars(
  frontmatter: string,
  keys: string[]
): Partial<Record<string, string>> {
  const wanted = new Set(keys)
  const result: Partial<Record<string, string>> = {}
  const lines = frontmatter.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    if (!key || !wanted.has(key)) continue

    const raw = match[2]?.trim() ?? ''
    if (raw === '>' || raw === '>-' || raw === '|' || raw === '|-') {
      const collected: string[] = []
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1] ?? '')) {
        index += 1
        collected.push((lines[index] ?? '').trim())
      }
      result[key] = collected.join(raw.startsWith('|') ? '\n' : ' ')
      continue
    }

    result[key] = unquoteScalar(raw)
  }

  return result
}

function unquoteScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
