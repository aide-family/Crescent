/** Default markdown chunk size for on-demand full-result rendering. */
export const AGENT_RESULT_CHUNK_CHARS = 8 * 1024
/** Default page size for on-demand full-step timeline. */
export const AGENT_STEP_PAGE_SIZE = 15

/**
 * Split text into chunks of roughly `size` characters, preferring breaks at newlines.
 * Concatenating chunks reconstructs the original string exactly.
 */
export function chunkTextByChars(text: string, size = AGENT_RESULT_CHUNK_CHARS): string[] {
  if (size <= 0) return text ? [text] : []
  if (!text) return []
  if (text.length <= size) return [text]

  const chunks: string[] = []
  let offset = 0
  while (offset < text.length) {
    if (offset + size >= text.length) {
      chunks.push(text.slice(offset))
      break
    }
    let end = offset + size
    const window = text.slice(offset, end)
    const newline = window.lastIndexOf('\n')
    if (newline > Math.floor(size * 0.25)) {
      end = offset + newline + 1
    }
    chunks.push(text.slice(offset, end))
    offset = end
  }
  return chunks
}

/** Slice a step list for paginated overlay rendering. */
export function pageSteps<T>(steps: readonly T[], offset: number, limit = AGENT_STEP_PAGE_SIZE): T[] {
  const start = Math.max(0, Math.floor(offset))
  const count = Math.max(0, Math.floor(limit))
  if (count === 0 || start >= steps.length) return []
  return steps.slice(start, start + count)
}
