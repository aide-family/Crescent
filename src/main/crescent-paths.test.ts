import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { getCrescentSystemSkillsDir } from './crescent-paths'

describe('crescent paths', () => {
  const originalSystemSkillRoot = process.env.CRESCENT_SYSTEM_SKILL_ROOT
  const originalResourcesPath = process.resourcesPath
  const tempRoots: string[] = []

  afterEach(() => {
    if (originalSystemSkillRoot === undefined) delete process.env.CRESCENT_SYSTEM_SKILL_ROOT
    else process.env.CRESCENT_SYSTEM_SKILL_ROOT = originalSystemSkillRoot

    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: originalResourcesPath
    })

    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses explicit system skill root override first', () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-system-skills-'))
    tempRoots.push(root)
    process.env.CRESCENT_SYSTEM_SKILL_ROOT = root

    expect(getCrescentSystemSkillsDir()).toBe(root)
  })

  it('uses packaged resources system skills when present', () => {
    const resourcesRoot = mkdtempSync(join(tmpdir(), 'crescent-resources-'))
    tempRoots.push(resourcesRoot)
    delete process.env.CRESCENT_SYSTEM_SKILL_ROOT
    mkdirSync(join(resourcesRoot, 'system-skills'), { recursive: true })
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: resourcesRoot
    })

    expect(getCrescentSystemSkillsDir()).toBe(join(resourcesRoot, 'system-skills'))
  })
})
