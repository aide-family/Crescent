import { Type } from 'typebox'
import type { TSchema } from 'typebox'

import { applyToolNamePolicy } from '../../shared/tool-policy'
import { isMcpServerComplete, redactMcpUrl } from '../../shared/mcp-servers'
import type { AgentMcpServerConfig, ToolCatalogEntry } from '../../shared/agent-types'
import type { PiCodingAgentModule } from './pi-sdk'
import { loadMcpSdk } from './mcp-sdk'

export const MCP_TOOL_RESULT_MAX_CHARS = 50 * 1024
export const MCP_CONNECT_TIMEOUT_MS = 10_000
export const MCP_CALL_TIMEOUT_MS = 30_000

export interface McpRuntimeClient {
  listTools(): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
  }>
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<{
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
  }>
  close(): Promise<void>
}

export type McpServerConnector = (server: AgentMcpServerConfig) => Promise<McpRuntimeClient>

export interface McpLoadedTools {
  tools: ReturnType<PiCodingAgentModule['defineTool']>[]
  toolNames: string[]
  catalog: ToolCatalogEntry[]
  errors: Record<string, string>
  close: () => Promise<void>
}

export function mcpPiToolName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeToolNamePart(serverId)}_${sanitizeToolNamePart(toolName)}`
}

export function mcpCatalogPath(serverId: string, toolName: string): string {
  return `mcp://${serverId}/${toolName}`
}

export function truncateMcpToolResult(text: string, maxChars = MCP_TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n\n…[truncated ${omitted} chars]`
}

export function formatMcpCallToolResult(result: {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}): string {
  const parts = (result.content ?? [])
    .map((part) => {
      if (part.type === 'text') return part.text ?? ''
      try {
        return JSON.stringify(part)
      } catch {
        return String(part)
      }
    })
    .filter(Boolean)
  const body = parts.join('\n') || JSON.stringify(result)
  const prefix = result.isError ? 'MCP tool error:\n' : ''
  return truncateMcpToolResult(`${prefix}${body}`)
}

export function buildMcpCatalogEntry(
  serverId: string,
  tool: { name: string; description?: string }
): ToolCatalogEntry {
  return {
    name: tool.name,
    method: 'post',
    path: mcpCatalogPath(serverId, tool.name),
    description: tool.description?.trim() || `MCP tool ${tool.name}`,
    source: 'mcp',
    risk: 'medium',
    requiresApproval: false,
    external: true,
    stateChanging: true
  }
}

export async function connectMcpServer(server: AgentMcpServerConfig): Promise<McpRuntimeClient> {
  if (!isMcpServerComplete(server)) {
    throw new Error('Incomplete MCP server config.')
  }
  const sdk = await loadMcpSdk()
  if (server.transport === 'http') {
    return connectHttpServer(sdk, server)
  }
  return connectStdioServer(sdk, server)
}

export async function listMcpToolCatalog(
  servers: AgentMcpServerConfig[],
  connect: McpServerConnector = connectMcpServer
): Promise<{ tools: ToolCatalogEntry[]; errors: Record<string, string> }> {
  const tools: ToolCatalogEntry[] = []
  const errors: Record<string, string> = {}

  await Promise.all(
    servers
      .filter((server) => server.enabled)
      .map(async (server) => {
        let client: McpRuntimeClient | undefined
        try {
          client = await connect(server)
          const listed = await client.listTools()
          const filtered = applyToolNamePolicy(listed.tools ?? [], {
            allowList: server.toolAllowList,
            denyList: server.toolDenyList
          })
          for (const tool of filtered) {
            tools.push(buildMcpCatalogEntry(server.id, tool))
          }
        } catch (error) {
          errors[server.id] = sanitizeMcpError(server, error)
        } finally {
          await client?.close().catch(() => undefined)
        }
      })
  )

  return { tools, errors }
}

export async function loadMcpPiTools(
  pi: PiCodingAgentModule,
  servers: AgentMcpServerConfig[],
  connect: McpServerConnector = connectMcpServer
): Promise<McpLoadedTools> {
  const tools: ReturnType<PiCodingAgentModule['defineTool']>[] = []
  const toolNames: string[] = []
  const catalog: ToolCatalogEntry[] = []
  const errors: Record<string, string> = {}
  const clients: McpRuntimeClient[] = []

  for (const server of servers.filter((candidate) => candidate.enabled)) {
    let client: McpRuntimeClient | undefined
    try {
      client = await connect(server)
      const listed = await client.listTools()
      const filtered = applyToolNamePolicy(listed.tools ?? [], {
        allowList: server.toolAllowList,
        denyList: server.toolDenyList
      })
      clients.push(client)
      for (const tool of filtered) {
        const definition = createMcpPiToolDefinition(pi, server, tool, client)
        tools.push(definition)
        toolNames.push(definition.name)
        catalog.push(buildMcpCatalogEntry(server.id, tool))
      }
    } catch (error) {
      errors[server.id] = sanitizeMcpError(server, error)
      await client?.close().catch(() => undefined)
    }
  }

  return {
    tools,
    toolNames,
    catalog,
    errors,
    close: async () => {
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)))
    }
  }
}

export function createMcpPiToolDefinition(
  pi: PiCodingAgentModule,
  server: AgentMcpServerConfig,
  tool: { name: string; description?: string; inputSchema?: unknown },
  client: McpRuntimeClient
): ReturnType<PiCodingAgentModule['defineTool']> {
  const name = mcpPiToolName(server.id, tool.name)
  return pi.defineTool({
    name,
    label: `${server.name || server.id}: ${tool.name}`,
    description: [
      tool.description?.trim() || `Call MCP tool ${tool.name}`,
      `MCP server: ${server.name || server.id}.`
    ].join(' '),
    promptSnippet: `${name} — MCP ${server.name || server.id} / ${tool.name}`,
    parameters: mcpParametersSchema(tool.inputSchema),
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal) {
      const result = await client.callTool(
        {
          name: tool.name,
          arguments: isRecord(params) ? params : {}
        },
        undefined,
        { signal, timeout: MCP_CALL_TIMEOUT_MS }
      )
      const text = formatMcpCallToolResult(result)
      return {
        content: [{ type: 'text' as const, text }],
        details: { serverId: server.id, tool: tool.name }
      }
    }
  })
}

async function connectHttpServer(
  sdk: Awaited<ReturnType<typeof loadMcpSdk>>,
  server: AgentMcpServerConfig
): Promise<McpRuntimeClient> {
  const url = new URL(server.url ?? '')
  const headers = server.headers
  const requestInit = headers && Object.keys(headers).length ? { headers } : undefined
  try {
    return await connectWithTransport(
      sdk,
      new sdk.StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined)
    )
  } catch (streamableError) {
    try {
      return await connectWithTransport(
        sdk,
        new sdk.SSEClientTransport(url, requestInit ? { requestInit } : undefined)
      )
    } catch {
      throw streamableError
    }
  }
}

async function connectStdioServer(
  sdk: Awaited<ReturnType<typeof loadMcpSdk>>,
  server: AgentMcpServerConfig
): Promise<McpRuntimeClient> {
  const transport = new sdk.StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...sdk.getDefaultEnvironment(), ...server.env },
    stderr: 'pipe'
  })
  return connectWithTransport(sdk, transport)
}

async function connectWithTransport(
  sdk: Awaited<ReturnType<typeof loadMcpSdk>>,
  transport:
    | InstanceType<Awaited<ReturnType<typeof loadMcpSdk>>['StreamableHTTPClientTransport']>
    | InstanceType<Awaited<ReturnType<typeof loadMcpSdk>>['SSEClientTransport']>
    | InstanceType<Awaited<ReturnType<typeof loadMcpSdk>>['StdioClientTransport']>
): Promise<McpRuntimeClient> {
  const client = new sdk.Client({ name: 'crescent', version: '1.0.7' })
  const timeout = AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS)
  await client.connect(transport, { signal: timeout, timeout: MCP_CONNECT_TIMEOUT_MS })
  return {
    listTools: () => client.listTools(),
    callTool: async (params, _resultSchema, options) => {
      const result = await client.callTool(params, undefined, options)
      if ('content' in result && Array.isArray(result.content)) {
        return {
          content: result.content.map((part) => ({
            type: part.type,
            text: 'text' in part ? part.text : undefined
          })),
          isError: 'isError' in result ? Boolean(result.isError) : false
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
    close: () => client.close()
  }
}

function mcpParametersSchema(inputSchema: unknown): TSchema {
  if (isRecord(inputSchema) && (inputSchema.type === 'object' || inputSchema.properties)) {
    return Type.Unsafe(inputSchema as TSchema)
  }
  return Type.Object({})
}

function sanitizeToolNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

function sanitizeMcpError(server: AgentMcpServerConfig, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (server.transport === 'http' && server.url) {
    return raw.replaceAll(server.url, redactMcpUrl(server.url))
  }
  return raw
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
