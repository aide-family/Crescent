import { describe, expect, it } from 'vitest'

import { dictionaries } from '../i18n'
import {
  AGENT_RUN_DOCUMENT_MARKER,
  formatAgentRunDocument,
  parseAgentRunDocument
} from './agent-run-document'

const t = dictionaries['zh-CN']

describe('agent-run-document', () => {
  it('coalesces structured runs and round-trips through parse', () => {
    const serialized = formatAgentRunDocument(
      {
        logId: 1,
        actions: [],
        thinkingText: '用户要求查看 Loki',
        steps: [
          {
            id: 's1',
            kind: 'status',
            title: '开始运行 Agent',
            detail: 'workspace'
          },
          {
            id: 't1',
            kind: 'tool',
            name: 'bash',
            phase: 'finished',
            command: 'kubectl get pods -n monitoring',
            resultText: 'loki-xxx Running',
            isError: false
          }
        ],
        result: 'Loki 当前健康。'
      },
      t
    )

    expect(serialized.startsWith(AGENT_RUN_DOCUMENT_MARKER)).toBe(true)

    const parsed = parseAgentRunDocument(serialized, t)
    expect(parsed?.version).toBe(2)
    expect(parsed?.thinkingText).toBe('用户要求查看 Loki')
    expect(parsed?.steps).toHaveLength(2)
    expect(parsed?.resultMarkdown).toBe('Loki 当前健康。')
    expect(parsed?.steps[1]).toMatchObject({
      kind: 'tool',
      name: 'bash',
      command: 'kubectl get pods -n monitoring'
    })
  })

  it('still parses legacy markdown runs', () => {
    const markdown = [
      `**${t.input.actions}**`,
      '',
      '- 开始运行 Agent',
      '',
      `**${t.input.result}**`,
      '',
      'done'
    ].join('\n')

    const parsed = parseAgentRunDocument(markdown, t)
    expect(parsed?.version).toBe(1)
    expect(parsed?.resultMarkdown).toBe('done')
    expect(parsed?.actionsMarkdown).toContain('开始运行 Agent')
  })
})
