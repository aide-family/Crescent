/** Detect binary buffers via NUL or invalid UTF-8. */
export function looksLikeBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true
  try {
    const text = buffer.toString('utf8')
    // Round-trip check catches invalid UTF-8 that Node replaces with U+FFFD.
    return Buffer.from(text, 'utf8').compare(buffer) !== 0
  } catch {
    return true
  }
}
