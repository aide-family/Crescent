import { describe, expect, it } from 'vitest'

import { defaultOpenClawLikeConfig, getAvailableModels, resolveModelProvider } from './openclaw-config'
import type { AgentConfig } from './types'

const baseConfig: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: 'https://api.example.test',
  openApiDocument: '{}'
}

describe('openclaw-config', () => {
  it('exposes OpenClaw-style default model catalog', () => {
    const models = getAvailableModels(defaultOpenClawLikeConfig)

    expect(models.map((model) => model.id)).toContain('azure/gpt-5.5')
    expect(models.map((model) => model.id)).toContain('bailian/qwen3.6-plus')
  })

  it('resolves built-in provider base URL without storing a default API key', () => {
    const resolved = resolveModelProvider(baseConfig)

    expect(resolved.providerId).toBe('azure')
    expect(resolved.model).toBe('azure/gpt-5.5')
    expect(resolved.baseUrl).toBe('http://nova.dmxwg.yiducloud.cn/litellm')
    expect(resolved.apiKey).toBe('')
  })

  it('uses explicit user API key and base URL before defaults', () => {
    const resolved = resolveModelProvider({
      ...baseConfig,
      openAiApiKey: 'sk-user',
      openAiBaseUrl: 'https://proxy.example.test/v1'
    })

    expect(resolved.apiKey).toBe('sk-user')
    expect(resolved.baseUrl).toBe('https://proxy.example.test/v1')
  })
})
