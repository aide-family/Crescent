import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OpenApiToolExecutor } from './tool-executor'
import { loadOpenApiToolRegistry } from './tool-registry'
import type { AgentConfig } from './types'

describe('OpenAPI mock-server integration', () => {
  let server: Server
  let baseUrl = ''
  let hits = {
    getOrder: 0,
    createOrder: 0,
    flaky: 0
  }

  beforeAll(async () => {
    server = createServer((request, response) => {
      void handleMockRequest(request, response, hits)
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind OpenAPI mock server')
    }

    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('loads tools from a local OpenAPI document and executes real HTTP calls', async () => {
    const config = buildConfig(baseUrl)
    const registry = await loadOpenApiToolRegistry(config)
    const executor = new OpenApiToolExecutor(config, registry.operations)

    expect(registry.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'get_order',
          method: 'get',
          path: '/orders/{orderId}',
          requiresApproval: false
        }),
        expect.objectContaining({
          name: 'create_order',
          method: 'post',
          path: '/orders',
          requiresApproval: true,
          stateChanging: true
        })
      ])
    )

    const getResult = await executor.execute(
      'get_order',
      JSON.stringify({
        path: { orderId: 'A-100' },
        query: { includeTimeline: true },
        headers: { Authorization: 'Bearer secret-token' }
      })
    )

    expect(hits.getOrder).toBe(1)
    expect(getResult).toMatchObject({
      ok: true,
      status: 200,
      attempts: 1,
      data: {
        id: 'A-100',
        status: 'paid',
        includeTimeline: true
      }
    })

    const createResult = await executor.execute(
      'create_order',
      JSON.stringify({
        headers: { Authorization: 'Bearer secret-token' },
        body: { sku: 'book' }
      })
    )

    expect(hits.createOrder).toBe(1)
    expect(createResult).toMatchObject({
      ok: true,
      status: 201,
      attempts: 1,
      headers: expect.objectContaining({
        authorization: '[REDACTED]'
      }),
      data: {
        id: 'created-1',
        sku: 'book',
        apiKey: '[REDACTED]'
      }
    })
  })

  it('retries against a flaky local endpoint until success', async () => {
    hits.flaky = 0
    const config = {
      ...buildConfig(baseUrl),
      openApiMaxRetries: 2,
      openApiRetryBackoffMs: 0
    }
    const registry = await loadOpenApiToolRegistry(config)
    const executor = new OpenApiToolExecutor(config, registry.operations)

    const result = await executor.execute('get_flaky', JSON.stringify({}))

    expect(hits.flaky).toBeGreaterThanOrEqual(2)
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { ok: true },
      attempts: expect.any(Number)
    })
    expect((result as { attempts: number }).attempts).toBeGreaterThanOrEqual(2)
  })
})

function buildConfig(baseUrl: string): AgentConfig {
  return {
    providers: [],
    providerId: undefined,
    model: '',
    agentMode: 'react',
    maxActiveTools: 5,
    commandWhitelist: [],
    openApiProfiles: [],
    openApiProfileId: undefined,
    openApiBaseUrl: `${baseUrl}/`,
    openApiDocument: JSON.stringify(buildOpenApiDocument()),
    openApiTimeoutMs: 5_000,
    openApiMaxRetries: 1,
    openApiRetryBackoffMs: 0,
    skillRoot: '~/.agents/skills',
    mcpServers: []
  }
}

function buildOpenApiDocument(): object {
  return {
    openapi: '3.0.0',
    info: { title: 'Mock Orders', version: '1.0.0' },
    paths: {
      '/orders/{orderId}': {
        get: {
          operationId: 'get_order',
          summary: 'Get order',
          parameters: [
            { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeTimeline', in: 'query', schema: { type: 'boolean' } }
          ],
          responses: { '200': { description: 'ok' } }
        }
      },
      '/orders': {
        post: {
          operationId: 'create_order',
          summary: 'Create order',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { sku: { type: 'string' } }
                }
              }
            }
          },
          responses: { '201': { description: 'created' } }
        }
      },
      '/flaky': {
        get: {
          operationId: 'get_flaky',
          summary: 'Flaky endpoint',
          responses: { '200': { description: 'ok' } }
        }
      }
    }
  }
}

async function handleMockRequest(
  request: IncomingMessage,
  response: ServerResponse,
  hits: { getOrder: number; createOrder: number; flaky: number }
): Promise<void> {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const method = (request.method || 'GET').toUpperCase()

  if (method === 'GET' && /^\/orders\/[^/]+$/.test(url.pathname)) {
    hits.getOrder += 1
    const orderId = decodeURIComponent(url.pathname.split('/').pop() || '')
    writeJson(response, 200, {
      id: orderId,
      status: 'paid',
      includeTimeline: url.searchParams.get('includeTimeline') === 'true'
    })
    return
  }

  if (method === 'POST' && url.pathname === '/orders') {
    hits.createOrder += 1
    const body = await readJsonBody(request)
    response.setHeader('authorization', 'Bearer should-redact')
    writeJson(response, 201, {
      id: 'created-1',
      sku: body.sku,
      apiKey: 'sk-should-redact'
    })
    return
  }

  if (method === 'GET' && url.pathname === '/flaky') {
    hits.flaky += 1
    if (hits.flaky < 2) {
      writeJson(response, 503, { error: 'unavailable' })
      return
    }
    writeJson(response, 200, { ok: true })
    return
  }

  writeJson(response, 404, { error: 'not found', path: url.pathname })
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(payload)
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
