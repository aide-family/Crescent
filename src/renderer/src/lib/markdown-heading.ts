export function buildMarkdownHeadingId(prefix: string, text: string, index: number): string {
  const slug =
    text
      .toLowerCase()
      .replace(/[`*_~[\]()#+.!?，。！？：:;；、/\\|]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'heading'

  return `${prefix}-${index}-${slug}`
}
