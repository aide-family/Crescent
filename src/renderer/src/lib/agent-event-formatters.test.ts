import { describe, expect, it } from 'vitest'

import en from '../i18n/en'
import zhCN from '../i18n/zh-CN'
import {
  formatCommandAuditActionDetail,
  formatCommandAuditDetail,
  formatCommandObservation,
  isNoiseAuditStatusMessage,
  localizeAgentEventMessage,
  riskLabel,
  sanitizeCommandObservation
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

describe('formatCommandObservation', () => {
  const t = en

  it('returns only command output without exit code or elapsed metadata', () => {
    const observation = formatCommandObservation(
      {
        type: 'command',
        phase: 'finished',
        command: 'kubectl get pods -A | grep loki',
        elapsedMs: 417,
        result: {
          ok: true,
          command: 'kubectl get pods -A | grep loki',
          exitCode: 0,
          output: 'monitoring/loki-56d7b8d665-hg88m Running',
          cwd: '/home/aide',
          mode: 'pty'
        }
      },
      t
    )

    expect(observation).toBe('monitoring/loki-56d7b8d665-hg88m Running')
    expect(observation).not.toContain(t.terminal.commandStatus)
    expect(observation).not.toContain(t.terminal.commandExitCode)
    expect(observation).not.toContain(t.input.elapsed)
    expect(observation).not.toContain(t.terminal.terminalMode)
    expect(observation).not.toContain('417')
  })

  it('includes error text when the command failed', () => {
    const observation = formatCommandObservation(
      {
        type: 'command',
        phase: 'finished',
        command: 'false',
        result: {
          ok: false,
          command: 'false',
          exitCode: 1,
          output: 'permission denied',
          error: 'Command failed'
        }
      },
      t
    )

    expect(observation).toContain('Command failed')
    expect(observation).toContain('permission denied')
    expect(observation).not.toContain(t.terminal.commandExitCode)
  })

  it('returns empty string while the command is still running', () => {
    expect(
      formatCommandObservation(
        {
          type: 'command',
          phase: 'started',
          command: 'sleep 1'
        },
        t
      )
    ).toBe('')
  })
})

describe('sanitizeCommandObservation', () => {
  it('keeps Loki success JSON and drops LogQL parse errors', () => {
    const json = '{"status":"success","data":[]}'
    const parseError =
      'parse error at line 1, col 1: syntax error: unexpected IDENTIFIER'
    const sanitized = sanitizeCommandObservation(json, parseError)
    expect(sanitized.output).toBe(json)
    expect(sanitized.error).toBe('')

    const glued = sanitizeCommandObservation(`${json}\n${parseError}`, '')
    expect(glued.output).toBe(json)
    expect(glued.output).not.toContain('parse error')
  })

  it('formatCommandObservation does not surface parse error after success JSON', () => {
    const text = formatCommandObservation(
      {
        type: 'command',
        phase: 'finished',
        command: 'curl -s http://loki/api',
        result: {
          ok: true,
          command: 'curl -s http://loki/api',
          output: '{"status":"success","data":[]}',
          error:
            'parse error at line 1, col 1: syntax error: unexpected IDENTIFIER'
        }
      },
      en
    )
    expect(text).toContain('"status":"success"')
    expect(text).not.toContain('parse error')
  })
})

describe('isNoiseAuditStatusMessage', () => {
  it('flags English audit chatter but keeps analyzing visible', () => {
    const t = en
    expect(isNoiseAuditStatusMessage(t.commandReview.readOnlyAllowed, t)).toBe(true)
    expect(isNoiseAuditStatusMessage(t.commandReview.whitelisted, t)).toBe(true)
    expect(isNoiseAuditStatusMessage(t.commandReview.analyzing, t)).toBe(false)
    expect(isNoiseAuditStatusMessage('Command review subprocess is analyzing risk.', t)).toBe(false)
    expect(isNoiseAuditStatusMessage('Command review is classifying risk.', t)).toBe(false)
    expect(isNoiseAuditStatusMessage(t.commandReview.autoApproved, t)).toBe(true)
    expect(
      isNoiseAuditStatusMessage(`${t.commandReview.title}: ${t.commandReview.lowRisk}`, t)
    ).toBe(true)
    expect(
      isNoiseAuditStatusMessage('Command audit classified this as read-only inspection.', t)
    ).toBe(true)
    expect(isNoiseAuditStatusMessage('Found Loki pod Running', t)).toBe(false)
  })

  it('flags Chinese audit chatter', () => {
    const t = zhCN
    expect(isNoiseAuditStatusMessage(t.commandReview.readOnlyAllowed, t)).toBe(true)
    expect(isNoiseAuditStatusMessage(t.commandReview.whitelisted, t)).toBe(true)
    expect(
      isNoiseAuditStatusMessage(`${t.commandReview.title}: ${t.commandReview.lowRisk}`, t)
    ).toBe(true)
    expect(isNoiseAuditStatusMessage('找到 Loki Pod', t)).toBe(false)
  })
})

describe('localizeAgentEventMessage approval notes', () => {
  it('recognizes User approval note and legacy User note', () => {
    const t = en
    expect(
      localizeAgentEventMessage('Command approved by user.\nUser approval note: backup first', t)
    ).toContain('backup first')
    expect(
      localizeAgentEventMessage('Command approved by user.\nUser note: legacy note', t)
    ).toContain('legacy note')
  })
})
