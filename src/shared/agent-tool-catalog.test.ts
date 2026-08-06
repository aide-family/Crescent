import { describe, expect, it } from 'vitest'

import { BUILT_IN_TOOL_CATALOG } from './agent-tool-catalog'

describe('BUILT_IN_TOOL_CATALOG', () => {
  it('describes security-relevant metadata for every built-in tool', () => {
    expect(BUILT_IN_TOOL_CATALOG.length).toBeGreaterThan(0)

    for (const tool of BUILT_IN_TOOL_CATALOG) {
      expect(tool.source).toBe('built-in')
      expect(tool.risk).toMatch(/^(low|medium|high)$/)
      expect(typeof tool.requiresApproval).toBe('boolean')
      expect(typeof tool.external).toBe('boolean')
      expect(typeof tool.stateChanging).toBe('boolean')
    }
  })

  it('exposes Pi workspace tools', () => {
    expect(BUILT_IN_TOOL_CATALOG.map((tool) => tool.name).sort()).toEqual([
      'bash',
      'edit',
      'read',
      'write'
    ])
    const bash = BUILT_IN_TOOL_CATALOG.find((tool) => tool.name === 'bash')
    expect(bash?.risk).toBe('high')
    expect(bash?.stateChanging).toBe(true)
  })
})
