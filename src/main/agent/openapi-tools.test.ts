import { describe, expect, it } from 'vitest'

import { parseOpenApiToToolBundle, parseOpenApiToTools } from './openapi-tools'

const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Orders',
    version: '1.0.0'
  },
  paths: {
    '/orders/{orderId}': {
      get: {
        operationId: 'get_order_status',
        summary: 'Get order status',
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          {
            name: 'includeTimeline',
            in: 'query',
            schema: { type: 'boolean' }
          }
        ],
        responses: {
          '200': {
            description: 'OK'
          }
        }
      }
    }
  }
}

describe('openapi-tools', () => {
  it('converts OpenAPI operations to OpenAI function tools', async () => {
    const tools = await parseOpenApiToTools(spec)

    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'get_order_status',
        description: 'Get order status'
      }
    })
    expect(tools[0].function.parameters).toMatchObject({
      type: 'object',
      required: ['path']
    })
  })

  it('keeps operation metadata for execution', async () => {
    const bundle = await parseOpenApiToToolBundle(spec)
    const operation = bundle.operations.get('get_order_status')

    expect(operation).toMatchObject({
      method: 'get',
      path: '/orders/{orderId}'
    })
  })
})
