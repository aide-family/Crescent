import { describe, expect, it } from 'vitest'

import { extractJsonPayload, parseJsonFromModelContent } from './json-parse'

describe('json-parse helpers', () => {
  it('extracts fenced JSON payloads', () => {
    const payload = extractJsonPayload('prefix\n```json\n{"ok":true}\n```\nsuffix')
    expect(payload).toBe('{"ok":true}')
    expect(parseJsonFromModelContent<{ ok: boolean }>(payload!).ok).toBe(true)
  })

  it('extracts the outermost object when prose surrounds JSON', () => {
    const parsed = parseJsonFromModelContent<{ shouldConnect: boolean }>(
      'Result:\n{"shouldConnect":true,"confidence":90}\nThanks'
    )
    expect(parsed.shouldConnect).toBe(true)
  })
})
