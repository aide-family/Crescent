import { describe, expect, it } from 'vitest'

import en from '../i18n/en'
import {
  formatCommandAuditActionDetail,
  formatCommandAuditDetail,
  riskLabel
} from './agent-event-formatters'

describe('command approval formatters', () => {
  const t = en
  const audit = {
    summary: 'Deletes production data',
    operationReason: 'User asked to clean old orders',
    risk: 'high' as const,
    requiresApproval: true,
    riskPoints: ['Destructive delete', 'Targets production'],
    impactAnalysis: 'May permanently remove records',
    recommendation: 'Confirm the exact filter before approving'
  }

  it('formats full approval detail for high-risk commands', () => {
    const detail = formatCommandAuditDetail('rm -rf /data/orders', audit, t)

    expect(detail).toContain(t.commandReview.command)
    expect(detail).toContain('rm -rf /data/orders')
    expect(detail).toContain(audit.summary)
    expect(detail).toContain(audit.operationReason)
    expect(detail).toContain(riskLabel('high', t))
    expect(detail).toContain('Destructive delete')
    expect(detail).toContain(audit.recommendation)
  })

  it('keeps low-risk read-only audits compact', () => {
    const detail = formatCommandAuditActionDetail(
      'kubectl get pods',
      {
        ...audit,
        summary: 'Read-only inspection',
        risk: 'low',
        requiresApproval: false,
        riskPoints: []
      },
      t
    )

    expect(detail).toContain('kubectl get pods')
    expect(detail).toContain('Read-only inspection')
    expect(detail).not.toContain(t.commandReview.impactAnalysis)
    expect(detail).not.toContain(t.commandReview.recommendation)
  })
})
