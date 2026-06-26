import type { AgentConfig } from './types'

export interface OpenClawModelInfo {
  id: string
  name: string
  reasoning: boolean
  input: Array<'text'>
}

export interface OpenClawProviderConfig {
  baseUrl: string
  api: 'openai-completions'
  auth: 'api-key'
  apiKey?: string
  request: {
    allowPrivateNetwork: boolean
  }
  models: OpenClawModelInfo[]
}

export interface OpenClawAgentDefaults {
  model: {
    primary: string
  }
  models: Record<string, Record<string, never>>
  workspace: string
}

export interface OpenClawLikeConfig {
  models: {
    mode: 'merge'
    providers: Record<string, OpenClawProviderConfig>
  }
  agents: {
    defaults: OpenClawAgentDefaults
  }
}

export interface ResolvedModelProvider {
  model: string
  baseUrl: string
  apiKey: string
  providerId: string
}

export const defaultOpenClawLikeConfig: OpenClawLikeConfig = {
  models: {
    mode: 'merge',
    providers: {
      azure: {
        baseUrl: 'http://nova.dmxwg.yiducloud.cn/litellm',
        api: 'openai-completions',
        auth: 'api-key',
        request: {
          allowPrivateNetwork: true
        },
        models: [
          { id: 'azure/gpt-5.4', name: 'azure/gpt-5.4', reasoning: true, input: ['text'] },
          { id: 'azure/gpt-5.5', name: 'azure/gpt-5.5', reasoning: true, input: ['text'] }
        ]
      },
      bailian: {
        baseUrl: 'http://nova.dmxwg.yiducloud.cn/litellm',
        api: 'openai-completions',
        auth: 'api-key',
        request: {
          allowPrivateNetwork: true
        },
        models: [
          { id: 'bailian/glm-5-1', name: 'bailian/glm-5-1', reasoning: false, input: ['text'] },
          { id: 'bailian/qwen3.6-plus', name: 'bailian/qwen3.6-plus', reasoning: false, input: ['text'] }
        ]
      }
    }
  },
  agents: {
    defaults: {
      model: {
        primary: 'azure/gpt-5.5'
      },
      models: {
        'azure/gpt-5.4': {},
        'azure/gpt-5.5': {},
        'bailian/glm-5-1': {},
        'bailian/qwen3.6-plus': {}
      },
      workspace: '~/.terminal-agent/workspace'
    }
  }
}

export function getAvailableModels(
  config: OpenClawLikeConfig = defaultOpenClawLikeConfig
): OpenClawModelInfo[] {
  return Object.values(config.models.providers).flatMap((provider) => provider.models)
}

export function resolveModelProvider(
  agentConfig: AgentConfig,
  openClawConfig: OpenClawLikeConfig = defaultOpenClawLikeConfig
): ResolvedModelProvider {
  const requestedModel = agentConfig.model.trim() || openClawConfig.agents.defaults.model.primary
  const providerEntry = Object.entries(openClawConfig.models.providers).find(([, provider]) =>
    provider.models.some((model) => model.id === requestedModel)
  )

  if (!providerEntry) {
    return {
      model: requestedModel,
      baseUrl: agentConfig.openAiBaseUrl.trim(),
      apiKey: agentConfig.openAiApiKey.trim(),
      providerId: 'custom'
    }
  }

  const [providerId, provider] = providerEntry

  return {
    model: requestedModel,
    baseUrl: agentConfig.openAiBaseUrl.trim() || provider.baseUrl,
    apiKey:
      agentConfig.openAiApiKey.trim() ||
      provider.apiKey?.trim() ||
      process.env.TERMINAL_AGENT_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      '',
    providerId
  }
}
