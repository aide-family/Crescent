export interface MarkdownFenceScanResult {
  /** True when a matching closing fence was found. */
  closed: boolean
  language: string
  code: string
  /** Index of the line after the fence block (or after EOF if unclosed). */
  nextIndex: number
  fenceMarker: string
}

/**
 * Scan a fenced code block starting at `start` (the opening fence line).
 * Does not treat EOF as a closed fence — callers should show a placeholder while streaming.
 */
export function scanMarkdownFence(lines: string[], start: number): MarkdownFenceScanResult | null {
  const open = lines[start]?.match(/^\s*(```|~~~)([\w-]*)?\s*$/)
  if (!open) return null

  const fenceMarker = open[1]
  const language = (open[2] ?? '').trim()
  const closeRe = new RegExp(`^\\s*${escapeRegExp(fenceMarker)}\\s*$`)
  const codeLines: string[] = []
  let index = start + 1

  while (index < lines.length && !closeRe.test(lines[index])) {
    codeLines.push(lines[index])
    index += 1
  }

  const closed = index < lines.length && closeRe.test(lines[index])
  if (closed) index += 1

  return {
    closed,
    language,
    code: codeLines.join('\n'),
    nextIndex: index,
    fenceMarker
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Classify mermaid block UI state for rendering / tests. */
export type MermaidBlockUiState = 'generating' | 'ready' | 'failed-muted'

export function resolveMermaidBlockUiState(input: {
  closed: boolean
  streaming: boolean
  hasSvg: boolean
  hasError: boolean
}): MermaidBlockUiState {
  if (!input.closed) {
    return input.streaming ? 'generating' : 'failed-muted'
  }
  if (input.hasSvg) return 'ready'
  if (input.hasError) {
    return input.streaming ? 'generating' : 'failed-muted'
  }
  return 'generating'
}
