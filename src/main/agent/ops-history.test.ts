import { describe, expect, it } from 'vitest'

import {
  buildOpsFeedbackSummarizeSource,
  formatOpsHistoryContext,
  parseOpsFeedbackSummary
} from './ops-history'
import type { OpsHistoryRecord, StoredAgentRun } from './types'

describe('ops history helpers', () => {
  it('formats positive and negative examples for prompt injection', () => {
    const records: OpsHistoryRecord[] = [
      {
        id: '1',
        tabId: 'tab',
        connectionId: 'conn-1',
        runId: 'run-1',
        rating: 'like',
        userGoal: 'check kubelet',
        pathSummary: 'systemctl status kubelet',
        lesson: 'direct service check first',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: '2',
        tabId: 'tab',
        connectionId: 'conn-1',
        runId: 'run-2',
        rating: 'dislike',
        userGoal: 'fix dns',
        pathSummary: 'restart all pods blindly',
        lesson: 'diagnose CoreDNS before restarting workloads',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]

    const block = formatOpsHistoryContext(records)
    expect(block).toContain('Positive ops paths')
    expect(block).toContain('systemctl status kubelet')
    expect(block).toContain('Negative ops paths')
    expect(block).toContain('diagnose CoreDNS')
    expect(block).toContain('THIS connection/terminal')
    expect(block).toContain('NOT SOP/wiki documents')
    expect(block).toContain('unrated runs are not reference material')
  })

  it('parses JSON ops feedback summaries', () => {
    expect(
      parseOpsFeedbackSummary(
        '{"pathSummary":"1) check nodes 2) inspect kubelet","lesson":"verify node health first"}'
      )
    ).toEqual({
      pathSummary: '1) check nodes 2) inspect kubelet',
      lesson: 'verify node health first'
    })
  })

  it('builds summarize source from run trace and output', () => {
    const run: StoredAgentRun = {
      runId: 'run-1',
      tabId: 'tab',
      input: 'inspect cluster',
      status: 'success',
      output: 'cluster is healthy',
      trace: {
        version: 1,
        runId: 'run-1',
        tabId: 'tab',
        input: 'inspect cluster',
        status: 'success',
        steps: [{ index: 1, title: 'List nodes', detail: 'kubectl get nodes' }]
      }
    }

    const source = buildOpsFeedbackSummarizeSource(run)
    expect(source).toContain('inspect cluster')
    expect(source).toContain('kubectl get nodes')
    expect(source).toContain('cluster is healthy')
  })
})
