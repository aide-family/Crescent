import axios, { AxiosError } from 'axios'

import type { AgentConfig, OpenApiOperationMeta } from './types'

export class OpenApiToolExecutor {
  constructor(
    private readonly config: AgentConfig,
    private readonly operations: Map<string, OpenApiOperationMeta>
  ) {}

  async execute(toolName: string, rawArguments: string): Promise<unknown> {
    const operation = this.operations.get(toolName)

    if (!operation) {
      return { ok: false, error: `Unknown tool ${toolName}` }
    }

    const args = normalizeToolArgs(parseToolArguments(rawArguments))
    const url = new URL(fillPathParams(operation.path, args.path), this.config.openApiBaseUrl)

    for (const [key, value] of Object.entries(args.query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

    try {
      const response = await axios.request({
        method: operation.method,
        url: url.toString(),
        headers: {
          ...args.headers,
          ...(operation.requestBodyContentType ? { 'content-type': operation.requestBodyContentType } : {})
        },
        data: args.body,
        validateStatus: () => true
      })

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: response.headers,
        data: response.data
      }
    } catch (error) {
      const axiosError = error as AxiosError

      return {
        ok: false,
        error: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
        data: axiosError.response?.data
      }
    }
  }
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function normalizeToolArgs(args: unknown): {
  path: Record<string, unknown>
  query: Record<string, unknown>
  headers: Record<string, string>
  body?: unknown
} {
  const value = isRecord(args) ? args : {}

  return {
    path: isRecord(value.path) ? value.path : {},
    query: isRecord(value.query) ? value.query : {},
    headers: isRecord(value.headers)
      ? Object.fromEntries(Object.entries(value.headers).map(([key, val]) => [key, String(val)]))
      : {},
    body: value.body
  }
}

function fillPathParams(pathTemplate: string, pathParams: Record<string, unknown>): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = pathParams[key]

    if (value === undefined || value === null) {
      throw new Error(`Missing required path parameter: ${key}`)
    }

    return encodeURIComponent(String(value))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
