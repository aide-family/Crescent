import { describe, expect, it } from 'vitest'

import { legacyActionsMarkdownToSteps } from './legacy-actions-to-steps'

describe('legacyActionsMarkdownToSteps', () => {
  it('converts bullets into status and tool steps', () => {
    const steps = legacyActionsMarkdownToSteps(
      ['- 开始运行 Agent', '- 调用工具: bash', '- 读取文件'].join('\n')
    )
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatchObject({ kind: 'status', title: '开始运行 Agent' })
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'bash', phase: 'finished' })
    expect(steps[2]).toMatchObject({ kind: 'status', title: '读取文件' })
  })

  it('converts detail headings with command blocks', () => {
    const steps = legacyActionsMarkdownToSteps(
      ['#### 1. 调用工具: bash', '', 'Command:', 'kubectl get pods', '', 'Output:', 'ok'].join('\n')
    )
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      kind: 'tool',
      name: 'bash',
      command: 'kubectl get pods'
    })
  })
})
