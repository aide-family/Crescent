import { describe, expect, it } from 'vitest'

import { AgentPromptBuilder } from './prompt-builder'

describe('AgentPromptBuilder', () => {
  it('assembles stable, context, and volatile prompt tiers', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'plan-execute',
      memoryBlock: 'User preferences:\n- concise',
      instructionContext: '## USER.md\nUse Chinese for Chinese requests.',
      terminalContext: 'cwd: /repo',
      planSteps: ['Inspect state', 'Run verification']
    })

    expect(prompt).toContain('You are Crescent')
    expect(prompt).toContain('Always reply in the same natural language')
    expect(prompt).toContain('Mode: Plan-and-Execute')
    expect(prompt).toContain('Long-term memory')
    expect(prompt).toContain('Local instruction files')
    expect(prompt).toContain('Recent terminal context')
    expect(prompt).toContain('1. Inspect state')
  })

  it('guides tool runs toward fast closed-loop completion', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'react',
      memoryBlock: '',
      terminalContext: ''
    })

    expect(prompt).toContain('closed-loop operator')
    expect(prompt).toContain('Prefer one batched, read-only terminal command')
    expect(prompt).toContain('After a terminal command returns enough evidence')
    expect(prompt).toContain('Do not use terminal commands to read Crescent local skill files')
  })

  it('separates target execution context from artifact destination context', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'react',
      memoryBlock: '',
      terminalContext: ''
    })

    expect(prompt).toContain('Interpret execution context and artifact destination separately')
    expect(prompt).toContain('destination context the user requested')
    expect(prompt).toContain('use write_local_file')
    expect(prompt).toContain('do not send large file content through shell heredocs')
    expect(prompt).toContain('Preserve user-specified destinations')
    expect(prompt).toContain('Do not replace them with convenient temporary paths')
    expect(prompt).toContain('invented credentials')
  })
})
