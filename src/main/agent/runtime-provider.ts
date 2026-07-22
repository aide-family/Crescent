import type { AgentConfig } from './types'
import { resolveModelProvider } from './model-provider-config'

export type AgentApiMode = 'openai-chat-completions'

export interface AgentRuntimeProvider {
  apiMode: AgentApiMode
  model: string
  baseUrl: string
  apiKey: string
  providerId: string
}

export function resolveAgentRuntimeProvider(config: AgentConfig): AgentRuntimeProvider {
  const provider = resolveModelProvider(config)

  return {
    apiMode: 'openai-chat-completions',
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    providerId: provider.providerId
  }
}
