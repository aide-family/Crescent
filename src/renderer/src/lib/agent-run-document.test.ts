import { describe, expect, it } from 'vitest'

import { dictionaries } from '../i18n'
import {
  AGENT_RUN_DOCUMENT_MARKER,
  closeStreamingOpenSteps,
  formatAgentRunDocument,
  isDuplicateResultMessage,
  omitDuplicateTrailingMessage,
  parseAgentRunDocument,
  shouldShowAgentRunResult
} from './agent-run-document'

const t = dictionaries['zh-CN']

describe('agent-run-document', () => {
  it('coalesces structured runs and round-trips through parse', () => {
    const serialized = formatAgentRunDocument(
      {
        logId: 1,
        actions: [],
        thinkingText: '用户要求查看 Loki\n\n发现是 Kubernetes 环境',
        steps: [
          {
            id: 'th1',
            kind: 'thought',
            text: '用户要求查看 Loki',
            phase: 'done'
          },
          {
            id: 't1',
            kind: 'tool',
            name: 'bash',
            phase: 'finished',
            command: 'kubectl get pods -n monitoring',
            resultText: 'loki-xxx Running',
            isError: false
          },
          {
            id: 'th2',
            kind: 'thought',
            text: '发现是 Kubernetes 环境',
            phase: 'done'
          }
        ],
        result: 'Loki 当前健康。'
      },
      t
    )

    expect(serialized.startsWith(AGENT_RUN_DOCUMENT_MARKER)).toBe(true)

    const parsed = parseAgentRunDocument(serialized, t)
    expect(parsed?.version).toBe(2)
    expect(parsed?.thinkingText).toBe('用户要求查看 Loki\n\n发现是 Kubernetes 环境')
    expect(parsed?.steps).toHaveLength(3)
    expect(parsed?.resultMarkdown).toBe('Loki 当前健康。')
    expect(parsed?.steps[0]).toMatchObject({
      kind: 'thought',
      text: '用户要求查看 Loki',
      phase: 'done'
    })
    expect(parsed?.steps[1]).toMatchObject({
      kind: 'tool',
      name: 'bash',
      command: 'kubectl get pods -n monitoring'
    })
    expect(parsed?.steps[2]).toMatchObject({
      kind: 'thought',
      text: '发现是 Kubernetes 环境'
    })
  })

  it('upgrades legacy top-level thinkingText into a thought step', () => {
    const serialized = [
      AGENT_RUN_DOCUMENT_MARKER,
      JSON.stringify({
        version: 2,
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
      })
    ].join('\n')

    const parsed = parseAgentRunDocument(serialized, t)
    expect(parsed?.thinkingText).toBe('用户要求查看 Loki')
    expect(parsed?.steps[0]).toMatchObject({
      kind: 'thought',
      text: '用户要求查看 Loki',
      phase: 'done'
    })
    expect(parsed?.steps[1]).toMatchObject({ kind: 'status', title: '开始运行 Agent' })
    expect(parsed?.steps[2]).toMatchObject({ kind: 'tool', name: 'bash' })
  })

  it('still parses legacy markdown runs into timeline steps', () => {
    const markdown = [
      `**${t.input.actions}**`,
      '',
      '- 开始运行 Agent',
      '- 调用工具: bash',
      '',
      `**${t.input.result}**`,
      '',
      'done'
    ].join('\n')

    const parsed = parseAgentRunDocument(markdown, t)
    expect(parsed?.version).toBe(2)
    expect(parsed?.resultMarkdown).toBe('done')
    expect(parsed?.steps.length).toBeGreaterThan(0)
    expect(parsed?.steps.some((step) => step.kind === 'status')).toBe(true)
    expect(parsed?.steps.some((step) => step.kind === 'tool' && step.name === 'bash')).toBe(true)
  })

  it('round-trips message steps and does not require result until finished', () => {
    const serialized = formatAgentRunDocument(
      {
        logId: 2,
        actions: [],
        steps: [
          {
            id: 'm1',
            kind: 'message',
            text: '先确认 Loki 是否在 monitoring 命名空间。',
            phase: 'done'
          },
          {
            id: 't1',
            kind: 'tool',
            name: 'bash',
            phase: 'finished',
            command: 'kubectl get pods -n monitoring | grep loki',
            resultText: 'loki-write-0 Running',
            isError: false
          },
          {
            id: 'm2',
            kind: 'message',
            text: 'Pod 在跑，接着检查 ready 端点。',
            phase: 'done'
          }
        ],
        result: 'Loki 服务健康。',
        elapsedMs: 4200
      },
      t
    )

    const parsed = parseAgentRunDocument(serialized, t)
    expect(parsed?.steps).toHaveLength(3)
    expect(parsed?.steps[0]).toMatchObject({
      kind: 'message',
      text: '先确认 Loki 是否在 monitoring 命名空间。',
      phase: 'done'
    })
    expect(parsed?.steps[2]).toMatchObject({
      kind: 'message',
      text: 'Pod 在跑，接着检查 ready 端点。'
    })
    expect(parsed?.resultMarkdown).toBe('Loki 服务健康。')
    expect(parsed?.elapsedMs).toBe(4200)
  })

  it('shouldShowAgentRunResult only when elapsedMs is set', () => {
    expect(shouldShowAgentRunResult({ hasResultContent: true })).toBe(false)
    expect(shouldShowAgentRunResult({ hasResultContent: true, elapsedMs: 100 })).toBe(true)
    expect(shouldShowAgentRunResult({ hasResultContent: false, elapsedMs: 100 })).toBe(false)
  })

  it('detects duplicate result messages including containment', () => {
    expect(isDuplicateResultMessage('same', 'same')).toBe(true)
    const long = `${'x'.repeat(201)}TAIL`
    expect(isDuplicateResultMessage(long, 'TAIL')).toBe(true)
    expect(isDuplicateResultMessage('TAIL', long)).toBe(true)
    expect(isDuplicateResultMessage('a', 'b')).toBe(false)
  })

  it('omits trailing duplicate message without leaving a placeholder', () => {
    const steps = omitDuplicateTrailingMessage(
      [
        { id: '1', kind: 'message', text: 'hello', phase: 'done' },
        { id: '2', kind: 'tool', name: 'bash', phase: 'finished' },
        { id: '3', kind: 'message', text: 'final report', phase: 'done' }
      ],
      'final report'
    )
    expect(steps).toHaveLength(2)
    expect(steps.map((step) => step.id)).toEqual(['1', '2'])
  })

  it('closes streaming message and thought steps together', () => {
    const closed = closeStreamingOpenSteps([
      { id: 'th', kind: 'thought', text: '推理中', phase: 'streaming' },
      { id: 'msg', kind: 'message', text: '引导中', phase: 'streaming' }
    ])
    expect(closed[0]).toMatchObject({ kind: 'thought', phase: 'done' })
    expect(closed[1]).toMatchObject({ kind: 'message', phase: 'done' })
  })
})
