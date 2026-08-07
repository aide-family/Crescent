import { describe, expect, it } from 'vitest'

import { extractResultSuggestions } from './result-suggestions'

describe('extractResultSuggestions', () => {
  it('extracts numbered items under 修复建议', () => {
    const md = [
      '## 概览',
      '集群整体健康。',
      '',
      '**🔧 修复建议**',
      '1. 重启 Loki pod',
      '2. 扩大 PVC 容量',
      '3. 检查存储类',
      '',
      '## 其他'
    ].join('\n')

    expect(extractResultSuggestions(md)).toEqual([
      '重启 Loki pod',
      '扩大 PVC 容量',
      '检查存储类'
    ])
  })

  it('extracts bullet items under Recommendations', () => {
    const md = ['## Recommendations', '- Restart the service', '- Clear the cache'].join('\n')
    expect(extractResultSuggestions(md)).toEqual(['Restart the service', 'Clear the cache'])
  })

  it('falls back to trailing numbered list when no titled section', () => {
    const md = ['Some analysis.', '', '1. Do A', '2. Do B'].join('\n')
    expect(extractResultSuggestions(md)).toEqual(['Do A', 'Do B'])
  })
})
