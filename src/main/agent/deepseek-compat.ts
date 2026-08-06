import type { AgentProviderConfig } from './types'

const DEEPSEEK_HOST = /deepseek\.com/i

export function isDeepSeekProvider(provider: Pick<AgentProviderConfig, 'id' | 'name' | 'baseUrl'>): boolean {
  const id = provider.id.toLowerCase()
  const name = (provider.name || '').toLowerCase()
  const baseUrl = provider.baseUrl.toLowerCase()
  return id.includes('deepseek') || name.includes('deepseek') || DEEPSEEK_HOST.test(baseUrl)
}

export function isDeepSeekReasoningModelId(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return (
    id.includes('reasoner') ||
    id.includes('r1') ||
    id.includes('v4-pro') ||
    id.includes('v4-flash') ||
    id.includes('deepseek-v4')
  )
}

/** Prefer OpenAI-compatible /v1 path for DeepSeek when callers omit it. */
export function normalizeProviderBaseUrl(baseUrl: string, deepseek: boolean): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (!deepseek) return trimmed
  if (/\/v\d+$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

export function resolveModelReasoningFlag(input: {
  modelId: string
  configuredReasoning?: boolean
  deepseek: boolean
}): boolean {
  if (input.configuredReasoning) return true
  const id = input.modelId.toLowerCase()
  if (
    id.includes('gpt-5') ||
    id.includes('reasoner') ||
    id.includes('o1') ||
    id.includes('o3') ||
    id.endsWith('-pro')
  ) {
    return true
  }
  if (input.deepseek && isDeepSeekReasoningModelId(input.modelId)) return true
  return false
}

export function deepSeekModelCompat() {
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: 'deepseek' as const
  }
}

export function deepSeekThinkingLevelMap() {
  return {
    minimal: null,
    low: null,
    medium: null,
    high: 'high',
    max: 'max'
  } as const
}

export function suggestedDeepSeekModels(): Array<{ id: string; name: string; reasoning: boolean }> {
  return [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: false },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: true },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', reasoning: true }
  ]
}
