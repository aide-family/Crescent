import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadOpenApiDocument,
  resolveOpenApiDocumentSource,
  tryResolveLocalOpenApiPath
} from './tool-registry'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveOpenApiDocumentSource', () => {
  it('classifies http URLs', () => {
    expect(resolveOpenApiDocumentSource('https://example.test/openapi.json')).toEqual({
      kind: 'url',
      url: 'https://example.test/openapi.json'
    })
  })

  it('classifies inline JSON documents', () => {
    expect(resolveOpenApiDocumentSource('{"openapi":"3.0.0"}')).toEqual({
      kind: 'inline',
      content: '{"openapi":"3.0.0"}'
    })
  })

  it('classifies existing local JSON files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crescent-openapi-'))
    tempDirs.push(dir)
    const path = join(dir, 'openapi.json')
    writeFileSync(
      path,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Demo', version: '1.0.0' },
        paths: {}
      })
    )

    expect(resolveOpenApiDocumentSource(path)).toEqual({
      kind: 'file',
      path
    })
  })

  it('throws when a path-like document is missing', () => {
    expect(() => tryResolveLocalOpenApiPath('/tmp/crescent-missing-openapi.json')).toThrow(
      /not found/i
    )
  })
})

describe('loadOpenApiDocument', () => {
  it('parses a local OpenAPI JSON file into an object', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crescent-openapi-'))
    tempDirs.push(dir)
    const path = join(dir, 'openapi.json')
    writeFileSync(
      path,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Demo', version: '1.0.0' },
        paths: {
          '/ping': {
            get: {
              operationId: 'ping',
              responses: { '200': { description: 'ok' } }
            }
          }
        }
      })
    )

    const document = await loadOpenApiDocument(path)
    expect(document).toMatchObject({
      openapi: '3.0.0',
      info: { title: 'Demo' }
    })
  })
})
