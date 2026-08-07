import { describe, expect, it } from 'vitest'

import {
  HIGH,
  classifyByStaticRules,
  extractRiskVerb,
  hasHighWriteVerb,
  matchGlobCommand,
  normalizeCommand,
  shouldShowWhitelistEntry
} from './command-guard'

describe('classifyByStaticRules', () => {
  it('classifies read-only describe+logs long chains as low without gray', () => {
    const cmd =
      'kubectl describe pod nginx-7d8f9 -n prod && kubectl logs nginx-7d8f9 -n prod --tail=200 | grep -i error'
    expect(classifyByStaticRules(cmd)).toBe('low')
  })

  it('does not treat 2>/dev/null or >/dev/null as HIGH', () => {
    expect(HIGH.test('kubectl get pods 2>/dev/null')).toBe(false)
    expect(HIGH.test('cat /etc/hosts >/dev/null')).toBe(false)
    expect(classifyByStaticRules('kubectl get pods 2>/dev/null')).toBe('low')
    expect(classifyByStaticRules('cat /etc/hosts >/dev/null')).toBe('low')
  })

  it('treats file redirects as HIGH', () => {
    expect(HIGH.test('echo hi > /tmp/out.txt')).toBe(true)
    expect(classifyByStaticRules('echo hi > /tmp/out.txt')).toBe('high')
  })

  it('classifies rm as high', () => {
    expect(classifyByStaticRules('rm -rf /tmp/foo')).toBe('high')
    expect(hasHighWriteVerb('rm -rf /tmp/foo')).toBe(true)
  })

  it('classifies kubectl delete as high', () => {
    expect(classifyByStaticRules('kubectl delete pod nginx -n prod')).toBe('high')
  })

  it('classifies kubectl exec as high via HIGH rule', () => {
    const cmd =
      'kubectl exec -n monitoring loki-xxx -- curl -s http://localhost:3100/loki/api/v1/labels'
    expect(HIGH.test(cmd)).toBe(true)
    expect(classifyByStaticRules(cmd)).toBe('high')
    expect(extractRiskVerb(cmd)).toBe('kubectl exec')
  })

  it('extractRiskVerb prefers kubectl write verbs', () => {
    expect(extractRiskVerb('rm -rf /tmp/x')).toBe('rm')
    expect(extractRiskVerb('kubectl delete pod x -n y')).toBe('kubectl delete')
  })

  it('extractRiskVerb uses kubectl get for readonly inspection (not change)', () => {
    expect(extractRiskVerb('kubectl get cm promtail-config -n monitoring -o yaml')).toBe(
      'kubectl get'
    )
    expect(extractRiskVerb('kubectl describe pod foo')).toBe('kubectl describe')
    expect(classifyByStaticRules('kubectl get cm promtail-config -n monitoring')).toBe('low')
    expect(extractRiskVerb('kubectl -n monitoring get cm promtail-config')).toBe('kubectl get')
    expect(classifyByStaticRules('kubectl -n monitoring get cm promtail-config')).toBe('low')
  })

  it('shouldShowWhitelistEntry only after high-risk approval', () => {
    expect(
      shouldShowWhitelistEntry({ phase: 'pending', risk: 'high', alreadyAdded: false })
    ).toBe(false)
    expect(
      shouldShowWhitelistEntry({ phase: 'approved', risk: 'high', alreadyAdded: false })
    ).toBe(true)
    expect(
      shouldShowWhitelistEntry({ phase: 'approved', risk: 'high', alreadyAdded: true })
    ).toBe(false)
    expect(
      shouldShowWhitelistEntry({ phase: 'approved', risk: 'low', alreadyAdded: false })
    ).toBe(false)
  })

  it('classifies mixed read/write chains as high', () => {
    const cmd = 'kubectl get pods -A && kubectl delete pod broken -n default'
    expect(classifyByStaticRules(cmd)).toBe('high')
  })

  it('returns gray for unknown commands', () => {
    expect(classifyByStaticRules('helm list -A')).toBe('gray')
    expect(classifyByStaticRules('python3 inspect_cluster.py')).toBe('gray')
  })
})

describe('hasHighWriteVerb (timeout fallback)', () => {
  it('is true for HIGH verbs and false for readonly', () => {
    expect(hasHighWriteVerb('kubectl delete ns demo')).toBe(true)
    expect(hasHighWriteVerb('kubectl get pods -A')).toBe(false)
    expect(hasHighWriteVerb('helm list')).toBe(false)
  })
})

describe('normalizeCommand', () => {
  it('replaces pod names, namespaces, numbers, and IP/ports with *', () => {
    expect(normalizeCommand('kubectl describe pod nginx-abc-123 -n production')).toBe(
      'kubectl describe pod * -n *'
    )
    expect(normalizeCommand('kubectl logs my-pod -n kube-system --tail=100')).toBe(
      'kubectl logs * -n * --tail=*'
    )
    expect(normalizeCommand('curl -s http://10.0.0.5:8080/health')).toBe('curl -s http://*/health')
  })

  it('preserves flags and subcommand verbs', () => {
    expect(normalizeCommand('kubectl get pods -A --no-headers')).toBe(
      'kubectl get pods -A --no-headers'
    )
  })
})

describe('matchGlobCommand', () => {
  it('matches normalized equivalents and * wildcards', () => {
    const pattern = normalizeCommand('kubectl describe pod foo -n bar')
    expect(matchGlobCommand('kubectl describe pod other-pod -n other-ns', pattern)).toBe(true)
    expect(matchGlobCommand('kubectl get pods -A', 'kubectl get *')).toBe(true)
    expect(matchGlobCommand('rm -rf /tmp/x', 'kubectl get *')).toBe(false)
  })
})
