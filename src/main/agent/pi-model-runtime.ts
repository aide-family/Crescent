import type { Model } from '@earendil-works/pi-ai'

import { getAgentProviders } from './model-provider-config'
import { getCrescentPiAuthPath, getCrescentPiModelsPath } from './pi-paths'
import { loadPiCodingAgent } from './pi-sdk'
import type { AgentConfig, AgentProviderConfig } from './types'

type ModelRuntime = Awaited<ReturnType<Awaited<ReturnType<typeof loadPiCodingAgent>>['ModelRuntime']['create']>>
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
): Promise<Model<any> | undefined> {
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
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      providerId: sanitizeProviderId(provider.id),
      providerName: provider.name || provider.id,
      reasoning: Boolean(model.reasoning)
    }))
  )
}

function toProviderConfigInput(provider: AgentProviderConfig): ProviderConfigInput {
  return {
    name: provider.name || provider.id,
    baseUrl: provider.baseUrl.trim() || undefined,
    api: 'openai-completions',
    apiKey: provider.apiKey?.trim() || undefined,
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      reasoning: Boolean(model.reasoning),
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384
    }))
  }
}

function sanitizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'custom'
}
