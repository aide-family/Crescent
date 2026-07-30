import axios from 'axios'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, resolve } from 'path'
import SwaggerParser from '@apidevtools/swagger-parser'

import { parseOpenApiToToolBundle } from './openapi-tools'
import type { AgentConfig, OpenAiTool, OpenApiOperationMeta, ToolCatalogEntry } from './types'

export interface ToolRegistrySnapshot {
  cacheKey: string
  tools: OpenAiTool[]
  operations: Map<string, OpenApiOperationMeta>
  catalog: ToolCatalogEntry[]
}

export type OpenApiDocumentSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'inline'; content: string }

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
      description: tool.function.description ?? '',
      source: 'openapi' as const,
      risk: isStateChangingHttpMethod(operation?.method) ? ('high' as const) : ('medium' as const),
      requiresApproval: isStateChangingHttpMethod(operation?.method),
      external: true,
      stateChanging: isStateChangingHttpMethod(operation?.method)
    }
  })
  const snapshot = { cacheKey, tools, operations, catalog }

  memoryCache.set(cacheKey, snapshot)
  return snapshot
}

function isStateChangingHttpMethod(method: OpenApiOperationMeta['method'] | undefined): boolean {
  return method === 'post' || method === 'put' || method === 'patch' || method === 'delete'
}

export function resolveOpenApiDocumentSource(documentInput: string): OpenApiDocumentSource {
  const trimmed = documentInput.trim()

  if (!trimmed) throw new Error('OpenAPI document is empty.')

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'url', url: trimmed }
  }

  const localPath = tryResolveLocalOpenApiPath(trimmed)
  if (localPath) {
    return { kind: 'file', path: localPath }
  }

  return { kind: 'inline', content: trimmed }
}

export async function loadOpenApiDocument(documentInput: string): Promise<string | object> {
  const source = resolveOpenApiDocumentSource(documentInput)

  if (source.kind === 'url') {
    const response = await axios.get(source.url, {
      responseType: 'text',
      transformResponse: (data) => data,
      timeout: 30_000,
      validateStatus: (status) => status >= 200 && status < 300
    })

    return response.data
  }

  if (source.kind === 'file') {
    try {
      return (await SwaggerParser.parse(source.path)) as object
    } catch (error) {
      throw new Error(
        `Failed to load OpenAPI file ${source.path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return source.content
}

export function tryResolveLocalOpenApiPath(documentInput: string): string | undefined {
  const trimmed = documentInput.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return undefined
  if (trimmed.includes('\n') || trimmed.includes('\r')) return undefined
  if (/^https?:\/\//i.test(trimmed)) return undefined

  let candidate = trimmed
  if (/^file:\/\//i.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate.replace(/^file:\/\//i, ''))
    } catch {
      return undefined
    }
  }

  const expanded = expandHomePath(candidate)
  const looksLikePath =
    isAbsolute(expanded) ||
    candidate.startsWith('~/') ||
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    candidate.startsWith('file://') ||
    /\.(json|ya?ml)$/i.test(candidate)

  if (!looksLikePath) return undefined

  const resolved = resolve(expanded)
  if (!existsSync(resolved)) {
    throw new Error(`OpenAPI document file not found: ${resolved}`)
  }

  return resolved
}

function expandHomePath(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input.replace(/^\$HOME(?=\/|$)/, homedir())
}
