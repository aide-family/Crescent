import { describe, expect, it } from 'vitest'

import { applyLocalCommandPolicy, parseAuditResult } from './command-auditor'

describe('parseAuditResult', () => {
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
})
