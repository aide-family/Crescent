import { ipcMain } from 'electron'

import { generateTerminalCommand } from './command'
import { AgentMemory } from './memory'
import { defaultOpenClawLikeConfig, getAvailableModels } from './openclaw-config'
import { AgentBrain } from './brain'
import { runTerminalAgent } from './runner'
import { loadOpenApiToolRegistry } from './tool-registry'
import { executeCommandInTerminal } from '../terminal/ipc'
import {
  appendOperationRecord,
  readAgentConfig,
  readCrescentMemory,
  readCustomConnections,
  writeAgentConfig,
  writeCrescentMemory,
  normalizeAgentConfig
} from '../crescent-store'
import { loadSshConfigConnections } from '../connections/ssh-config'
import type { AgentCommandInput, AgentConfig, AgentRunInput } from './types'

export function registerAgentIpc(): void {
  ipcMain.handle('agent:get-config', () => {
    return readAgentConfig()
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

  ipcMain.handle('agent:save-config', (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      ...config
    })

    return writeAgentConfig(nextConfig)
  })

  ipcMain.handle('agent:validate-config', async (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      ...config
    })

    try {
      const registry = await loadOpenApiToolRegistry(nextConfig)

      return {
        ok: true,
        toolCount: registry.tools.length,
        tools: registry.catalog.slice(0, 8)
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:generate-command', async (_, payload: AgentCommandInput) => {
    const config = readAgentConfig()
    const instruction = payload?.instruction?.trim()

    if (!instruction) return { ok: false, error: 'Command instruction is empty.' }

    try {
      const command = await generateTerminalCommand(new AgentBrain(config), createMemory(), {
        instruction,
        cwd: payload.cwd,
        shell: payload.shell,
        terminalContext: payload.terminalContext
      })

      return { ok: true, ...command }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:run', async (event, payload: AgentRunInput) => {
    const input = payload?.input?.trim()

    if (!input) {
      return { ok: false, error: 'Input is empty.' }
    }

    if (input.startsWith('/remember ')) {
      const memory = createMemory()
      memory.addLongTermNote(input.slice('/remember '.length))
      event.sender.send('agent:event', { type: 'done', message: 'Saved to long-term memory.' })
      return { ok: true, text: 'Saved to long-term memory.' }
    }

    try {
      const connection = findConnection(payload?.connectionId)
      const text = await runTerminalAgent(
        readAgentConfig(),
        input,
        createMemory(),
        payload?.terminalContext ?? '',
        (agentEvent) => {
          event.sender.send('agent:event', agentEvent)
        },
        {
          executeCommand: (command, timeoutMs) =>
            executeCommandInTerminal(event.sender.id, command, timeoutMs, payload?.tabId)
        }
      )
      appendOperationRecord({
        connectionId: payload?.connectionId,
        connectionName: connection?.name,
        status: 'success',
        summary: input,
        output: text
      })

      return { ok: true, text }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const connection = findConnection(payload?.connectionId)
      appendOperationRecord({
        connectionId: payload?.connectionId,
        connectionName: connection?.name,
        status: 'error',
        summary: input,
        output: message
      })
      event.sender.send('agent:event', { type: 'error', message })
      return { ok: false, error: message }
    }
  })
}

function createMemory(): AgentMemory {
  return new AgentMemory(readCrescentMemory(), (nextMemory) => {
    writeCrescentMemory(nextMemory)
  })
}

function findConnection(id: string | undefined): { id: string; name: string } | undefined {
  if (!id) return undefined

  return [...loadSshConfigConnections(), ...readCustomConnections()].find(
    (connection) => connection.id === id
  )
}
