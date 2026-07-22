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

function buildTestMcpServerScript(): string {
  return `
let buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')
    if (headerEnd < 0) return
    const header = buffer.subarray(0, headerEnd).toString('utf8')
    const match = /^content-length:\\s*(\\d+)$/im.exec(header)
    if (!match) throw new Error('missing content length')
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + Number(match[1])
    if (buffer.length < bodyEnd) return
    const request = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8'))
    buffer = buffer.subarray(bodyEnd)
    handle(request)
  }
})

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
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body)
}
`.trim()
}
