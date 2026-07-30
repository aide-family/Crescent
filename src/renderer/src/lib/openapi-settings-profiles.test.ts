import { describe, expect, it } from 'vitest'

import type { AgentConfig } from '../../../shared/agent-types'
import {
  createEmptyOpenApiProfile,
  updateOpenApiProfileInConfig,
  withActiveOpenApiProfile
} from '../../../shared/openapi-profiles'
import { filterOpenApiValidationTools } from './openapi-settings'

function configWithProfiles(): AgentConfig {
  const prod = {
    ...createEmptyOpenApiProfile('prod'),
    name: 'Prod',
    baseUrl: 'https://prod.example/v1',
    document: '{"openapi":"3.0.0","paths":{}}',
    timeoutMs: 20_000
  }
  const staging = {
    ...createEmptyOpenApiProfile('staging'),
    name: 'Staging',
    baseUrl: 'https://staging.example/v1',
    document: '/tmp/staging.openapi.json',
    timeoutMs: 10_000
  }

  return {
    providers: [],
    model: '',
    agentMode: 'react',
    maxActiveTools: 5,
    commandWhitelist: [],
    openApiProfiles: [prod, staging],
    openApiProfileId: 'prod',
    openApiBaseUrl: prod.baseUrl,
    openApiDocument: prod.document,
    openApiTimeoutMs: prod.timeoutMs,
    openApiMaxRetries: prod.maxRetries,
    openApiRetryBackoffMs: prod.retryBackoffMs,
    skillRoot: '~/.agents/skills',
    mcpServers: []
  }
}

describe('openapi settings validation helpers', () => {
  it('filters validation catalog to OpenAPI tools only', () => {
    const tools = filterOpenApiValidationTools({
      ok: true,
      modelOk: true,
      toolCount: 3,
      tools: [
        {
          name: 'execute_terminal_command',
          method: 'post',
          path: 'terminal://current-session',
          description: 'terminal',
          source: 'built-in'
        },
        {
          name: 'listPets',
          method: 'get',
          path: '/pets',
          description: 'list',
          source: 'openapi'
        },
        {
          name: 'mcp_echo',
          method: 'post',
          path: 'mcp://server/echo',
          description: 'mcp',
          source: 'mcp'
        }
      ]
    })

    expect(tools.map((tool) => tool.name)).toEqual(['listPets'])
  })
})

describe('openapi settings profile switching', () => {
  it('switches active profile fields used by settings UI', () => {
    const switched = withActiveOpenApiProfile(configWithProfiles(), 'staging')

    expect(switched.openApiProfileId).toBe('staging')
    expect(switched.openApiBaseUrl).toBe('https://staging.example/v1')
    expect(switched.openApiDocument).toBe('/tmp/staging.openapi.json')
    expect(switched.openApiTimeoutMs).toBe(10_000)
  })

  it('patches the active profile document after import', () => {
    const next = updateOpenApiProfileInConfig(configWithProfiles(), 'prod', {
      document: '/Users/demo/openapi.yaml'
    })

    expect(next.openApiProfiles.find((profile) => profile.id === 'prod')?.document).toBe(
      '/Users/demo/openapi.yaml'
    )
    expect(next.openApiDocument).toBe('/Users/demo/openapi.yaml')
  })
})
