import { describe, expect, it } from 'vitest'

import { applyLocalCommandPolicy, parseAuditResult } from './command-auditor'

describe('parseAuditResult', () => {
  it('parses JSON wrapped in markdown fences', () => {
    const audit = parseAuditResult(
      [
        'Here is the review:',
        '```json',
        JSON.stringify({
          summary: 'Read-only hostname check.',
          operationReason: 'Confirm local context before connecting.',
          risk: 'low',
          requiresApproval: false,
          riskPoints: ['None'],
          impactAnalysis: 'No state change.',
          recommendation: 'Safe to run.'
        }),
        '```'
      ].join('\n'),
      'zh-CN'
    )

    expect(audit.risk).toBe('low')
    expect(audit.requiresApproval).toBe(false)
    expect(audit.summary).toContain('hostname')
  })

  it('respects explicit no-approval decisions for bounded read-only inspections', () => {
    const audit = parseAuditResult(
      JSON.stringify({
        summary: 'Collect CPU information with read-only commands.',
        operationReason: 'The user asked for a cluster CPU hardware inventory.',
        risk: 'medium',
        requiresApproval: false,
        riskPoints: ['The command opens multiple SSH sessions.'],
        impactAnalysis: 'No system state is changed.',
        recommendation: 'The read-only collection can run.'
      })
    )

    expect(audit.risk).toBe('medium')
    expect(audit.requiresApproval).toBe(false)
  })

  it('falls back to approval for non-low risk when the auditor omits the decision', () => {
    const audit = parseAuditResult(
      JSON.stringify({
        summary: 'Command reviewed.',
        operationReason: 'The command is intended to address the user request.',
        risk: 'medium',
        riskPoints: ['The audit result omitted whether approval is required.'],
        impactAnalysis: 'Impact is unknown.',
        recommendation: 'Manual confirmation is required.'
      })
    )

    expect(audit.requiresApproval).toBe(true)
  })

  it('localizes fallback audit fields for Chinese UI mode', () => {
    const audit = parseAuditResult(JSON.stringify({ risk: 'low' }), 'zh-CN')

    expect(audit.summary).toContain('命令')
    expect(audit.operationReason).toContain('操作原因')
    expect(audit.impactAnalysis).toContain('系统变更')
  })

  it('requires approval when a generated report is written to a terminal default path', () => {
    const audit = applyLocalCommandPolicy(
      'cat <<EOF > /root/inspection-report.md\n# Report\nEOF',
      'inspect the cluster and write a report',
      {
        summary: 'Review completed.',
        operationReason: 'The user requested cluster inspection.',
        risk: 'low',
        requiresApproval: false,
        riskPoints: [],
        impactAnalysis: 'No system-changing impact is expected.',
        recommendation: 'Run the read-only command.'
      },
      'en'
    )

    expect(audit.risk).toBe('medium')
    expect(audit.requiresApproval).toBe(true)
    expect(audit.recommendation).toContain('confirm a target directory')
  })

  it('requires approval when ssh violates a current-terminal-only constraint', () => {
    const audit = applyLocalCommandPolicy(
      "ssh 10.42.131.142 'df -hT /home'",
      '不要重新 SSH，基于当前终端处理 10.42.131.142 的 /home 磁盘告警',
      {
        summary: 'Read-only disk check.',
        operationReason: 'The command checks the alerted filesystem.',
        risk: 'low',
        requiresApproval: false,
        riskPoints: [],
        impactAnalysis: 'No system-changing impact is expected.',
        recommendation: 'Run the read-only command.'
      },
      'zh-CN'
    )

    expect(audit.risk).toBe('medium')
    expect(audit.requiresApproval).toBe(true)
    expect(audit.riskPoints.join('\n')).toContain('不要重新 SSH')
    expect(audit.recommendation).toContain('确认是否允许重新连接')
  })

  it('does not require approval for ordinary read-only ssh without a no-reconnect constraint', () => {
    const audit = applyLocalCommandPolicy(
      "ssh 10.42.131.142 'df -hT /home'",
      '处理 10.42.131.142 的 /home 磁盘告警',
      {
        summary: 'Read-only disk check.',
        operationReason: 'The command checks the alerted filesystem.',
        risk: 'low',
        requiresApproval: false,
        riskPoints: [],
        impactAnalysis: 'No system-changing impact is expected.',
        recommendation: 'Run the read-only command.'
      },
      'zh-CN'
    )

    expect(audit.risk).toBe('low')
    expect(audit.requiresApproval).toBe(false)
  })

  it('ignores Crescent post-login wrapper text when the original task did not forbid ssh', () => {
    const audit = applyLocalCommandPolicy(
      "ssh 10.42.131.142 'df -hT /home'",
      [
        '当前终端已经完成 Crescent 目标连接登录。不要重新匹配 Crescent 连接。',
        '',
        '用户原始任务',
        '处理 10.42.131.142 的 /home 磁盘告警'
      ].join('\n'),
      {
        summary: 'Read-only disk check.',
        operationReason: 'The command checks the alerted filesystem.',
        risk: 'low',
        requiresApproval: false,
        riskPoints: [],
        impactAnalysis: 'No system-changing impact is expected.',
        recommendation: 'Run the read-only command.'
      },
      'zh-CN'
    )

    expect(audit.risk).toBe('low')
    expect(audit.requiresApproval).toBe(false)
  })
})
