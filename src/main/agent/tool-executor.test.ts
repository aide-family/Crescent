import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { OpenApiToolExecutor } from './tool-executor'
import type { AgentConfig, OpenApiOperationMeta } from './types'

vi.mock('axios', () => ({
  default: {
    request: vi.fn()
  }
}))

const request = vi.mocked(axios.request)

const config: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: 'https://api.example.test/v1/',
  openApiDocument: '{}'
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
        url: 'https://api.example.test/orders/A%20100?includeTimeline=true'
      })
    )
    expect(result).toMatchObject({ ok: true, status: 200, data: { status: 'paid' } })
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
})
