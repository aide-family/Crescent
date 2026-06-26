import { ipcMain } from 'electron'
import type Store from 'electron-store'

import { AgentMemory, type AgentMemoryState } from './memory'
import { defaultOpenClawLikeConfig, getAvailableModels } from './openclaw-config'
import { runTerminalAgent } from './runner'
import type { AgentConfig, AgentRunInput } from './types'

type StoreShape = {
  config: AgentConfig
  memory: AgentMemoryState
}

const defaultConfig: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: defaultOpenClawLikeConfig.agents.defaults.model.primary,
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: '',
  openApiDocument: ''
}

const defaultMemory: AgentMemoryState = {
  shortTerm: [],
  longTerm: {
    preferences: [],
    notes: []
  }
}

let storePromise: Promise<Store<StoreShape>> | undefined

export function registerAgentIpc(): void {
  ipcMain.handle('agent:get-config', async () => {
    const store = await getStore()
    return store.get('config', defaultConfig)
  })

  ipcMain.handle('agent:get-models', () => {
    const providerEntries = Object.entries(defaultOpenClawLikeConfig.models.providers)

    return getAvailableModels(defaultOpenClawLikeConfig).map((model) => {
      const provider = providerEntries.find(([, providerConfig]) =>
        providerConfig.models.some((candidate) => candidate.id === model.id)
      )

      return {
        id: model.id,
        name: model.name,
        providerId: provider?.[0] ?? 'custom',
        reasoning: model.reasoning
      }
    })
  })

  ipcMain.handle('agent:save-config', async (_, config: Partial<AgentConfig>) => {
    const store = await getStore()
    const nextConfig = normalizeConfig({
      ...store.get('config', defaultConfig),
      ...config
    })

    store.set('config', nextConfig)
    return nextConfig
  })

  ipcMain.handle('agent:run', async (event, payload: AgentRunInput) => {
    const store = await getStore()
    const input = payload?.input?.trim()

    if (!input) {
      return { ok: false, error: 'Input is empty.' }
    }

    if (input.startsWith('/remember ')) {
      const memory = createMemory(store)
      memory.addLongTermNote(input.slice('/remember '.length))
      event.sender.send('agent:event', { type: 'done', message: 'Saved to long-term memory.' })
      return { ok: true, text: 'Saved to long-term memory.' }
    }

    try {
      const text = await runTerminalAgent(
        normalizeConfig(store.get('config', defaultConfig)),
        input,
        createMemory(store),
        (agentEvent) => {
          event.sender.send('agent:event', agentEvent)
        }
      )

      return { ok: true, text }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      event.sender.send('agent:event', { type: 'error', message })
      return { ok: false, error: message }
    }
  })
}

function getStore(): Promise<Store<StoreShape>> {
  storePromise ??= import('electron-store').then(({ default: ElectronStore }) => {
    return new ElectronStore<StoreShape>({
      name: 'terminal-agent',
      defaults: {
        config: defaultConfig,
        memory: defaultMemory
      }
    })
  })

  return storePromise
}

function createMemory(store: Store<StoreShape>): AgentMemory {
  return new AgentMemory(normalizeMemory(store.get('memory', defaultMemory)), (nextMemory) => {
    store.set('memory', normalizeMemory(nextMemory))
  })
}

function normalizeConfig(config: AgentConfig): AgentConfig {
  return {
    openAiApiKey: String(config.openAiApiKey ?? ''),
    openAiBaseUrl: String(config.openAiBaseUrl ?? ''),
    model: String(config.model ?? defaultConfig.model),
    agentMode: config.agentMode === 'plan-execute' ? 'plan-execute' : 'react',
    maxActiveTools: clampNumber(config.maxActiveTools, 1, 12, defaultConfig.maxActiveTools),
    openApiBaseUrl: String(config.openApiBaseUrl ?? ''),
    openApiDocument: String(config.openApiDocument ?? '')
  }
}

function normalizeMemory(memory: AgentMemoryState): AgentMemoryState {
  return {
    shortTerm: Array.isArray(memory.shortTerm) ? memory.shortTerm.slice(-24) : [],
    longTerm: {
      preferences: Array.isArray(memory.longTerm?.preferences) ? memory.longTerm.preferences.slice(-100) : [],
      notes: Array.isArray(memory.longTerm?.notes) ? memory.longTerm.notes.slice(-100) : []
    }
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}
