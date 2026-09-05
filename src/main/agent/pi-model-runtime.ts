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
import { loadPiModelRuntime } from './pi-sdk'
import type { AgentConfig, AgentProviderConfig } from './types'

type ModelRuntime = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadPiModelRuntime>>['ModelRuntime']['create']>
>
type ProviderConfigInput = Parameters<ModelRuntime['registerProvider']>[1]

let runtimePromise: Promise<ModelRuntime> | undefined
/** Provider ids currently registered into the process-lifetime ModelRuntime. */
const registeredRuntimeProviderIds = new Set<string>()

export async function getCrescentModelRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { ModelRuntime } = await loadPiModelRuntime()
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
  const enabledIds = new Set(providers.map((provider) => sanitizeProviderId(provider.id)))

  for (const providerId of [...registeredRuntimeProviderIds]) {
    if (enabledIds.has(providerId)) continue
    try {
      await runtime.removeRuntimeApiKey(providerId)
    } catch {
      // Best effort — key may already be absent.
    }
    try {
      runtime.unregisterProvider(providerId)
    } catch {
      // Best effort — provider may already be gone.
    }
    registeredRuntimeProviderIds.delete(providerId)
  }

  for (const provider of providers) {
    const providerId = sanitizeProviderId(provider.id)
    runtime.registerProvider(providerId, toProviderConfigInput(provider))
    registeredRuntimeProviderIds.add(providerId)
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
  const matched = resolveEnabledRuntimeModel(config, providers, {
    getModel: (providerId, modelId) => runtime.getModel(providerId, modelId),
    available: [],
    all: []
  })
  if (matched) return matched

  const available = filterRuntimeModelsByEnabledProviders(await runtime.getAvailable(), providers)
  if (available.length > 0) return available[0]

  return filterRuntimeModelsByEnabledProviders(runtime.getModels(), providers)[0]
}

export function resolveEnabledRuntimeModel<T extends { provider: string; id: string }>(
  config: Pick<AgentConfig, 'providerId' | 'model'>,
  providers: AgentProviderConfig[],
  lookup: {
    getModel: (providerId: string, modelId: string) => T | undefined
    available: readonly T[]
    all: readonly T[]
  }
): T | undefined {
  const enabledIds = enabledRuntimeProviderIds(providers)
  const providerId = sanitizeProviderId(config.providerId || providers[0]?.id || '')
  const modelId = config.model.trim()

  if (providerId && modelId && enabledIds.has(providerId)) {
    const exact = lookup.getModel(providerId, modelId)
    if (exact && enabledIds.has(exact.provider)) return exact
  }

  if (modelId) {
    for (const provider of providers) {
      const candidate = lookup.getModel(sanitizeProviderId(provider.id), modelId)
      if (candidate && enabledIds.has(candidate.provider)) return candidate
    }
  }

  const available = filterRuntimeModelsByEnabledProviders(lookup.available, providers)
  if (available.length > 0) return available[0]

  return filterRuntimeModelsByEnabledProviders(lookup.all, providers)[0]
}

export function filterRuntimeModelsByEnabledProviders<T extends { provider: string }>(
  models: readonly T[],
  providers: AgentProviderConfig[]
): T[] {
  const enabledIds = enabledRuntimeProviderIds(providers)
  return models.filter((model) => enabledIds.has(model.provider))
}

export function resolveThinkingLevelForModel(
  model: Pick<Model<Api>, 'reasoning'> | undefined
): 'off' | 'high' {
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

  const models = filterRuntimeModelsByEnabledProviders(await runtime.getAvailable(), providers)
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

export function toProviderConfigInput(provider: AgentProviderConfig): ProviderConfigInput {
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

function enabledRuntimeProviderIds(providers: AgentProviderConfig[]): Set<string> {
  return new Set(providers.map((provider) => sanitizeProviderId(provider.id)))
}

function sanitizeProviderId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-') || 'custom'
  )
}
