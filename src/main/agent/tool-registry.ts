import axios from 'axios'
import { createHash } from 'crypto'

import { parseOpenApiToToolBundle } from './openapi-tools'
import type { AgentConfig, OpenAiTool, OpenApiOperationMeta, ToolCatalogEntry } from './types'

export interface ToolRegistrySnapshot {
  cacheKey: string
  tools: OpenAiTool[]
  operations: Map<string, OpenApiOperationMeta>
  catalog: ToolCatalogEntry[]
}

const memoryCache = new Map<string, ToolRegistrySnapshot>()

export async function loadOpenApiToolRegistry(config: AgentConfig): Promise<ToolRegistrySnapshot> {
  const openApiSpec = await loadOpenApiDocument(config.openApiDocument)
  const cacheKey = createHash('sha256')
    .update(config.openApiBaseUrl)
    .update(typeof openApiSpec === 'string' ? openApiSpec : JSON.stringify(openApiSpec))
    .digest('hex')
  const cached = memoryCache.get(cacheKey)

  if (cached) return cached

  const { tools, operations } = await parseOpenApiToToolBundle(openApiSpec)
  const catalog = tools.map((tool) => {
    const operation = operations.get(tool.function.name)

    return {
      name: tool.function.name,
      method: operation?.method ?? 'get',
      path: operation?.path ?? '',
      description: tool.function.description ?? ''
    }
  })
  const snapshot = { cacheKey, tools, operations, catalog }

  memoryCache.set(cacheKey, snapshot)
  return snapshot
}

async function loadOpenApiDocument(documentInput: string): Promise<string | object> {
  const trimmed = documentInput.trim()

  if (!trimmed) throw new Error('OpenAPI document is empty.')

  if (/^https?:\/\//i.test(trimmed)) {
    const response = await axios.get(trimmed, {
      responseType: 'text',
      transformResponse: (data) => data,
      validateStatus: (status) => status >= 200 && status < 300
    })

    return response.data
  }

  return trimmed
}
