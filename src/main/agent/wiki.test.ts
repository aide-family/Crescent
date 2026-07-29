import { mkdtempSync, rmSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ wikiRoot: '' }))

vi.mock('../crescent-paths', () => ({
  getCrescentWikiDir: () => state.wikiRoot
}))

describe('wiki documents', () => {
  beforeEach(() => {
    state.wikiRoot = mkdtempSync(join(tmpdir(), 'crescent-wiki-'))
    vi.resetModules()
  })

  afterEach(() => {
    if (state.wikiRoot) rmSync(state.wikiRoot, { recursive: true, force: true })
    state.wikiRoot = ''
  })

  it('deletes wiki documents from the local wiki directory', async () => {
    const { deleteWikiDocument, saveWikiDocument } = await import('./wiki')
    const document = await saveWikiDocument({
      title: 'K8s 巡检 SOP',
      content: '## 操作步骤\n- check pods'
    })

    expect(await deleteWikiDocument(document.id)).toEqual({ ok: true })
    expect(await deleteWikiDocument(document.id)).toEqual({ ok: false })
  })

  it('normalizes ids to a basename before delete', async () => {
    const { deleteWikiDocument } = await import('./wiki')
    await writeFile(join(state.wikiRoot, 'safe.md'), '# Safe\n', 'utf-8')

    expect(await deleteWikiDocument('../safe.md')).toEqual({ ok: true })
    await expect(readFile(join(state.wikiRoot, 'safe.md'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
