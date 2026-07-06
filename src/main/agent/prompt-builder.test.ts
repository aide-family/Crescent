import { describe, expect, it } from 'vitest'

import { AgentPromptBuilder } from './prompt-builder'

describe('AgentPromptBuilder', () => {
  it('assembles stable, context, and volatile prompt tiers', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'plan-execute',
      memoryBlock: 'User preferences:\n- concise',
      terminalContext: 'cwd: /repo',
      planSteps: ['Inspect state', 'Run verification']
    })

    expect(prompt).toContain('You are Crescent')
    expect(prompt).toContain('Mode: Plan-and-Execute')
    expect(prompt).toContain('Long-term memory')
    expect(prompt).toContain('Recent terminal context')
    expect(prompt).toContain('1. Inspect state')
  })
})
