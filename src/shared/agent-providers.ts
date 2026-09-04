import type { AgentProviderConfig } from './agent-types'

export function isAgentProviderEnabled(provider: { enabled?: boolean }): boolean {
  return provider.enabled !== false
}

export function selectEnabledAgentProvider(
  providers: AgentProviderConfig[],
  requestedProviderId: string,
  requestedModel: string
): { providerId?: string; model: string } {
  const enabled = providers.filter(
    (provider) => isAgentProviderEnabled(provider) && provider.models.length > 0
  )
  const requestedId = requestedProviderId.trim()
  const requestedModelId = requestedModel.trim()
  const byId = enabled.find((provider) => provider.id === requestedId)
  if (byId) {
    const modelOk = byId.models.some((model) => model.id === requestedModelId)
    return {
      providerId: byId.id,
      model: modelOk ? requestedModelId : (byId.models[0]?.id ?? '')
    }
  }

  const byModel = enabled.find((provider) =>
    provider.models.some((model) => model.id === requestedModelId)
  )
  if (byModel) {
    return { providerId: byModel.id, model: requestedModelId }
  }

  const first = enabled[0]
  return {
    providerId: first?.id,
    model: first?.models[0]?.id ?? ''
  }
}
