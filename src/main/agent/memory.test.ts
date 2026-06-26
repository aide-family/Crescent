import { describe, expect, it } from 'vitest'

import { AgentMemory, type AgentMemoryState } from './memory'

describe('AgentMemory', () => {
  it('persists short-term turns and long-term notes', () => {
    const state: AgentMemoryState = {
      shortTerm: [],
      longTerm: {
        preferences: [],
        notes: []
      }
    }
    let persisted: AgentMemoryState | undefined
    const memory = new AgentMemory(state, (next) => {
      persisted = next
    })

    memory.rememberTurn('hello', 'world')
    memory.addLongTermNote('prefer concise answers')

    expect(persisted?.shortTerm).toHaveLength(2)
    expect(persisted?.longTerm.notes).toContain('prefer concise answers')
    expect(memory.getShortTermMessages()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' }
    ])
  })
})
