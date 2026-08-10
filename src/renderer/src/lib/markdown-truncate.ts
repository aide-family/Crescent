export const MARKDOWN_PREVIEW_MAX_LINES = 2_000
export const MARKDOWN_PREVIEW_MAX_CHARS = 200 * 1024
export const MARKDOWN_PREVIEW_HEAD_LINES = 120
export const MARKDOWN_PREVIEW_HEAD_CHARS = 24 * 1024

export function shouldTruncateMarkdown(value: string): boolean {
  if (value.length > MARKDOWN_PREVIEW_MAX_CHARS) return true
  let lines = 1
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 10) {
      lines += 1
      if (lines > MARKDOWN_PREVIEW_MAX_LINES) return true
    }
  }
  return false
}

export function buildMarkdownPreview(value: string): string {
  if (!shouldTruncateMarkdown(value)) return value
  const byLines = value.split('\n').slice(0, MARKDOWN_PREVIEW_HEAD_LINES).join('\n')
  const preview =
    byLines.length > MARKDOWN_PREVIEW_HEAD_CHARS
      ? byLines.slice(0, MARKDOWN_PREVIEW_HEAD_CHARS)
      : byLines
  return `${preview}\n\n…`
}

/** Simple LRU map with a fixed capacity. */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K
      this.map.delete(oldest)
    }
  }

  get size(): number {
    return this.map.size
  }
}
