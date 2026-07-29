import { promises as fs } from 'fs'
import { join } from 'path'

import { getCrescentAttachmentsDir } from './crescent-paths'

export const DEFAULT_ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1000
const DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export async function cleanupExpiredAttachments(
  now = Date.now(),
  retentionMs = DEFAULT_ATTACHMENT_RETENTION_MS
): Promise<{ deleted: number }> {
  const attachmentsDir = getCrescentAttachmentsDir()

  let entries
  try {
    entries = await fs.readdir(attachmentsDir, { withFileTypes: true })
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') return { deleted: 0 }
    throw error
  }

  let deleted = 0
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(attachmentsDir, entry.name)
      try {
        const stat = await fs.stat(path)
        if (now - stat.mtimeMs < retentionMs) return

        await fs.rm(path, { recursive: true, force: true })
        deleted += 1
      } catch (error) {
        if (isErrorWithCode(error) && error.code === 'ENOENT') return
        throw error
      }
    })
  )

  return { deleted }
}

export function startAttachmentCleanupScheduler(): () => void {
  void cleanupExpiredAttachments().catch((error) => {
    console.warn('Failed to clean expired attachments:', error)
  })

  const timer = setInterval(() => {
    void cleanupExpiredAttachments().catch((error) => {
      console.warn('Failed to clean expired attachments:', error)
    })
  }, DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS)
  timer.unref?.()

  return () => clearInterval(timer)
}

function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
