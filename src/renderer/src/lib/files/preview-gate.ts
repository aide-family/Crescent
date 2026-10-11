/** Keep in sync with `REMOTE_FS_OPEN_MAX_BYTES` in shared/remote-fs-types (500 MiB). */
export const PREVIEW_OPEN_MAX_BYTES = 500 * 1024 * 1024

/** @deprecated Use PREVIEW_OPEN_MAX_BYTES; kept for older local tests. */
export const PREVIEW_MAX_BYTES = PREVIEW_OPEN_MAX_BYTES

export type PreviewGateReason = 'too-large'

export type PreviewGateResult = { ok: true } | { ok: false; reason: PreviewGateReason }

/**
 * List-stage gate before fetching remote file content.
 * Any file ≤ 500 MiB may open (text or binary); only size is gated.
 */
export function canOpenFilePreview(entry: {
  isDir: boolean
  type?: string
  size: number
  path: string
}): PreviewGateResult {
  if (entry.isDir || entry.type === 'dir' || entry.type === 'link') {
    return { ok: true }
  }
  if (entry.size > PREVIEW_OPEN_MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true }
}

export function formatPreviewGateMessage(
  _reason: PreviewGateReason,
  size: number | undefined,
  copy: { tooLarge: (mib: number, maxMib: number) => string }
): string {
  const mib = Math.ceil((size ?? PREVIEW_OPEN_MAX_BYTES + 1) / (1024 * 1024))
  return copy.tooLarge(mib, PREVIEW_OPEN_MAX_BYTES / (1024 * 1024))
}
