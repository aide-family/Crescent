import { existsSync, mkdtempSync, rmSync } from 'fs'
import { mkdir, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ attachmentsRoot: '' }))

vi.mock('./crescent-paths', () => ({
  getCrescentAttachmentsDir: () => state.attachmentsRoot
}))

describe('attachment cleanup', () => {
  beforeEach(() => {
    state.attachmentsRoot = mkdtempSync(join(tmpdir(), 'crescent-attachments-'))
    vi.resetModules()
  })

  afterEach(() => {
    if (state.attachmentsRoot) rmSync(state.attachmentsRoot, { recursive: true, force: true })
    state.attachmentsRoot = ''
  })

  it('deletes attachment entries older than the retention window', async () => {
    const { cleanupExpiredAttachments } = await import('./attachment-cleanup')
    const now = new Date('2026-07-29T12:00:00.000Z').getTime()
    const oldFile = join(state.attachmentsRoot, 'old.txt')
    const freshFile = join(state.attachmentsRoot, 'fresh.txt')
    const oldDir = join(state.attachmentsRoot, 'old-dir')

    await writeFile(oldFile, 'old', 'utf-8')
    await writeFile(freshFile, 'fresh', 'utf-8')
    await mkdir(oldDir)
    await writeFile(join(oldDir, 'nested.txt'), 'nested', 'utf-8')
    await utimes(oldFile, new Date(now - 25 * 60 * 60 * 1000), new Date(now - 25 * 60 * 60 * 1000))
    await utimes(oldDir, new Date(now - 26 * 60 * 60 * 1000), new Date(now - 26 * 60 * 60 * 1000))
    await utimes(freshFile, new Date(now - 2 * 60 * 60 * 1000), new Date(now - 2 * 60 * 60 * 1000))

    await expect(cleanupExpiredAttachments(now)).resolves.toEqual({ deleted: 2 })
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
  })
})
