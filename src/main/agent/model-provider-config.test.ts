import { describe, expect, it } from 'vitest'

import {
  defaultProviderRegistryConfig,
  getDefaultAgentProviders,
  getAvailableModels,
  resolveModelProvider,
  type ProviderRegistryConfig
} from './model-provider-config'
import type { AgentConfig } from './types'

const testProviderRegistryConfig: ProviderRegistryConfig = {
  models: {
    mode: 'merge',
    providers: {
      primary: {
        name: 'Primary',
        baseUrl: 'https://primary.example.test/v1',
        api: 'openai-completions',
        auth: 'api-key',
        request: { allowPrivateNetwork: false },
        models: [{ id: 'model-a', name: 'model-a', reasoning: true, input: ['text'] }]
      },
      secondary: {
        name: 'Secondary',
        baseUrl: 'https://secondary.example.test/v1',
        api: 'openai-completions',
        auth: 'api-key',
        request: { allowPrivateNetwork: false },
        models: [{ id: 'model-b', name: 'model-b', reasoning: false, input: ['text'] }]
      }
    }
  },
  agents: {
    defaults: {
      model: { primary: '' },
      models: {},
      workspace: '~/.crescent/workspace'
    }
  }
}

const baseConfig: AgentConfig = {
  providers: getDefaultAgentProviders(testProviderRegistryConfig),
  providerId: 'primary',
  model: 'model-a',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiBaseUrl: 'https://api.example.test',
  openApiDocument: '{}',
  skillRoot: '~/.agents/skills',
  mcpServers: []
}

describe('model-provider-config', () => {
  it('does not expose built-in model providers by default', () => {
    const models = getAvailableModels(defaultProviderRegistryConfig)

    expect(models).toEqual([])
  })

  it('resolves configured provider base URL without storing a default API key', () => {
    const resolved = resolveModelProvider(baseConfig)

    expect(resolved.providerId).toBe('primary')
    expect(resolved.model).toBe('model-a')
    expect(resolved.baseUrl).toBe('https://primary.example.test/v1')
    expect(resolved.apiKey).toBe('')
  })

  it('uses explicit user API key and base URL before defaults', () => {
    const resolved = resolveModelProvider({
      ...baseConfig,
      providers: [
        {
          ...baseConfig.providers[0],
          apiKey: 'sk-user',
          baseUrl: 'https://proxy.example.test/v1'
        }
      ]
    })

    expect(resolved.apiKey).toBe('sk-user')
    expect(resolved.baseUrl).toBe('https://proxy.example.test/v1')
  })

  it('resolves another configured provider', () => {
    const resolved = resolveModelProvider({
      ...baseConfig,
      providerId: 'secondary',
      model: 'model-b'
    })

    expect(resolved.providerId).toBe('secondary')
    expect(resolved.model).toBe('model-b')
    expect(resolved.baseUrl).toBe('https://secondary.example.test/v1')
  })

  it('uses providerId when different providers expose the same model id', () => {
    const resolved = resolveModelProvider({
      ...baseConfig,
      providerId: 'secondary-alt',
      model: 'model-b',
      providers: [
        ...baseConfig.providers,
        {
          id: 'secondary-alt',
          name: 'Secondary Alt',
          baseUrl: 'https://proxy.example.test/secondary',
          apiKey: 'sk-alt',
          models: [{ id: 'model-b', name: 'model-b' }]
        }
      ]
    })

    expect(resolved.providerId).toBe('secondary-alt')
    expect(resolved.baseUrl).toBe('https://proxy.example.test/secondary')
    expect(resolved.apiKey).toBe('sk-alt')
  })
})
