/** Match the largest conversation payload we still expect to copy in one shot. */
export const CLIPBOARD_TEXT_MAX_CHARS = 512 * 1024

export function parseClipboardWriteText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.length > CLIPBOARD_TEXT_MAX_CHARS ? value.slice(0, CLIPBOARD_TEXT_MAX_CHARS) : value
}
