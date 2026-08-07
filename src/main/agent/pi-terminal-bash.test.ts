import { describe, expect, it } from 'vitest'

import { normalizeCommand } from '../../shared/command-guard'
import { shouldBlockFailedRetry, withUserApprovalNote } from './pi-terminal-bash'

describe('failed command fingerprint retry block', () => {
  it('blocks the same normalized fingerprint after a prior failure', () => {
    const failed = new Set<string>()
    const fingerprint = normalizeCommand(
      'kubectl exec -n monitoring loki-abc -- curl -s http://localhost:3100/ready'
    )
    expect(shouldBlockFailedRetry(fingerprint, failed)).toBe(false)
    failed.add(fingerprint)
    expect(
      shouldBlockFailedRetry(
        normalizeCommand(
          'kubectl exec -n monitoring loki-xyz -- curl -s http://localhost:3100/ready'
        ),
        failed
      )
    ).toBe(true)
  })

  it('does not block a different command shape', () => {
    const failed = new Set([normalizeCommand('kubectl delete pod x -n y')])
    expect(shouldBlockFailedRetry(normalizeCommand('kubectl get pods -A'), failed)).toBe(false)
  })
})

describe('withUserApprovalNote', () => {
  it('prefixes ok output with User approval note', () => {
    const result = withUserApprovalNote(
      { ok: true, command: 'rm -rf /tmp/x', output: 'done' },
      '请先备份'
    )
    expect(result.output).toContain('User approval note: 请先备份')
    expect(result.output).toContain('done')
  })

  it('prefixes error with User approval note', () => {
    const result = withUserApprovalNote(
      { ok: false, command: 'rm -rf /tmp/x', output: '', error: 'exit 1' },
      '仍要执行'
    )
    expect(result.error).toContain('User approval note: 仍要执行')
    expect(result.error).toContain('exit 1')
  })

  it('leaves result unchanged when note is empty', () => {
    const base = { ok: true, command: 'ls', output: 'a' }
    expect(withUserApprovalNote(base, '  ')).toEqual(base)
  })
})
