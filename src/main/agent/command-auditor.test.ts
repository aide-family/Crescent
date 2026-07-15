import { describe, expect, it } from 'vitest'

import { parseAuditResult } from './command-auditor'

describe('parseAuditResult', () => {
  it('respects explicit no-approval decisions for bounded read-only inspections', () => {
    const audit = parseAuditResult(
      JSON.stringify({
        summary: '只读采集 CPU 信息。',
        operationReason: '用户要求统计集群 CPU 硬件信息。',
        risk: 'medium',
        requiresApproval: false,
        riskPoints: ['会批量建立 SSH 连接。'],
        impactAnalysis: '不会修改系统状态。',
        recommendation: '可直接执行只读采集。'
      }),
      'zh-CN'
    )

    expect(audit.risk).toBe('medium')
    expect(audit.requiresApproval).toBe(false)
  })

  it('falls back to approval for non-low risk when the auditor omits the decision', () => {
    const audit = parseAuditResult(
      JSON.stringify({
        summary: '命令已审核。',
        operationReason: '需要处理用户请求。',
        risk: 'medium',
        riskPoints: ['审核结果缺少是否需要批准。'],
        impactAnalysis: '影响未知。',
        recommendation: '需要人工确认。'
      }),
      'zh-CN'
    )

    expect(audit.requiresApproval).toBe(true)
  })
})
