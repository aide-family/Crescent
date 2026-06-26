import SwaggerParser from '@apidevtools/swagger-parser'

import type { HttpMethod, OpenAiTool, ParsedToolBundle } from './types'

type JsonSchema = {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  additionalProperties?: boolean | JsonSchema
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  format?: string
  default?: unknown
  nullable?: boolean
  [key: string]: unknown
}

const HTTP_METHODS = new Set<HttpMethod>([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace'
])

export async function parseOpenApiToTools(openApiSpec: string | object): Promise<OpenAiTool[]> {
  const { tools } = await parseOpenApiToToolBundle(openApiSpec)
  return tools
}

export async function parseOpenApiToToolBundle(openApiSpec: string | object): Promise<ParsedToolBundle> {
  let api: any

  try {
    const input = typeof openApiSpec === 'string' ? JSON.parse(openApiSpec) : openApiSpec
    api = await SwaggerParser.dereference(input)
  } catch (error) {
    throw new Error(
      `OpenAPI document is invalid: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!api || typeof api !== 'object' || !api.paths || typeof api.paths !== 'object') {
    throw new Error('OpenAPI document is missing a valid paths object.')
  }

  const tools: OpenAiTool[] = []
  const operations = new Map()
  const usedNames = new Set<string>()

  for (const [path, pathItem] of Object.entries<any>(api.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    const inheritedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : []

    for (const [rawMethod, operation] of Object.entries<any>(pathItem)) {
      const method = rawMethod.toLowerCase() as HttpMethod

      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue

      const name = uniqueToolName(
        sanitizeToolName(
          operation.operationId ??
            `${method}_${path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_')}`
        ),
        usedNames
      )
      const parametersSchema = buildParametersSchema([
        ...inheritedParameters,
        ...(Array.isArray(operation.parameters) ? operation.parameters : [])
      ])
      const requestBodySchema = buildRequestBodySchema(operation.requestBody)
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []

      if (parametersSchema.path) {
        properties.path = parametersSchema.path
        required.push('path')
      }

      if (parametersSchema.query) {
        properties.query = parametersSchema.query
        if (hasRequiredChildren(parametersSchema.query)) required.push('query')
      }

      if (parametersSchema.headers) {
        properties.headers = parametersSchema.headers
        if (hasRequiredChildren(parametersSchema.headers)) required.push('headers')
      }

      if (requestBodySchema) {
        properties.body = requestBodySchema.schema
        if (requestBodySchema.required) required.push('body')
      }

      tools.push({
        type: 'function',
        function: {
          name,
          description: buildOperationDescription(operation, method, path),
          parameters: {
            type: 'object',
            properties,
            required,
            additionalProperties: false
          }
        }
      })

      operations.set(name, {
        name,
        method,
        path,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        requestBodyContentType: requestBodySchema?.contentType
      })
    }
  }

  if (tools.length === 0) {
    throw new Error('OpenAPI document contains no callable operations.')
  }

  return { tools, operations }
}

function buildOperationDescription(operation: any, method: HttpMethod, path: string): string {
  const summary = typeof operation.summary === 'string' ? operation.summary : ''
  const description = typeof operation.description === 'string' ? operation.description : ''
  const text = [summary, description].filter(Boolean).join('\n\n').trim()

  return text || `${method.toUpperCase()} ${path}`
}

function buildParametersSchema(parameters: any[]): {
  path?: JsonSchema
  query?: JsonSchema
  headers?: JsonSchema
} {
  const buckets = {
    path: createObjectSchema(),
    query: createObjectSchema(),
    headers: createObjectSchema()
  }

  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object') continue

    const location = parameter.in as string | undefined
    const name = parameter.name as string | undefined
    const bucket =
      location === 'path'
        ? buckets.path
        : location === 'query'
          ? buckets.query
          : location === 'header'
            ? buckets.headers
            : undefined

    if (!name || !bucket) continue

    bucket.properties![name] = normalizeSchema(parameter.schema ?? {}, {
      description: parameter.description
    })

    if (parameter.required === true || location === 'path') {
      bucket.required ??= []
      bucket.required.push(name)
    }
  }

  return {
    path: hasProperties(buckets.path) ? buckets.path : undefined,
    query: hasProperties(buckets.query) ? buckets.query : undefined,
    headers: hasProperties(buckets.headers) ? buckets.headers : undefined
  }
}

function buildRequestBodySchema(
  requestBody: any
): { schema: JsonSchema; contentType: string; required: boolean } | undefined {
  if (!requestBody || typeof requestBody !== 'object') return undefined

  const content = requestBody.content
  if (!content || typeof content !== 'object') return undefined

  const contentType = content['application/json'] ? 'application/json' : Object.keys(content)[0]
  if (!contentType) return undefined

  return {
    schema: normalizeSchema(content[contentType]?.schema ?? { type: 'object' }, {
      description: requestBody.description
    }),
    contentType,
    required: requestBody.required === true
  }
}

function normalizeSchema(schema: any, extra?: { description?: string }): JsonSchema {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      additionalProperties: true,
      ...(extra?.description ? { description: extra.description } : {})
    }
  }

  const result: JsonSchema = { ...schema }

  delete result.readOnly
  delete result.writeOnly
  delete result.deprecated
  delete result.xml
  delete result.externalDocs
  delete result.example
  delete result.examples

  if (extra?.description && !result.description) result.description = extra.description

  if (result.nullable === true && typeof result.type === 'string') {
    result.type = [result.type, 'null']
    delete result.nullable
  }

  if (result.properties && typeof result.properties === 'object') {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, value]) => [key, normalizeSchema(value)])
    )
  }

  if (result.items) result.items = normalizeSchema(result.items)

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (Array.isArray(result[key])) result[key] = result[key].map((item) => normalizeSchema(item))
  }

  return result
}

function createObjectSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  }
}

function hasProperties(schema: JsonSchema): boolean {
  return Boolean(schema.properties && Object.keys(schema.properties).length > 0)
}

function hasRequiredChildren(schema: JsonSchema): boolean {
  return Boolean(schema.required && schema.required.length > 0)
}

function sanitizeToolName(input: string): string {
  const sanitized = input
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64)

  return sanitized || 'api_operation'
}

function uniqueToolName(name: string, usedNames: Set<string>): string {
  let candidate = name
  let index = 2

  while (usedNames.has(candidate)) {
    const suffix = `_${index}`
    candidate = `${name.slice(0, 64 - suffix.length)}${suffix}`
    index += 1
  }

  usedNames.add(candidate)
  return candidate
}
