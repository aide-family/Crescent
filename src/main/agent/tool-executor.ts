import axios, { AxiosError, type AxiosRequestConfig } from 'axios'

import { redactSensitiveData, redactSensitiveHeaders } from '../../shared/secret-redaction'
import type { AgentConfig, OpenApiOperationMeta } from './types'

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ERR_NETWORK'
])

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

    try {
      const args = normalizeToolArgs(parseToolArguments(rawArguments))
      const url = new URL(fillPathParams(operation.path, args.path), this.config.openApiBaseUrl)

      for (const [key, value] of Object.entries(args.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
      }

      const requestConfig: AxiosRequestConfig = {
        method: operation.method,
        url: url.toString(),
        headers: {
          ...args.headers,
          ...(operation.requestBodyContentType
            ? { 'content-type': operation.requestBodyContentType }
            : {})
        },
        data: args.body,
        timeout: this.config.openApiTimeoutMs,
        validateStatus: () => true
      }

      const response = await requestWithRetry(requestConfig, {
        maxRetries: this.config.openApiMaxRetries,
        retryBackoffMs: this.config.openApiRetryBackoffMs
      })

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: redactSensitiveHeaders(normalizeHeaders(response.headers)),
        data: redactSensitiveData(response.data),
        attempts: response.attempts
      }
    } catch (error) {
      const axiosError = error as AxiosError

      return {
        ok: false,
        error: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
        headers: redactSensitiveHeaders(normalizeHeaders(axiosError.response?.headers)),
        data: redactSensitiveData(axiosError.response?.data),
        attempts: getAttemptCount(error)
      }
    }
  }
}

export async function requestWithRetry(
  requestConfig: AxiosRequestConfig,
  options: { maxRetries: number; retryBackoffMs: number; sleep?: (ms: number) => Promise<void> }
): Promise<{
  status: number
  headers: unknown
  data: unknown
  attempts: number
}> {
  const maxRetries = Math.max(0, options.maxRetries)
  const sleep = options.sleep ?? delay
  let attempt = 0
  let lastError: unknown

  while (attempt <= maxRetries) {
    attempt += 1
    try {
      const response = await axios.request(requestConfig)
      if (attempt <= maxRetries && shouldRetryStatus(response.status)) {
        await sleep(options.retryBackoffMs * attempt)
        continue
      }

      return {
        status: response.status,
        headers: response.headers,
        data: response.data,
        attempts: attempt
      }
    } catch (error) {
      lastError = error
      if (attempt <= maxRetries && shouldRetryError(error)) {
        await sleep(options.retryBackoffMs * attempt)
        continue
      }
      attachAttemptCount(error, attempt)
      throw error
    }
  }

  attachAttemptCount(lastError, attempt)
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export function shouldRetryStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status)
}

export function shouldRetryError(error: unknown): boolean {
  const axiosError = error as AxiosError
  return Boolean(axiosError.code && RETRYABLE_ERROR_CODES.has(axiosError.code))
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

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function attachAttemptCount(error: unknown, attempts: number): void {
  if (error && typeof error === 'object') {
    ;(error as { attempts?: number }).attempts = attempts
  }
}

function getAttemptCount(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'attempts' in error) {
    const attempts = Number((error as { attempts?: unknown }).attempts)
    return Number.isFinite(attempts) ? attempts : undefined
  }
  return undefined
}

function normalizeHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  return Object.fromEntries(Object.entries(headers as Record<string, unknown>))
}
