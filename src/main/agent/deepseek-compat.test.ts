import { describe, expect, it } from 'vitest'

import {
  isDeepSeekProvider,
  isDeepSeekReasoningModelId,
  normalizeProviderBaseUrl,
  resolveModelReasoningFlag
} from './deepseek-compat'

describe('deepseek-compat', () => {
  it('detects DeepSeek providers by id or base URL', () => {
    expect(isDeepSeekProvider({ id: 'deepseek', name: '', baseUrl: '' })).toBe(true)
    expect(
      isDeepSeekProvider({ id: 'custom', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' })
    ).toBe(true)
    expect(isDeepSeekProvider({ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com' })).toBe(
      false
    )
  })

  it('normalizes DeepSeek base URLs to /v1', () => {
    expect(normalizeProviderBaseUrl('https://api.deepseek.com', true)).toBe(
      'https://api.deepseek.com/v1'
    )
    expect(normalizeProviderBaseUrl('https://api.deepseek.com/v1/', true)).toBe(
      'https://api.deepseek.com/v1'
    )
    expect(normalizeProviderBaseUrl('https://api.openai.com/v1', false)).toBe(
      'https://api.openai.com/v1'
    )
  })

  it('marks reasoner-family models as reasoning', () => {
    expect(isDeepSeekReasoningModelId('deepseek-reasoner')).toBe(true)
    expect(isDeepSeekReasoningModelId('deepseek-v4-pro')).toBe(true)
    expect(isDeepSeekReasoningModelId('deepseek-chat')).toBe(false)
    expect(
      resolveModelReasoningFlag({ modelId: 'deepseek-reasoner', deepseek: true })
    ).toBe(true)
    expect(resolveModelReasoningFlag({ modelId: 'deepseek-chat', deepseek: true })).toBe(false)
  })
})
