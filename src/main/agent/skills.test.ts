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
        'k8s-cluster-architecture-mermaid',
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
    expect(skills.find((skill) => skill.name === 'k8s-cluster-architecture-mermaid')?.aliases).toEqual(
      expect.arrayContaining(['整理集群网络架构图', 'K8s network topology diagram'])
    )
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

  it('matches the built-in Kubernetes architecture Mermaid skill', () => {
    const context = buildAgentSkillContext(
      'Map this k8s cluster architecture and produce a mermaid diagram',
      customRoot
    )

    expect(context.catalog.map((skill) => skill.name)).toContain(
      'k8s-cluster-architecture-mermaid'
    )
    expect(context.matched.map((skill) => skill.name)).toContain(
      'k8s-cluster-architecture-mermaid'
    )
    expect(context.promptBlock).toContain('Kubernetes Cluster Architecture Mermaid Mapping')
  })

  it('does not load weak single-token skill matches when a stronger skill is available', () => {
    for (const [directory, name, description] of [
      ['document-management', 'document-management', '创建和编辑文档，整理文档目录。'],
      ['file-management', 'file-management', '上传和下载文件，整理文件目录。'],
      [
        'table-management',
        'table-management',
        '用于表格字段管理、记录读写、视图配置、历史查询。'
      ],
      [
        'meeting-summary',
        'meeting-summary',
        '会议纪要整理工作流：汇总会议纪要并生成结构化报告。'
      ]
    ]) {
      const skillDir = join(customRoot, directory)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`].join(
          '\n'
        ),
        'utf8'
      )
    }

    const context = buildAgentSkillContext('整理目标集群网络架构', customRoot)
    const matchedNames = context.matched.map((skill) => skill.name)

    expect(matchedNames).toContain('k8s-cluster-architecture-mermaid')
    expect(matchedNames).not.toContain('document-management')
    expect(matchedNames).not.toContain('file-management')
    expect(matchedNames).not.toContain('table-management')
    expect(matchedNames).not.toContain('meeting-summary')

    const diagramContext = buildAgentSkillContext('整理生产集群网络架构图', customRoot)
    const diagramMatchedNames = diagramContext.matched.map((skill) => skill.name)

    expect(diagramMatchedNames).toContain('k8s-cluster-architecture-mermaid')
    expect(diagramMatchedNames).not.toContain('document-management')
    expect(diagramMatchedNames).not.toContain('file-management')
    expect(diagramMatchedNames).not.toContain('table-management')
    expect(diagramMatchedNames).not.toContain('meeting-summary')
  })

  it('prefers the system Kubernetes architecture skill over user Lark skills with generic organize wording', () => {
    for (const [directory, name, description] of [
      [
        'lark-doc',
        'lark-doc',
        '飞书云文档：创建和编辑飞书文档。从 Markdown 创建文档、获取文档内容、更新文档、上传和下载文档中的图片和文件、搜索云空间文档。当用户需要创建或编辑飞书文档、读取文档内容、在文档中插入图片、搜索云空间文档时使用。'
      ],
      [
        'lark-drive',
        'lark-drive',
        '飞书云空间：管理云空间中的文件和文件夹。上传和下载文件、创建文件夹、复制/移动/删除文件、查看文件元数据、管理文档权限；也负责把本地文件导入为飞书在线云文档。当用户需要上传或下载文件、整理云空间目录、查看文件详情时使用。'
      ],
      [
        'lark-workflow-meeting-summary',
        'lark-workflow-meeting-summary',
        '会议纪要整理工作流：汇总指定时间范围内的会议纪要并生成结构化报告。当用户需要整理会议纪要、生成会议周报、回顾一段时间内的会议内容时使用。'
      ]
    ]) {
      const skillDir = join(customRoot, directory)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`].join(
          '\n'
        ),
        'utf8'
      )
    }

    const context = buildAgentSkillContext('整理aide集群网络架构图', customRoot)
    const matchedNames = context.matched.map((skill) => skill.name)

    expect(matchedNames[0]).toBe('k8s-cluster-architecture-mermaid')
    expect(matchedNames).not.toContain('lark-doc')
    expect(matchedNames).not.toContain('lark-drive')
    expect(matchedNames).not.toContain('lark-workflow-meeting-summary')
  })

  it.each([
    ['整理aide集群网络架构图', 'k8s-cluster-architecture-mermaid'],
    ['整理生产集群网络架构图', 'k8s-cluster-architecture-mermaid'],
    ['检查 Docker 容器网络和卷使用情况', 'docker-environment-inspection'],
    ['巡检 Linux 主机内存磁盘DNS和系统服务', 'linux-basic-environment-inspection'],
    ['排查应用服务端口日志和健康检查接口', 'application-program-inspection'],
    ['检查应用域名 DNS 解析和 HTTPS TLS 连通性', 'application-network-research'],
    ['巡检 K8s 集群版本节点Pod事件和存储状态', 'k8s-version-cluster-inspection']
  ])('matches built-in system skill for %s', (input, expectedSkillName) => {
    const context = buildAgentSkillContext(input, customRoot)

    expect(context.matched.map((skill) => skill.name)).toContain(expectedSkillName)
  })
})
