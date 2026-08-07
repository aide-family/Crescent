import type { Api, Model } from '@earendil-works/pi-ai'

import {
  deepSeekModelCompat,
  deepSeekThinkingLevelMap,
  isDeepSeekProvider,
  normalizeProviderBaseUrl,
  openAiCompatibleModelCompat,
  resolveModelReasoningFlag
} from './deepseek-compat'
import { getAgentProviders } from './model-provider-config'
import { getCrescentPiAuthPath, getCrescentPiModelsPath } from './pi-paths'
import { loadPiCodingAgent } from './pi-sdk'
import type { AgentConfig, AgentProviderConfig } from './types'

type ModelRuntime = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadPiCodingAgent>>['ModelRuntime']['create']>
>
type ProviderConfigInput = Parameters<ModelRuntime['registerProvider']>[1]

let runtimePromise: Promise<ModelRuntime> | undefined

export async function getCrescentModelRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { ModelRuntime } = await loadPiCodingAgent()
      return ModelRuntime.create({
        authPath: getCrescentPiAuthPath(),
        modelsPath: getCrescentPiModelsPath(),
        allowModelNetwork: false
      })
    })()
  }
  return runtimePromise
}

export async function syncCrescentProvidersToModelRuntime(
  config: AgentConfig
): Promise<ModelRuntime> {
  const runtime = await getCrescentModelRuntime()
  const providers = getAgentProviders(config)

  for (const provider of providers) {
    const providerId = sanitizeProviderId(provider.id)
    runtime.registerProvider(providerId, toProviderConfigInput(provider))
    const apiKey =
      provider.apiKey?.trim() ||
      config.openAiApiKey?.trim() ||
      process.env.TERMINAL_AGENT_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      ''
    if (apiKey) {
      await runtime.setRuntimeApiKey(providerId, apiKey)
    }
  }

  return runtime
}

export async function resolvePiModel(
  config: AgentConfig,
  runtime: ModelRuntime
): Promise<Model<Api> | undefined> {
  const providers = getAgentProviders(config)
  const providerId = sanitizeProviderId(config.providerId || providers[0]?.id || '')
  const modelId = config.model.trim()

  if (providerId && modelId) {
    const exact = runtime.getModel(providerId, modelId)
    if (exact) return exact
  }

  if (modelId) {
    for (const provider of providers) {
      const candidate = runtime.getModel(sanitizeProviderId(provider.id), modelId)
      if (candidate) return candidate
    }
  }

  const available = await runtime.getAvailable()
  if (available.length > 0) return available[0]

  const all = runtime.getModels()
  return all[0]
}

export function resolveThinkingLevelForModel(model: Model<Api> | undefined): 'off' | 'high' {
  if (!model?.reasoning) return 'off'
  return 'high'
}

export async function listPiAvailableModels(config: AgentConfig): Promise<
  Array<{
    id: string
    name: string
    providerId: string
    providerName: string
    reasoning: boolean
  }>
> {
  const runtime = await syncCrescentProvidersToModelRuntime(config)
  const providers = getAgentProviders(config)
  const providerNames = new Map(
    providers.map((provider) => [sanitizeProviderId(provider.id), provider.name || provider.id])
  )

  const models = await runtime.getAvailable()
  if (models.length > 0) {
    return models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      providerId: model.provider,
      providerName: providerNames.get(model.provider) || model.provider,
      reasoning: Boolean(model.reasoning)
    }))
  }

  // Fall back to configured providers even if auth check failed (UI still needs the list).
  return providers.flatMap((provider) => {
    const deepseek = isDeepSeekProvider(provider)
    return provider.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      providerId: sanitizeProviderId(provider.id),
      providerName: provider.name || provider.id,
      reasoning: resolveModelReasoningFlag({
        modelId: model.id,
        configuredReasoning: model.reasoning,
        deepseek
      })
    }))
  })
}

function toProviderConfigInput(provider: AgentProviderConfig): ProviderConfigInput {
  const deepseek = isDeepSeekProvider(provider)
  const baseUrl = normalizeProviderBaseUrl(provider.baseUrl, deepseek)
  const gatewayCompat = openAiCompatibleModelCompat(provider.baseUrl)

  return {
    name: provider.name || provider.id,
    baseUrl: baseUrl || undefined,
    api: 'openai-completions',
    apiKey: provider.apiKey?.trim() || undefined,
    models: provider.models.map((model) => {
      const reasoning = resolveModelReasoningFlag({
        modelId: model.id,
        configuredReasoning: model.reasoning,
        deepseek
      })
      return {
        id: model.id,
        name: model.name || model.id,
        reasoning,
        input: ['text'] as Array<'text'>,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: deepseek ? 128_000 : 128_000,
        maxTokens: reasoning ? 16_384 : 8_192,
        ...(deepseek
          ? {
              compat: deepSeekModelCompat(),
              ...(reasoning ? { thinkingLevelMap: deepSeekThinkingLevelMap() } : {})
            }
          : gatewayCompat
            ? { compat: gatewayCompat }
            : {})
      }
    })
  }
}

function sanitizeProviderId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-') || 'custom'
  )
}
