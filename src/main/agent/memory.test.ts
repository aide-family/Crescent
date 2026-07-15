import { describe, expect, it } from 'vitest'

import { AgentMemory, type AgentMemoryState } from './memory'

describe('AgentMemory', () => {
  it('persists short-term turns and long-term notes', () => {
    const state: AgentMemoryState = {
      shortTerm: [],
      longTerm: {
        preferences: [],
        notes: [],
        operations: []
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

  it('can isolate agent runs from cross-session short-term and operation context', () => {
    const state: AgentMemoryState = {
      shortTerm: [
        { role: 'user', content: 'old cluster context', createdAt: '2026-01-01T00:00:00Z' }
      ],
      longTerm: {
        preferences: ['reply in Chinese'],
        notes: [],
        operations: [
          {
            id: 'op-1',
            createdAt: '2026-01-01T00:00:00Z',
            status: 'success',
            summary: 'checked zhangke Elasticsearch'
          }
        ]
      }
    }
    let persisted: AgentMemoryState | undefined
    const memory = new AgentMemory(
      state,
      (next) => {
        persisted = next
      },
      {
        includeShortTerm: false,
        includeOperations: false,
        persistShortTerm: false
      }
    )

    expect(memory.getShortTermMessages()).toEqual([])
    expect(memory.getPromptBlock()).toContain('reply in Chinese')
    expect(memory.getPromptBlock()).not.toContain('zhangke Elasticsearch')

    memory.rememberTurn('new request', 'new answer')
    expect(persisted).toBeUndefined()
  })
})
