import { describe, expect, it } from 'vitest'

import {
  findLastRetryFailureDetail,
  isPlaceholderDoneText,
  resolveSuccessfulAgentResult
} from './agent-run-finalize'
import type { AgentRunViewState } from './terminal-tabs'

function runWithSteps(steps: AgentRunViewState['steps']): AgentRunViewState {
  return { logId: 1, actions: [], steps }
}

describe('agent-run-finalize', () => {
  it('finds the latest Retrying / InvalidParameter status', () => {
    const run = runWithSteps([
      { id: '1', kind: 'status', title: 'Using provider/model' },
      {
        id: '2',
        kind: 'status',
        title:
          'Retrying (1/2): 400: {"code":"InvalidParameter","message":"invalid value: \'developer\'","type":"BadRequest"}'
      }
    ])
    expect(findLastRetryFailureDetail(run)).toContain('InvalidParameter')
  })

  it('treats Done placeholder after API retry as failure', () => {
    const run = runWithSteps([
      {
        id: '1',
        kind: 'status',
        title: 'Retrying (2/2): 400: {"code":"InvalidParameter","type":"BadRequest"}'
      }
    ])
    expect(
      resolveSuccessfulAgentResult({
        text: 'Done.',
        run,
        doneFallback: 'Done.'
      })
    ).toEqual({
      ok: false,
      error: 'Retrying (2/2): 400: {"code":"InvalidParameter","type":"BadRequest"}'
    })
  })

  it('keeps real assistant text even if a retry status exists', () => {
    const run = runWithSteps([
      {
        id: '1',
        kind: 'status',
        title: 'Retrying (1/2): temporary error'
      }
    ])
    expect(
      resolveSuccessfulAgentResult({
        text: 'Loki is healthy.',
        run,
        doneFallback: 'Done.'
      })
    ).toEqual({ ok: true, text: 'Loki is healthy.' })
  })

  it('detects placeholder Done text', () => {
    expect(isPlaceholderDoneText(undefined, 'Done.')).toBe(true)
    expect(isPlaceholderDoneText('Done.', 'Done.')).toBe(true)
    expect(isPlaceholderDoneText('完成。', '完成。')).toBe(true)
    expect(isPlaceholderDoneText('Loki ok', 'Done.')).toBe(false)
  })

  it('does not treat quota exhaustion as a successful Done result', () => {
    const run: AgentRunViewState = {
      logId: 1,
      actions: [],
      steps: [
        {
          id: '1',
          kind: 'status',
          title: '模型配额已用尽',
          detail: '⚠️ 模型服务配额已用尽（DeepSeek），预计约 5 分钟后恢复。'
        }
      ],
      error: '⚠️ 模型服务配额已用尽（DeepSeek），预计约 5 分钟后恢复。',
      errorKind: 'quota',
      errorProvider: 'DeepSeek',
      errorResetHint: '约 5 分钟后'
    }
    expect(
      resolveSuccessfulAgentResult({
        text: 'Done.',
        run,
        doneFallback: 'Done.'
      })
    ).toEqual({
      ok: false,
      error: '⚠️ 模型服务配额已用尽（DeepSeek），预计约 5 分钟后恢复。'
    })
  })
})
