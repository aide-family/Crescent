import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

import type { AgentConfig, AgentMcpServerConfig, OpenAiTool, ToolCatalogEntry } from './types'

const MCP_PROTOCOL_VERSION = '2024-11-05'
const MCP_REQUEST_TIMEOUT_MS = 12_000

interface JsonRpcResponse {
  id?: number | string
  result?: unknown
  error?: { message?: string; code?: number; data?: unknown }
}

interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: unknown
}

interface McpRegisteredTool {
  server: AgentMcpServerConfig
  tool: McpToolDefinition
  schema: OpenAiTool
  catalog: ToolCatalogEntry
}

export interface McpToolRegistrySnapshot {
  tools: OpenAiTool[]
  catalog: ToolCatalogEntry[]
  entries: Map<string, McpRegisteredTool>
  errors: string[]
}

export async function loadMcpToolRegistry(config: AgentConfig): Promise<McpToolRegistrySnapshot> {
  const entries = new Map<string, McpRegisteredTool>()
  const errors: string[] = []

  for (const server of config.mcpServers.filter((candidate) => candidate.enabled)) {
    if (!server.command.trim()) continue

    try {
      const tools = await listMcpServerTools(server)
      for (const tool of tools) {
        const functionName = buildMcpFunctionName(server, tool.name)
        if (entries.has(functionName)) continue

        const schema: OpenAiTool = {
          type: 'function',
          function: {
            name: functionName,
            description:
              tool.description ||
              `Call MCP tool "${tool.name}" from server "${server.name || server.id}".`,
            parameters: normalizeMcpInputSchema(tool.inputSchema)
          }
        }
        entries.set(functionName, {
          server,
          tool,
          schema,
          catalog: {
            name: functionName,
            method: 'post',
            path: `mcp://${server.id}/${tool.name}`,
            description: schema.function.description ?? ''
          }
        })
      }
    } catch (error) {
      errors.push(
        `${server.name || server.id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return {
    tools: [...entries.values()].map((entry) => entry.schema),
    catalog: [...entries.values()].map((entry) => entry.catalog),
    entries,
    errors
  }
}

export async function executeMcpTool(
  entry: McpRegisteredTool,
  rawArguments: string
): Promise<unknown> {
  const argumentsObject = parseMcpArguments(rawArguments)
  const client = new StdioMcpClient(entry.server)

  try {
    await client.start()
    await client.initialize()
    const result = await client.request('tools/call', {
      name: entry.tool.name,
      arguments: argumentsObject
    })

    return {
      ok: true,
      server: entry.server.name || entry.server.id,
      tool: entry.tool.name,
      result
    }
  } finally {
    client.close()
  }
}

async function listMcpServerTools(server: AgentMcpServerConfig): Promise<McpToolDefinition[]> {
  const client = new StdioMcpClient(server)

  try {
    await client.start()
    await client.initialize()
    const result = await client.request('tools/list', {})
    const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : []

    return tools.map(normalizeMcpToolDefinition).filter((tool) => tool.name)
  } finally {
    client.close()
  }
}

class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason: unknown) => void
      timeout: NodeJS.Timeout
    }
  >()

  constructor(private readonly server: AgentMcpServerConfig) {}

  async start(): Promise<void> {
    if (this.child) return

    this.child = spawn(this.server.command, this.server.args, {
      env: { ...process.env, ...this.server.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk))
    this.child.once('error', (error) => this.rejectAll(error))
    this.child.once('exit', (code, signal) => {
      this.rejectAll(new Error(`MCP server exited before completing requests (${code ?? signal})`))
    })
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'crescent',
        version: '1.0.0'
      }
    })
    this.notify('notifications/initialized', {})
  }

  request(method: string, params: unknown): Promise<unknown> {
    const child = this.requireChild()
    const id = this.nextId
    this.nextId += 1

    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, MCP_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timeout })
    })

    child.stdin.write(encodeJsonRpcMessage(payload))
    return promise
  }

  notify(method: string, params: unknown): void {
    this.requireChild().stdin.write(
      encodeJsonRpcMessage({
        jsonrpc: '2.0',
        method,
        params
      })
    )
  }

  close(): void {
    if (!this.child) return

    this.child.removeAllListeners('exit')
    this.child.removeAllListeners('error')
    this.child.kill()
    this.child = undefined
    this.rejectAll(new Error('MCP client closed.'))
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (!this.child) throw new Error('MCP server is not started.')
    return this.child
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    while (true) {
      const parsed = readJsonRpcMessage(this.buffer)
      if (!parsed) return

      this.buffer = this.buffer.subarray(parsed.bytesRead)
      this.handleMessage(parsed.message)
    }
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message) || !('id' in message)) return

    const response = message as JsonRpcResponse
    const id = Number(response.id)
    const pending = this.pending.get(id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(id)

    if (response.error) {
      pending.reject(new Error(response.error.message || `MCP error ${response.error.code ?? ''}`))
    } else {
      pending.resolve(response.result)
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

function encodeJsonRpcMessage(payload: unknown): string {
  const body = JSON.stringify(payload)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

function readJsonRpcMessage(buffer: Buffer): { message: unknown; bytesRead: number } | undefined {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd < 0) return undefined

  const header = buffer.subarray(0, headerEnd).toString('utf8')
  const lengthMatch = /^content-length:\s*(\d+)$/im.exec(header)
  if (!lengthMatch) throw new Error('Invalid MCP message: missing Content-Length header.')

  const contentLength = Number(lengthMatch[1])
  const bodyStart = headerEnd + 4
  const bodyEnd = bodyStart + contentLength
  if (buffer.length < bodyEnd) return undefined

  return {
    message: JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8')),
    bytesRead: bodyEnd
  }
}

function normalizeMcpToolDefinition(value: unknown): McpToolDefinition {
  const record = isRecord(value) ? value : {}

  return {
    name: typeof record.name === 'string' ? record.name.trim() : '',
    description: typeof record.description === 'string' ? record.description : undefined,
    inputSchema: record.inputSchema
  }
}

function normalizeMcpInputSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true
    }
  }

  return {
    ...value,
    type: value.type === 'object' ? 'object' : 'object',
    properties: isRecord(value.properties) ? value.properties : {}
  }
}

function parseMcpArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function buildMcpFunctionName(server: AgentMcpServerConfig, toolName: string): string {
  return `mcp_${sanitizeFunctionName(server.id)}_${sanitizeFunctionName(toolName)}`.slice(0, 64)
}

function sanitizeFunctionName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'tool'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
