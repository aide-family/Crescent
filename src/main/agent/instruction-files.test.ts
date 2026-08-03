import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  formatLocalInstructionContext,
  listEditableInstructionFiles,
  loadLocalInstructionFiles,
  saveEditableInstructionFile,
  ensureDefaultInstructionFiles
} from './instruction-files'

describe('local instruction files', () => {
  it('loads supported instruction files from the current directory ancestry', () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-instructions-'))
    const nested = join(root, 'workspace', 'service')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '# Agent Rules\nUse concise output.', 'utf8')
    writeFileSync(join(nested, 'TOOLS.md'), '# Tool Rules\nPrefer read-only checks.', 'utf8')

    const files = loadLocalInstructionFiles(nested)

    expect(files.map((file) => file.name)).toContain('AGENTS.md')
    expect(files.map((file) => file.name)).toContain('TOOLS.md')
    expect(formatLocalInstructionContext(files)).toContain('Use concise output.')
    expect(formatLocalInstructionContext(files)).toContain('Prefer read-only checks.')
  })

  it('lists and saves editable global instruction files', () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-editable-instructions-'))

    expect(listEditableInstructionFiles(root).map((file) => file.name)).toContain('USER.md')

    const saved = saveEditableInstructionFile({
      root,
      name: 'USER.md',
      content: 'Prefer concise responses.'
    })

    expect(saved).toMatchObject({
      name: 'USER.md',
      exists: true,
      content: 'Prefer concise responses.'
    })
    expect(
      listEditableInstructionFiles(root).find((file) => file.name === 'USER.md')
    ).toMatchObject({
      exists: true,
      content: 'Prefer concise responses.'
    })
  })

  it('seeds missing default instruction files without overwriting existing ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-default-instructions-'))
    writeFileSync(join(root, 'USER.md'), 'Keep my custom user prefs.', 'utf8')

    const first = ensureDefaultInstructionFiles(root)
    expect(first.created.sort()).toEqual(['AGENTS.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md'].sort())
    expect(first.skipped).toEqual(['USER.md'])

    const listed = listEditableInstructionFiles(root)
    expect(listed.every((file) => file.exists)).toBe(true)
    expect(listed.find((file) => file.name === 'IDENTITY.md')?.content).toContain(
      'Crescent local identity'
    )
    expect(listed.find((file) => file.name === 'USER.md')?.content).toBe(
      'Keep my custom user prefs.'
    )

    const second = ensureDefaultInstructionFiles(root)
    expect(second.created).toEqual([])
    expect(second.skipped.sort()).toEqual(
      ['AGENTS.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md', 'USER.md'].sort()
    )
  })
})
