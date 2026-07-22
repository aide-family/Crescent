import type { AgentConfig, AgentProviderConfig } from './types'

export interface ProviderModelInfo {
  id: string
  name: string
  reasoning: boolean
  input: Array<'text'>
}

export interface ProviderConfigSchema {
  name?: string
  baseUrl: string
  api: 'openai-completions'
  auth: 'api-key'
  apiKey?: string
  request: {
    allowPrivateNetwork: boolean
  }
  models: ProviderModelInfo[]
}

export interface AgentProviderDefaults {
  model: {
    primary: string
  }
  models: Record<string, Record<string, never>>
  workspace: string
}

export interface ProviderRegistryConfig {
  models: {
    mode: 'merge'
    providers: Record<string, ProviderConfigSchema>
  }
  agents: {
    defaults: AgentProviderDefaults
  }
}

export interface ResolvedModelProvider {
  model: string
  baseUrl: string
  apiKey: string
  providerId: string
}

export const defaultProviderRegistryConfig: ProviderRegistryConfig = {
  models: {
    mode: 'merge',
    providers: {}
  },
  agents: {
    defaults: {
      model: {
        primary: ''
      },
      models: {},
      workspace: '~/.crescent/workspace'
    }
  }
}

export function getAvailableModels(
  config: ProviderRegistryConfig = defaultProviderRegistryConfig
): ProviderModelInfo[] {
  return Object.values(config.models.providers).flatMap((provider) => provider.models)
}

export function resolveModelProvider(
  agentConfig: AgentConfig,
  providerRegistryConfig: ProviderRegistryConfig = defaultProviderRegistryConfig
): ResolvedModelProvider {
  const requestedModel = agentConfig.model.trim()
  const providers = getAgentProviders(agentConfig, providerRegistryConfig)
  const requestedProviderId = agentConfig.providerId?.trim()
  const provider =
    providers.find(
      (candidate) =>
        candidate.id === requestedProviderId &&
        candidate.models.some((model) => model.id === requestedModel)
    ) ??
    providers.find((candidate) => candidate.models.some((model) => model.id === requestedModel))

  if (!provider) {
    return {
      model: requestedModel,
      baseUrl: agentConfig.openAiBaseUrl?.trim() ?? '',
      apiKey: agentConfig.openAiApiKey?.trim() ?? '',
      providerId: 'custom'
    }
  }

  return {
    model: requestedModel,
    baseUrl: provider.baseUrl.trim() || agentConfig.openAiBaseUrl?.trim() || '',
    apiKey:
      provider.apiKey?.trim() ||
      agentConfig.openAiApiKey?.trim() ||
      process.env.TERMINAL_AGENT_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      '',
    providerId: provider.id
  }
}

export function getDefaultAgentProviders(
  config: ProviderRegistryConfig = defaultProviderRegistryConfig
): AgentProviderConfig[] {
  return Object.entries(config.models.providers).map(([id, provider]) => ({
    id,
    name: provider.name ?? id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? '',
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning
    }))
  }))
}

export function getAgentProviders(
  agentConfig: AgentConfig,
  _providerRegistryConfig: ProviderRegistryConfig = defaultProviderRegistryConfig
): AgentProviderConfig[] {
  if (agentConfig.providers?.length) return agentConfig.providers

  return []
}
