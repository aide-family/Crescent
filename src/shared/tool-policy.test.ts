import { describe, expect, it } from 'vitest'

import {
  applyToolNamePolicy,
  formatToolNameListText,
  isToolNameAllowed,
  isToolNameDenied,
  normalizeToolNameList,
  parseToolNameListText
} from './tool-policy'

describe('tool-policy', () => {
  it('normalizes and dedupes tool name lists', () => {
    expect(normalizeToolNameList([' a ', 'a', '', 'b', 1])).toEqual(['a', 'b', '1'])
  })

  it('keeps all tools when policy is empty', () => {
    const tools = [{ name: 'get_pets' }, { name: 'create_pet' }]
    expect(applyToolNamePolicy(tools, {})).toEqual(tools)
    expect(applyToolNamePolicy(tools, undefined)).toEqual(tools)
  })

  it('filters by allow list when present', () => {
    const tools = [{ name: 'get_pets' }, { name: 'create_pet' }, { name: 'delete_pet' }]
    expect(applyToolNamePolicy(tools, { allowList: ['get_pets', 'create_pet'] })).toEqual([
      { name: 'get_pets' },
      { name: 'create_pet' }
    ])
  })

  it('lets deny win over allow', () => {
    const tools = [{ name: 'get_pets' }, { name: 'create_pet' }]
    expect(
      applyToolNamePolicy(tools, {
        allowList: ['get_pets', 'create_pet'],
        denyList: ['create_pet']
      })
    ).toEqual([{ name: 'get_pets' }])
    expect(isToolNameDenied('create_pet', { denyList: ['create_pet'] })).toBe(true)
    expect(
      isToolNameAllowed('create_pet', { allowList: ['create_pet'], denyList: ['create_pet'] })
    ).toBe(false)
  })

  it('parses newline and comma separated tool names', () => {
    expect(parseToolNameListText('get_pets\ncreate_pet, delete_pet')).toEqual([
      'get_pets',
      'create_pet',
      'delete_pet'
    ])
    expect(formatToolNameListText(['get_pets', 'create_pet'])).toBe('get_pets\ncreate_pet')
  })
})
