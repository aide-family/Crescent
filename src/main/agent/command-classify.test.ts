import { describe, expect, it, vi } from 'vitest'

import { COMMAND_AUDIT_TIMEOUT_MS, resolveAuditModel, tryParseAuditLevel } from './command-auditor'
import { classifyCommand } from './command-classify'
import type { AgentConfig } from './types'

vi.mock('./command-auditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./command-auditor')>()
  return {
    ...actual,
    CommandAuditor: class {
      async audit(): Promise<never> {
        throw new actual.CommandAuditTimeoutError()
      }
    }
  }
})

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    providers: [
      {
        id: 'p1',
        name: 'P1',
        baseUrl: 'https://example.com',
        models: [
          { id: 'deepseek-reasoner' },
          { id: 'gpt-4o-mini' },
          { id: 'deepseek-chat' }
        ]
      }
    ],
    providerId: 'p1',
    model: 'deepseek-reasoner',
    agentMode: 'react',
    maxActiveTools: 8,
    commandWhitelist: [],
    openApiProfiles: [],
    openApiBaseUrl: '',
    openApiDocument: '',
    openApiTimeoutMs: 30_000,
    openApiMaxRetries: 0,
    openApiRetryBackoffMs: 0,
    skillRoot: '',
    mcpServers: [],
    ...overrides
  }
}

describe('COMMAND_AUDIT_TIMEOUT_MS', () => {
  it('is 10 seconds', () => {
    expect(COMMAND_AUDIT_TIMEOUT_MS).toBe(10_000)
  })
})

describe('resolveAuditModel', () => {
  it('prefers mini/flash/lite/small/haiku/nano', () => {
    expect(resolveAuditModel(baseConfig()).modelId).toBe('gpt-4o-mini')
    expect(resolveAuditModel(baseConfig()).source).toBe('heuristic')
  })

  it('falls back to config.model when no heuristic match', () => {
    const config = baseConfig({
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://example.com',
          models: [{ id: 'deepseek-reasoner' }, { id: 'claude-opus-pro' }]
        }
      ],
      model: 'deepseek-reasoner'
    })
    expect(resolveAuditModel(config)).toEqual({
      modelId: 'deepseek-reasoner',
      source: 'fallback'
    })
  })
})

describe('tryParseAuditLevel', () => {
  it('parses compact JSON and maps medium to high', () => {
    expect(tryParseAuditLevel('{"level":"low","reason":"只读"}')).toEqual({
      level: 'low',
      reason: '只读'
    })
    expect(tryParseAuditLevel('{"level":"medium","reason":"不确定"}')?.level).toBe('high')
    expect(tryParseAuditLevel('not json')).toBeNull()
  })
})

describe('classifyCommand funnel', () => {
  it('auto-passes read-only long chains via static rules without needing subagent success', async () => {
    const result = await classifyCommand(
      'kubectl describe pod nginx -n prod && kubectl logs nginx -n prod --tail=100',
      { config: baseConfig(), userInput: '巡检' }
    )
    expect(result.level).toBe('low')
    expect(result.source).toBe('rule')
  })

  it('flags rm and kubectl delete as high via rules', async () => {
    const rm = await classifyCommand('rm -rf /tmp/x', {
      config: baseConfig(),
      userInput: 'cleanup'
    })
    expect(rm.level).toBe('high')
    expect(rm.source).toBe('rule')

    const del = await classifyCommand('kubectl delete pod x -n y', {
      config: baseConfig(),
      userInput: 'fix'
    })
    expect(del.level).toBe('high')
    expect(del.source).toBe('rule')
  })

  it('flags kubectl exec as high via rule (not subagent)', async () => {
    const result = await classifyCommand(
      'kubectl exec -n monitoring loki-xxx -- curl -s http://localhost:3100/loki/api/v1/labels',
      { config: baseConfig(), userInput: 'loki' }
    )
    expect(result.level).toBe('high')
    expect(result.source).toBe('rule')
    expect(result.audit.summary).toContain('kubectl exec')
  })

  it('lets HIGH beat a broad whitelist (kubectl *)', async () => {
    const result = await classifyCommand('kubectl delete pod x', {
      config: baseConfig({ commandWhitelist: ['kubectl *'] }),
      userInput: 'cleanup'
    })
    expect(result.level).toBe('high')
    expect(result.source).toBe('rule')
  })

  it('still allows whitelist for non-HIGH commands', async () => {
    const result = await classifyCommand('helm list -A', {
      config: baseConfig({ commandWhitelist: ['helm *'] }),
      userInput: 'inspect'
    })
    expect(result.level).toBe('low')
    expect(result.source).toBe('whitelist')
  })

  it('uses timeout-fallback with HIGH verb detection for gray commands', async () => {
    // helm list is gray; mocked auditor always times out → low (no HIGH verb)
    const low = await classifyCommand('helm list -A', {
      config: baseConfig(),
      userInput: 'inspect'
    })
    expect(low.source).toBe('timeout-fallback')
    expect(low.level).toBe('low')
  })
})
