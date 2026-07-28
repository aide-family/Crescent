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

  it('marks command execution tools as high-risk and state-changing', () => {
    const commandTools = BUILT_IN_TOOL_CATALOG.filter((tool) =>
      tool.name.includes('terminal_command')
    )

    expect(commandTools.map((tool) => tool.name)).toEqual([
      'execute_terminal_command',
      'execute_subterminal_command'
    ])
    for (const tool of commandTools) {
      expect(tool.risk).toBe('high')
      expect(tool.requiresApproval).toBe(true)
      expect(tool.stateChanging).toBe(true)
    }
  })
})
