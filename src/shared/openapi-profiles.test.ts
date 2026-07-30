import { describe, expect, it } from 'vitest'

import type { AgentConfig } from './agent-types'
import {
  createEmptyOpenApiProfile,
  normalizeOpenApiProfiles,
  projectOpenApiProfileFields,
  updateOpenApiProfileInConfig,
  withActiveOpenApiProfile
} from './openapi-profiles'

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    providers: [],
    model: '',
    agentMode: 'react',
    maxActiveTools: 5,
    commandWhitelist: [],
    openApiProfiles: [],
    openApiBaseUrl: '',
    openApiDocument: '',
    openApiTimeoutMs: 30_000,
    openApiMaxRetries: 2,
    openApiRetryBackoffMs: 300,
    skillRoot: '~/.agents/skills',
    mcpServers: [],
    ...overrides
  }
}

describe('openapi-profiles', () => {
  it('migrates legacy openApi fields into a profile', () => {
    const normalized = normalizeOpenApiProfiles({
      openApiBaseUrl: 'https://api.example/v1',
      openApiDocument: '{"openapi":"3.0.0"}',
      openApiTimeoutMs: 12_000
    })

    expect(normalized.openApiProfiles).toHaveLength(1)
    expect(normalized.openApiProfiles[0]).toMatchObject({
      id: 'legacy-openapi',
      baseUrl: 'https://api.example/v1',
      timeoutMs: 12_000
    })
    expect(normalized.openApiProfileId).toBe('legacy-openapi')
  })

  it('switches active profile and projects fields', () => {
    const first = createEmptyOpenApiProfile('p1')
    const second = {
      ...createEmptyOpenApiProfile('p2'),
      name: 'Staging',
      baseUrl: 'https://staging.example/v1',
      document: '{"openapi":"3.0.0"}',
      timeoutMs: 8_000
    }
    const config = baseConfig({
      openApiProfiles: [first, second],
      openApiProfileId: 'p1',
      ...projectOpenApiProfileFields(first)
    })

    const switched = withActiveOpenApiProfile(config, 'p2')
    expect(switched.openApiProfileId).toBe('p2')
    expect(switched.openApiBaseUrl).toBe('https://staging.example/v1')
    expect(switched.openApiTimeoutMs).toBe(8_000)
  })

  it('updates the active profile fields in place', () => {
    const profile = createEmptyOpenApiProfile('p1')
    const config = baseConfig({
      openApiProfiles: [profile],
      openApiProfileId: 'p1',
      ...projectOpenApiProfileFields(profile)
    })

    const next = updateOpenApiProfileInConfig(config, 'p1', {
      name: 'Prod',
      baseUrl: 'https://prod.example/v1',
      timeoutMs: 45_000
    })

    expect(next.openApiProfiles[0]).toMatchObject({
      name: 'Prod',
      baseUrl: 'https://prod.example/v1',
      timeoutMs: 45_000
    })
    expect(next.openApiBaseUrl).toBe('https://prod.example/v1')
    expect(next.openApiTimeoutMs).toBe(45_000)
  })
})
