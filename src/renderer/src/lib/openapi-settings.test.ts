import { describe, expect, it } from 'vitest'

import { filterOpenApiValidationTools, summarizeOpenApiDocument } from './openapi-settings'

describe('summarizeOpenApiDocument', () => {
  it('detects empty, url, file, and inline documents', () => {
    expect(summarizeOpenApiDocument('')).toEqual({ kind: 'empty', preview: '' })
    expect(summarizeOpenApiDocument('https://api.example/openapi.json')).toEqual({
      kind: 'url',
      preview: 'https://api.example/openapi.json'
    })
    expect(summarizeOpenApiDocument('/tmp/openapi.json')).toEqual({
      kind: 'file',
      preview: '/tmp/openapi.json'
    })
    expect(summarizeOpenApiDocument('{"openapi":"3.0.0"}')).toEqual({
      kind: 'inline',
      preview: '19 chars JSON'
    })
  })
})

describe('filterOpenApiValidationTools', () => {
  it('keeps only OpenAPI catalog entries', () => {
    const tools = filterOpenApiValidationTools({
      ok: true,
      modelOk: true,
      toolCount: 3,
      tools: [
        {
          name: 'execute_terminal_command',
          method: 'post',
          path: 'terminal://current-session',
          description: 'terminal',
          source: 'built-in'
        },
        {
          name: 'listPets',
          method: 'get',
          path: '/pets',
          description: 'list pets',
          source: 'openapi'
        },
        {
          name: 'mcp_tool',
          method: 'post',
          path: 'mcp://server/tool',
          description: 'mcp',
          source: 'mcp'
        }
      ]
    })

    expect(tools.map((tool) => tool.name)).toEqual(['listPets'])
  })
})
