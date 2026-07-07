import { ipcMain } from 'electron'

import { generateTerminalCommand } from './command'
import { AgentMemory } from './memory'
import { getAgentProviders } from './openclaw-config'
import { AgentBrain } from './brain'
import { buildAgentSkillContext, listAgentSkills } from './skills'
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
import type {
  AgentCommandInput,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentRunInput,
  ConnectionConfig
} from './types'

interface ActiveAgentRun {
  controller: AbortController
  supplements: string[]
}

const activeRuns = new Map<string, ActiveAgentRun>()

export function registerAgentIpc(): void {
  ipcMain.handle('agent:get-config', () => {
    return readAgentConfig()
  })

  ipcMain.handle('agent:get-models', () => {
    return getAgentProviders(readAgentConfig()).flatMap((provider) =>
      provider.models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        providerId: provider.id,
        providerName: provider.name,
        reasoning: Boolean(model.reasoning)
      }))
    )
  })

  ipcMain.handle('agent:list-skills', () => {
    return listAgentSkills()
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
      await validateModel(nextConfig)
    } catch (error) {
      return {
        ok: false,
        modelOk: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }

    const hasOpenApiConfig = Boolean(
      nextConfig.openApiBaseUrl.trim() && nextConfig.openApiDocument.trim()
    )
    if (!hasOpenApiConfig) {
      return {
        ok: true,
        modelOk: true,
        toolCount: 0,
        tools: []
      }
    }

    try {
      const registry = await loadOpenApiToolRegistry(nextConfig)
      return {
        ok: true,
        modelOk: true,
        toolCount: registry.tools.length,
        tools: registry.catalog.slice(0, 8)
      }
    } catch (error) {
      return {
        ok: false,
        modelOk: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:cancel', (_, runId: string) => {
    activeRuns.get(runId)?.controller.abort()
    return { ok: true }
  })

  ipcMain.handle('agent:supplement', (_, payload: { runId?: string; input?: string }) => {
    const runId = payload?.runId?.trim()
    const input = payload?.input?.trim()
    if (!runId || !input) return { ok: false }

    const run = activeRuns.get(runId)
    if (!run) return { ok: false }

    run.supplements.push(input)
    return { ok: true }
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

  ipcMain.handle(
    'agent:resolve-connection-intent',
    async (_, payload: AgentConnectionIntentInput): Promise<AgentConnectionIntentResult> => {
      const input = payload?.input?.trim()
      if (!input) return { ok: false, error: 'Input is empty.' }

      const connections = [...loadSshConfigConnections(), ...readCustomConnections()]
      if (connections.length === 0) return { ok: false, reason: 'No configured connections.' }

      try {
        const completion = await new AgentBrain(readAgentConfig()).chat({
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'You resolve whether an operations request implies logging into one configured SSH connection. Return strict JSON only: {"connectionId":"...","confidence":0-100,"reason":"..."}. If no connection is clearly implied, return {"connectionId":null,"confidence":0,"reason":"no match"}. Prefer exact cluster, environment, host alias, hostname, or description matches. Do not invent ids.'
            },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  request: input,
                  connections: connections.map(summarizeConnectionForAi)
                },
                null,
                2
              )
            }
          ]
        })
        const parsed = parseConnectionIntentResponse(
          completion.choices[0]?.message.content ?? '',
          connections
        )

        return parsed
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('agent:run', async (event, payload: AgentRunInput) => {
    const input = payload?.input?.trim()
    const runId =
      payload?.runId?.trim() || `run-${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (!input) {
      return { ok: false, error: 'Input is empty.' }
    }

    if (input.startsWith('/remember ')) {
      const memory = createMemory()
      memory.addLongTermNote(input.slice('/remember '.length))
      event.sender.send('agent:event', {
        type: 'done',
        message: 'Saved to long-term memory.',
        runId,
        tabId: payload?.tabId
      })
      return { ok: true, text: 'Saved to long-term memory.' }
    }

    try {
      const controller = new AbortController()
      activeRuns.set(runId, { controller, supplements: [] })
      const connection = findConnection(payload?.connectionId)
      const skillContext = buildAgentSkillContext(input)
      const text = await runTerminalAgent(
        readAgentConfig(),
        input,
        createMemory(),
        payload?.terminalContext ?? '',
        (agentEvent) => {
          event.sender.send('agent:event', { ...agentEvent, runId, tabId: payload?.tabId })
        },
        {
          executeCommand: (command, timeoutMs) =>
            executeCommandInTerminal(event.sender.id, command, timeoutMs, payload?.tabId)
        },
        {
          signal: controller.signal,
          skillContext: skillContext.promptBlock,
          consumeSupplementalInputs: () => {
            const run = activeRuns.get(runId)
            if (!run?.supplements.length) return []

            return run.supplements.splice(0)
          }
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
      event.sender.send('agent:event', { type: 'error', message, runId, tabId: payload?.tabId })
      return { ok: false, error: message }
    } finally {
      activeRuns.delete(runId)
    }
  })
}

function summarizeConnectionForAi(connection: ConnectionConfig): Record<string, unknown> {
  return {
    id: connection.id,
    source: connection.source,
    name: connection.name,
    host: connection.host,
    user: connection.user,
    port: connection.port,
    identityFile: connection.identityFile,
    description: connection.description,
    sshOptions: connection.sshOptions
  }
}

function parseConnectionIntentResponse(
  content: string,
  connections: ConnectionConfig[]
): AgentConnectionIntentResult {
  try {
    const parsed = JSON.parse(content) as {
      connectionId?: unknown
      confidence?: unknown
      reason?: unknown
    }
    const connectionId = typeof parsed.connectionId === 'string' ? parsed.connectionId : undefined
    const confidence = Number(parsed.confidence)
    const knownIds = new Set(connections.map((connection) => connection.id))

    if (!connectionId || !knownIds.has(connectionId) || !Number.isFinite(confidence)) {
      return {
        ok: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'no match'
      }
    }

    return {
      ok: confidence >= 60,
      connectionId,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined
    }
  } catch {
    return { ok: false, confidence: 0, reason: 'invalid model response' }
  }
}

function createMemory(): AgentMemory {
  return new AgentMemory(readCrescentMemory(), (nextMemory) => {
    writeCrescentMemory(nextMemory)
  })
}

async function validateModel(config: AgentConfig): Promise<void> {
  const completion = await new AgentBrain(config).chat({
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: 'Reply with OK.'
      }
    ]
  })

  const text = completion.choices[0]?.message.content?.trim()
  if (!text) throw new Error('Model returned an empty validation response.')
}

function findConnection(id: string | undefined): { id: string; name: string } | undefined {
  if (!id) return undefined

  return [...loadSshConfigConnections(), ...readCustomConnections()].find(
    (connection) => connection.id === id
  )
}
