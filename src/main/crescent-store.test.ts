import { describe, expect, it } from 'vitest'

import { normalizeLastUsedConnectionId } from './crescent-store'

describe('normalizeLastUsedConnectionId', () => {
  it('trims and drops empty values', () => {
    expect(normalizeLastUsedConnectionId(undefined)).toBeUndefined()
    expect(normalizeLastUsedConnectionId('')).toBeUndefined()
    expect(normalizeLastUsedConnectionId('  ')).toBeUndefined()
    expect(normalizeLastUsedConnectionId('  conn-aide  ')).toBe('conn-aide')
  })
})
