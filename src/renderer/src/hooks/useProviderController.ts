import { agentClient } from '@renderer/clients'
import type { Dictionary } from '@renderer/i18n'
import {
  formatProviderModels,
  parseCommandWhitelist,
  parseProviderModels
} from '@renderer/lib/agent-config'
import { parseModelSelectionValue } from '@renderer/lib/app-runtime'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { isAgentProviderEnabled, selectEnabledAgentProvider } from '../../../shared/agent-providers'
import {
  type AgentConfig,
  type AgentMcpServerConfig,
  type AgentModelOption,
  type AgentProviderConfig,
  type AgentValidationResult
} from '../../../shared/agent-types'

interface Parameters {
  config: AgentConfig
  validationRequestRef: RefObject<number>
  setValidating: Dispatch<SetStateAction<boolean>>
  setValidation: Dispatch<SetStateAction<AgentValidationResult | undefined>>
  modelOptions: AgentModelOption[]
  setConfig: Dispatch<SetStateAction<AgentConfig>>
  saveAgentConfig: (nextConfigInput: AgentConfig) => Promise<AgentConfig>
  settingsProviderId: string
  settingsProvider: AgentProviderConfig
  setSettingsProviderId: Dispatch<SetStateAction<string>>
  setProviderModelsText: Dispatch<SetStateAction<string>>
  setOpenApiEditorOpen: Dispatch<SetStateAction<boolean>>
  setInstructionEditorOpen: Dispatch<SetStateAction<boolean>>
  setProviderEditorOpen: Dispatch<SetStateAction<boolean>>
  t: Dictionary
  commandWhitelistText: string
  setSaved: Dispatch<SetStateAction<boolean>>
}

export function useProviderController({
  config,
  validationRequestRef,
  setValidating,
  setValidation,
  modelOptions,
  setConfig,
  saveAgentConfig,
  settingsProviderId,
  settingsProvider,
  setSettingsProviderId,
  setProviderModelsText,
  setOpenApiEditorOpen,
  setInstructionEditorOpen,
  setProviderEditorOpen,
  t,
  commandWhitelistText,
  setSaved
}: Parameters) {
  async function validateConfig(nextConfigInput = config): Promise<void> {
    const requestId = validationRequestRef.current + 1
    validationRequestRef.current = requestId
    setValidating(true)
    setValidation(undefined)

    try {
      const result = await agentClient.validateConfig(nextConfigInput)
      if (validationRequestRef.current === requestId) setValidation(result)
    } finally {
      if (validationRequestRef.current === requestId) setValidating(false)
    }
  }

  async function applyDefaultModel(selection: string): Promise<void> {
    const parsed = parseModelSelectionValue(selection)
    const selectedModel =
      modelOptions.find(
        (model) => model.providerId === parsed.providerId && model.id === parsed.model
      ) ?? modelOptions.find((model) => model.id === parsed.model)
    if (!selectedModel) return

    const optimisticConfig = {
      ...config,
      providerId: selectedModel.providerId,
      model: selectedModel.id
    }

    setConfig(optimisticConfig)
    setValidation(undefined)
    const nextConfig = await saveAgentConfig(optimisticConfig)
    void validateConfig(nextConfig)
  }

  function updateSettingsProvider<K extends keyof AgentProviderConfig>(
    key: K,
    value: AgentProviderConfig[K]
  ): void {
    const currentProviderId = settingsProviderId || settingsProvider.id
    if (!currentProviderId) return

    if (key === 'id') {
      const nextProviderId = String(value).trim()
      if (!nextProviderId) return
      if (
        config.providers.some(
          (provider) => provider.id !== currentProviderId && provider.id === nextProviderId
        )
      ) {
        return
      }

      setConfig((current) => {
        const providers = current.providers.map((provider) =>
          provider.id === currentProviderId ? { ...provider, id: nextProviderId } : provider
        )

        return {
          ...current,
          providers,
          providerId: current.providerId === currentProviderId ? nextProviderId : current.providerId
        }
      })
      setSettingsProviderId(nextProviderId)
      setValidation(undefined)
      return
    }

    setConfig((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.id === currentProviderId ? { ...provider, [key]: value } : provider
      )
    }))
    setValidation(undefined)
  }

  function updateSettingsProviderModels(value: string): void {
    setProviderModelsText(value)
    const previous =
      config.providers.find((provider) => provider.id === settingsProviderId)?.models ?? []
    updateSettingsProvider(
      'models',
      parseProviderModels(value).map((model) => ({
        ...model,
        samplingParamsByThinkingLevel: previous.find((saved) => saved.id === model.id)
          ?.samplingParamsByThinkingLevel
      }))
    )
  }

  function selectSettingsProvider(providerId: string): void {
    const provider = config.providers.find((candidate) => candidate.id === providerId)
    setSettingsProviderId(providerId)
    setProviderModelsText(formatProviderModels(provider?.models ?? []))
  }

  function toggleProviderDetails(providerId: string): void {
    selectSettingsProvider(providerId)
    setOpenApiEditorOpen(false)
    setInstructionEditorOpen(false)
    setProviderEditorOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById('provider-editor-panel')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      })
    })
  }

  function toggleProviderEnabled(providerId: string, enabled: boolean): void {
    const targetId = providerId.trim()
    if (!targetId) return

    setConfig((current) => {
      const providers = current.providers.map((provider) =>
        provider.id === targetId ? { ...provider, enabled } : provider
      )
      const selection = selectEnabledAgentProvider(
        providers,
        current.providerId ?? '',
        current.model
      )
      return {
        ...current,
        providers,
        providerId: selection.providerId,
        model: selection.model
      }
    })
    setValidation(undefined)
  }

  function createProvider(): void {
    const id = `provider-${Date.now()}`
    const provider: AgentProviderConfig = {
      id,
      name: '',
      baseUrl: '',
      apiKey: '',
      enabled: true,
      models: []
    }

    setConfig((current) => ({ ...current, providers: [...current.providers, provider] }))
    setSettingsProviderId(id)
    setProviderModelsText(formatProviderModels(provider.models))
    setOpenApiEditorOpen(false)
    setInstructionEditorOpen(false)
    setProviderEditorOpen(true)
    setValidation(undefined)
    window.requestAnimationFrame(() => {
      document.getElementById('provider-editor-panel')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      })
    })
  }

  function deleteSettingsProvider(providerId = settingsProviderId): void {
    const targetId = providerId.trim()
    if (!targetId) return
    if (config.providers.length <= 1) return

    const target = config.providers.find((provider) => provider.id === targetId) ?? settingsProvider
    const label = target.name.trim() || target.id || targetId
    if (!window.confirm(`${t.confirm.deleteProvider}\n\n${label}`)) return

    const remainingProviders = config.providers.filter((provider) => provider.id !== targetId)
    const remainingEnabled = remainingProviders.filter(isAgentProviderEnabled)
    const nextProvider = remainingEnabled[0] ?? remainingProviders[0]
    const modelProvider = remainingEnabled.find((provider) =>
      provider.models.some((model) => model.id === config.model)
    )
    const modelStillAvailable = Boolean(modelProvider)
    const wasEditingTarget = targetId === settingsProviderId

    setConfig({
      ...config,
      providers: remainingProviders,
      providerId: modelStillAvailable ? modelProvider?.id : nextProvider?.id,
      model: modelStillAvailable ? config.model : (nextProvider?.models[0]?.id ?? '')
    })
    setSettingsProviderId(wasEditingTarget ? (nextProvider?.id ?? '') : settingsProviderId)
    setProviderModelsText(
      formatProviderModels(
        (wasEditingTarget ? nextProvider?.models : settingsProvider.models) ?? []
      )
    )
    if (wasEditingTarget) setProviderEditorOpen(false)
    setValidation(undefined)
  }

  function updateSettingsMcpServers(nextServers: AgentMcpServerConfig[]): void {
    setConfig((current) => ({ ...current, mcpServers: nextServers }))
    setValidation(undefined)
  }

  async function saveMcpServers(nextServers: AgentMcpServerConfig[]): Promise<void> {
    const nextConfig = await saveAgentConfig({
      ...config,
      mcpServers: nextServers,
      commandWhitelist: parseCommandWhitelist(commandWhitelistText)
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
    void validateConfig(nextConfig)
  }
  return {
    validateConfig,
    applyDefaultModel,
    updateSettingsProvider,
    updateSettingsProviderModels,
    selectSettingsProvider,
    toggleProviderDetails,
    toggleProviderEnabled,
    createProvider,
    deleteSettingsProvider,
    updateSettingsMcpServers,
    saveMcpServers
  }
}
