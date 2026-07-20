import { describe, expect, it } from 'vitest'

import {
  defaultOpenClawLikeConfig,
  getDefaultAgentProviders,
  getAvailableModels,
  resolveModelProvider
} from './openclaw-config'
import type { AgentConfig } from './types'

const baseConfig: AgentConfig = {
  providers: getDefaultAgentProviders(),
  providerId: 'nova-litellm',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiBaseUrl: 'https://api.example.test',
  openApiDocument: '{}',
  skillRoot: '~/.agents/skills'
}

describe('openclaw-config', () => {
  it('exposes OpenClaw-style default model catalog', () => {
    const models = getAvailableModels(defaultOpenClawLikeConfig)

    expect(models.map((model) => model.id)).toContain('azure/gpt-5.5')
    expect(models.map((model) => model.id)).toContain('bailian/qwen3.6-plus')
    expect(models.map((model) => model.id)).toContain('deepseek-v4-flash')
    expect(models.map((model) => model.id)).toContain('deepseek-v4-pro')
    expect(models.map((model) => model.id)).toContain('deepseek-chat')
    expect(models.map((model) => model.id)).toContain('deepseek-reasoner')
  })

  it('resolves built-in provider base URL without storing a default API key', () => {
    const resolved = resolveModelProvider(baseConfig)

    expect(resolved.providerId).toBe('nova-litellm')
    expect(resolved.model).toBe('azure/gpt-5.5')
    expect(resolved.baseUrl).toBe('http://nova.dmxwg.yiducloud.cn/litellm')
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

  it('resolves the built-in DeepSeek provider', () => {
    const resolved = resolveModelProvider({
      ...baseConfig,
      providerId: 'deepseek',
      model: 'deepseek-v4-flash'
    })

    expect(resolved.providerId).toBe('deepseek')
    expect(resolved.model).toBe('deepseek-v4-flash')
    expect(resolved.baseUrl).toBe('https://api.deepseek.com')
  })

  it('uses providerId when different providers expose the same model id', () => {
    const resolved = resolveModelProvider({
      ...baseConfig,
      providerId: 'deepseek-alt',
      model: 'deepseek-v4-flash',
      providers: [
        ...baseConfig.providers,
        {
          id: 'deepseek-alt',
          name: 'DeepSeek Alt',
          baseUrl: 'https://proxy.example.test/deepseek',
          apiKey: 'sk-alt',
          models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }]
        }
      ]
    })

    expect(resolved.providerId).toBe('deepseek-alt')
    expect(resolved.baseUrl).toBe('https://proxy.example.test/deepseek')
    expect(resolved.apiKey).toBe('sk-alt')
  })
})
