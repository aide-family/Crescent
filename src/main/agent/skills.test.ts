import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildAgentSkillContext, deleteAgentSkill, listAgentSkills } from './skills'

describe('agent skills', () => {
  let systemRoot: string
  let customRoot: string
  let previousSystemRoot: string | undefined

  beforeEach(() => {
    systemRoot = mkdtempSync(join(tmpdir(), 'crescent-system-skills-'))
    customRoot = mkdtempSync(join(tmpdir(), 'crescent-custom-skills-'))
    previousSystemRoot = process.env.CRESCENT_SYSTEM_SKILL_ROOT
    process.env.CRESCENT_SYSTEM_SKILL_ROOT = systemRoot
    cpSync(join(process.cwd(), 'system-skills'), systemRoot, { recursive: true })
  })

  afterEach(() => {
    if (previousSystemRoot === undefined) delete process.env.CRESCENT_SYSTEM_SKILL_ROOT
    else process.env.CRESCENT_SYSTEM_SKILL_ROOT = previousSystemRoot
    rmSync(systemRoot, { recursive: true, force: true })
    rmSync(customRoot, { recursive: true, force: true })
  })

  it('loads protected built-in operations skills with user skills', () => {
    const customSkillDir = join(customRoot, 'custom-app-check')
    mkdirSync(customSkillDir, { recursive: true })
    writeFileSync(
      join(customSkillDir, 'SKILL.md'),
      [
        '---',
        'name: custom-app-check',
        'description: Custom application check skill.',
        '---',
        '',
        '# Custom application check'
      ].join('\n'),
      'utf8'
    )

    const skills = listAgentSkills(customRoot)
    const names = skills.map((skill) => skill.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'application-network-research',
        'application-program-inspection',
        'docker-environment-inspection',
        'k8s-version-cluster-inspection',
        'linux-basic-environment-inspection',
        'custom-app-check'
      ])
    )
    expect(skills.find((skill) => skill.name === 'k8s-version-cluster-inspection')).toMatchObject({
      removable: false
    })
    expect(skills.find((skill) => skill.name === 'custom-app-check')).toMatchObject({
      removable: true
    })
    expect(
      skills.findIndex((skill) => skill.name === 'k8s-version-cluster-inspection')
    ).toBeLessThan(skills.findIndex((skill) => skill.name === 'custom-app-check'))
  })

  it('prevents deleting built-in skills', () => {
    const skill = listAgentSkills(customRoot).find(
      (candidate) => candidate.name === 'linux-basic-environment-inspection'
    )

    expect(skill).toBeDefined()
    expect(() => deleteAgentSkill(skill?.path ?? '', customRoot)).toThrow(/protected/i)
  })

  it('loads matching built-in skill content into the agent context', () => {
    const context = buildAgentSkillContext(
      'Inspect this Kubernetes cluster version and nodes',
      customRoot
    )

    expect(context.catalog.map((skill) => skill.name)).toContain('k8s-version-cluster-inspection')
    expect(context.matched.map((skill) => skill.name)).toContain('k8s-version-cluster-inspection')
    expect(context.promptBlock).toContain('Kubernetes Version-Aware Cluster Inspection')
  })
})
