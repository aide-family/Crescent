import { useMemo } from 'react'

import { flattenProviderModels } from '@renderer/lib/agent-config'
import type {
  AgentConfig,
  AgentMcpServerConfig,
  AgentModelOption,
  AgentProviderConfig
} from '../../../shared/agent-types'

interface UseSettingsInput {
  config: AgentConfig
  models: AgentModelOption[]
  settingsProviderId: string
  settingsMcpServerId: string
  emptyProvider: AgentProviderConfig
  emptyMcpServer: AgentMcpServerConfig
}

export function useSettings({
  config,
  models,
  settingsProviderId,
  settingsMcpServerId,
  emptyProvider,
  emptyMcpServer
}: UseSettingsInput): {
  configured: boolean
  modelOptions: AgentModelOption[]
  visibleModels: AgentModelOption[]
  settingsProvider: AgentProviderConfig
  settingsMcpServer: AgentMcpServerConfig
} {
  const configured = useMemo(() => Boolean(config.model.trim()), [config.model])
  const modelOptions = useMemo(() => flattenProviderModels(config.providers), [config.providers])
  const visibleModels = modelOptions.length ? modelOptions : models
  const settingsProvider =
    config.providers.find((provider) => provider.id === settingsProviderId) ??
    config.providers[0] ??
    emptyProvider
  const settingsMcpServer =
    config.mcpServers.find((server) => server.id === settingsMcpServerId) ??
    config.mcpServers[0] ??
    emptyMcpServer

  return {
    configured,
    modelOptions,
    visibleModels,
    settingsProvider,
    settingsMcpServer
  }
}
