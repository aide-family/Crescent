import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenApiToolExecutor } from './tool-executor'
import type { AgentConfig, OpenApiOperationMeta } from './types'

vi.mock('axios', () => ({
  default: {
    request: vi.fn()
  }
}))

const request = vi.mocked(axios.request)

beforeEach(() => {
  request.mockReset()
})

const config: AgentConfig = {
  providers: [
    {
      id: 'test-provider',
      name: 'Test Provider',
      baseUrl: 'https://model.example.test/v1',
      apiKey: '',
      models: [{ id: 'test-model', name: 'test-model' }]
    }
  ],
  providerId: 'test-provider',
  model: 'test-model',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiProfiles: [],
  openApiProfileId: undefined,
  openApiBaseUrl: 'https://api.example.test/v1/',
  openApiDocument: '{}',
  openApiTimeoutMs: 30_000,
  openApiMaxRetries: 2,
  openApiRetryBackoffMs: 0,
  skillRoot: '~/.agents/skills',
  mcpServers: []
}

const operations = new Map<string, OpenApiOperationMeta>([
  [
    'get_order',
    {
      name: 'get_order',
      method: 'get',
      path: '/orders/{orderId}'
    }
  ],
  [
    'create_order',
    {
      name: 'create_order',
      method: 'post',
      path: '/orders',
      requestBodyContentType: 'application/json'
    }
  ]
])

describe('OpenApiToolExecutor', () => {
  it('fills path params, appends query, and returns HTTP data', async () => {
    request.mockResolvedValueOnce({
      status: 200,
      headers: { 'x-request-id': 'req-1' },
      data: { status: 'paid' }
    })

    const executor = new OpenApiToolExecutor(config, operations)
    const result = await executor.execute(
      'get_order',
      JSON.stringify({ path: { orderId: 'A 100' }, query: { includeTimeline: true } })
    )

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        url: 'https://api.example.test/orders/A%20100?includeTimeline=true',
        timeout: 30_000
      })
    )
    expect(result).toMatchObject({ ok: true, status: 200, data: { status: 'paid' }, attempts: 1 })
  })

  it('redacts sensitive response headers before returning tool results', async () => {
    request.mockResolvedValueOnce({
      status: 200,
      headers: {
        authorization: 'Bearer leaked',
        'set-cookie': 'session=abc',
        'x-request-id': 'req-9'
      },
      data: { apiKey: 'sk-should-hide', ok: true }
    })

    const executor = new OpenApiToolExecutor(config, operations)
    const result = await executor.execute('get_order', JSON.stringify({ path: { orderId: 'A1' } }))

    expect(result).toMatchObject({
      ok: true,
      headers: {
        authorization: '[REDACTED]',
        'set-cookie': '[REDACTED]',
        'x-request-id': 'req-9'
      },
      data: {
        apiKey: '[REDACTED]',
        ok: true
      }
    })
  })

  it('sends JSON body with operation content type', async () => {
    request.mockResolvedValueOnce({
      status: 201,
      headers: {},
      data: { id: 'A100' }
    })

    const executor = new OpenApiToolExecutor(config, operations)
    await executor.execute('create_order', JSON.stringify({ body: { sku: 'book' } }))

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        headers: { 'content-type': 'application/json' },
        data: { sku: 'book' }
      })
    )
  })

  it('returns a structured error for missing path params', async () => {
    const executor = new OpenApiToolExecutor(config, operations)
    const result = await executor.execute('get_order', '{}')

    expect(result).toMatchObject({
      ok: false,
      error: 'Missing required path parameter: orderId'
    })
  })

  it('retries retryable HTTP statuses then returns the final response', async () => {
    request
      .mockResolvedValueOnce({ status: 503, headers: {}, data: { error: 'unavailable' } })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { ok: true } })

    const executor = new OpenApiToolExecutor(config, operations)
    const result = await executor.execute('get_order', JSON.stringify({ path: { orderId: 'A1' } }))

    expect(request).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, status: 200, attempts: 2 })
  })

  it('retries network failures and surfaces the final timeout error', async () => {
    const timeoutError = Object.assign(new Error('timeout of 30000ms exceeded'), {
      code: 'ECONNABORTED',
      isAxiosError: true
    })
    request.mockRejectedValueOnce(timeoutError).mockRejectedValueOnce(timeoutError)

    const executor = new OpenApiToolExecutor(
      { ...config, openApiMaxRetries: 1, openApiRetryBackoffMs: 0 },
      operations
    )
    const result = await executor.execute('get_order', JSON.stringify({ path: { orderId: 'A1' } }))

    expect(request).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      ok: false,
      code: 'ECONNABORTED',
      attempts: 2
    })
  })
})
