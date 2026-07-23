import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { executeMcpTool, loadMcpToolRegistry } from './mcp-runtime'
import type { AgentConfig } from './types'

describe('mcp-runtime', () => {
  let root: string
  let serverPath: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'crescent-mcp-test-'))
    serverPath = join(root, 'server.cjs')
    writeFileSync(serverPath, buildTestMcpServerScript(), 'utf8')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('loads and executes stdio MCP tools', async () => {
    const config = buildConfig(serverPath)
    const registry = await loadMcpToolRegistry(config)
    const entry = registry.entries.get('mcp_test_mcp_echo')

    expect(registry.errors).toEqual([])
    expect(registry.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'mcp_test_mcp_echo',
          path: 'mcp://test-mcp/echo'
        })
      ])
    )
    expect(entry).toBeDefined()

    const result = await executeMcpTool(entry!, JSON.stringify({ text: 'hello' }))

    expect(result).toMatchObject({
      ok: true,
      server: 'Test MCP',
      tool: 'echo',
      result: {
        content: [{ type: 'text', text: 'hello' }]
      }
    })
  })

  it('accepts MCP responses separated by LF-only headers', async () => {
    writeFileSync(serverPath, buildTestMcpServerScript('\n\n'), 'utf8')
    const registry = await loadMcpToolRegistry(buildConfig(serverPath))

    expect(registry.errors).toEqual([])
    expect(registry.entries.get('mcp_test_mcp_echo')).toBeDefined()
  })
})

function buildConfig(serverPath: string): AgentConfig {
  return {
    providers: [],
    providerId: undefined,
    model: '',
    agentMode: 'react',
    maxActiveTools: 5,
    commandWhitelist: [],
    openApiBaseUrl: '',
    openApiDocument: '',
    skillRoot: '~/.agents/skills',
    mcpServers: [
      {
        id: 'test-mcp',
        name: 'Test MCP',
        transport: 'stdio',
        command: process.execPath,
        args: [serverPath],
        env: {},
        enabled: true
      }
    ]
  }
}

function buildTestMcpServerScript(responseSeparator = '\r\n\r\n'): string {
  return `
const responseSeparator = ${JSON.stringify(responseSeparator)}
let buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const parsed = readMessage()
    if (!parsed) return
    const request = parsed
    handle(request)
  }
})

function readMessage() {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 64)).toString('utf8')
  if (/^content-length:/i.test(prefix)) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')
    if (headerEnd < 0) return undefined
    const header = buffer.subarray(0, headerEnd).toString('utf8')
    const match = /^content-length:\\s*(\\d+)$/im.exec(header)
    if (!match) throw new Error('missing content length')
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + Number(match[1])
    if (buffer.length < bodyEnd) return undefined
    const request = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8'))
    buffer = buffer.subarray(bodyEnd)
    return request
  }

  const lineEnd = buffer.indexOf('\\n')
  if (lineEnd < 0) return undefined
  const line = buffer.subarray(0, lineEnd).toString('utf8').trim()
  buffer = buffer.subarray(lineEnd + 1)
  return line ? JSON.parse(line) : undefined
}

function handle(request) {
  if (!request.id) return
  if (request.method === 'initialize') {
    respond(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1.0.0' } })
    return
  }
  if (request.method === 'tools/list') {
    respond(request.id, { tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] })
    return
  }
  if (request.method === 'tools/call') {
    respond(request.id, { content: [{ type: 'text', text: request.params.arguments.text }] })
    return
  }
  respond(request.id, {})
}

function respond(id, result) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + responseSeparator + body)
}
`.trim()
}
