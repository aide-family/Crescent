import { describe, expect, it } from 'vitest'

import type { AgentConfig } from '../../../shared/agent-types'
import {
  createEmptyOpenApiProfile,
  formatPinnedWorkflowsText,
  parsePinnedWorkflowsText,
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

  it('patches prompt templates, pinned workflows, and tool policies on a profile', () => {
    const next = updateOpenApiProfileInConfig(configWithProfiles(), 'prod', {
      promptTemplate: 'Prefer GET tools first.',
      pinnedWorkflows: [{ id: 'wf-1', name: 'List pets', prompt: 'List all pets via the API.' }],
      toolAllowList: ['listPets'],
      toolDenyList: ['deletePet']
    })

    const prod = next.openApiProfiles.find((profile) => profile.id === 'prod')
    expect(prod?.promptTemplate).toBe('Prefer GET tools first.')
    expect(prod?.pinnedWorkflows).toEqual([
      { id: 'wf-1', name: 'List pets', prompt: 'List all pets via the API.', pinned: true }
    ])
    expect(prod?.toolAllowList).toEqual(['listPets'])
    expect(prod?.toolDenyList).toEqual(['deletePet'])
  })
})

describe('pinned workflow text codec', () => {
  it('round-trips Name | prompt lines', () => {
    const workflows = parsePinnedWorkflowsText(
      'List pets | List all pets via the API.\nCreate pet | Create a pet named Fluffy'
    )
    expect(workflows).toEqual([
      {
        id: 'workflow-1',
        name: 'List pets',
        prompt: 'List all pets via the API.',
        pinned: true
      },
      {
        id: 'workflow-2',
        name: 'Create pet',
        prompt: 'Create a pet named Fluffy',
        pinned: true
      }
    ])
    expect(formatPinnedWorkflowsText(workflows)).toBe(
      'List pets | List all pets via the API.\nCreate pet | Create a pet named Fluffy'
    )
  })
})
