import { describe, expect, it } from 'vitest'

import { parseWikiHeadings } from './wiki'

describe('wiki heading parsing', () => {
  it('extracts markdown headings for knowledge base navigation', () => {
    expect(
      parseWikiHeadings(['# 总览', '', '## 操作步骤', '### 验证', '##### 不进入导航'].join('\n'))
    ).toEqual([
      { level: 1, text: '总览', index: 0 },
      { level: 2, text: '操作步骤', index: 1 },
      { level: 3, text: '验证', index: 2 }
    ])
  })

  it('ignores headings inside fenced code blocks', () => {
    expect(
      parseWikiHeadings(
        [
          '# 可见标题',
          '',
          '```bash',
          '#!/usr/bin/env bash',
          '# 代码注释',
          '```',
          '',
          '## 后续标题'
        ].join('\n')
      )
    ).toEqual([
      { level: 1, text: '可见标题', index: 0 },
      { level: 2, text: '后续标题', index: 1 }
    ])
  })

  it('keeps heading indexes aligned when a markdown fence contains nested fence examples', () => {
    expect(
      parseWikiHeadings(
        [
          '# 巡检 SOP',
          '',
          '```markdown',
          '# 示例文档标题',
          '',
          '## 示例步骤',
          '',
          '```bash',
          'kubectl get nodes',
          '```',
          '',
          '## 实际步骤'
        ].join('\n')
      )
    ).toEqual([
      { level: 1, text: '巡检 SOP', index: 0 },
      { level: 2, text: '实际步骤', index: 1 }
    ])
  })
})
