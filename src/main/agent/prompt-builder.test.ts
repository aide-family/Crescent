import { describe, expect, it } from 'vitest'

import { AgentPromptBuilder } from './prompt-builder'

describe('AgentPromptBuilder', () => {
  it('assembles stable, context, and volatile prompt tiers', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'plan-execute',
      memoryBlock: 'User preferences:\n- concise',
      instructionContext: '## USER.md\nUse concise responses.',
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

  it('guides tool runs toward stepwise closed-loop completion', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'react',
      memoryBlock: '',
      terminalContext: ''
    })

    expect(prompt).toContain('closed-loop operator')
    expect(prompt).toContain('Decompose user tasks into explicit steps')
    expect(prompt).toContain('run one shell command per tool call')
    expect(prompt).toContain('bounded script or loop')
    expect(prompt).toContain('uniform collection across a known target set')
    expect(prompt).toContain('Prefer several small, sequential commands')
    expect(prompt).toContain('For install, deploy, configure, repair, or migration requests')
    expect(prompt).toContain('Do not present prerequisites, discovery, or a proposed next command')
    expect(prompt).toContain('keep prerequisite discovery bounded')
    expect(prompt).toContain('interactive prompt as the current blocker')
    expect(prompt).toContain('Do not use sudo -n')
    expect(prompt).toContain(
      'After a terminal command returns enough evidence for the current step'
    )
    expect(prompt).toContain('Never include raw tool-call syntax')
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
    expect(prompt).toContain('never choose a default output path yourself')
    expect(prompt).toContain('ask the user to confirm the local Crescent-machine directory')
    expect(prompt).toContain('use write_local_file')
    expect(prompt).toContain('do not send large file content through shell heredocs')
    expect(prompt).toContain('Preserve user-specified destinations')
    expect(prompt).toContain('Do not replace them with convenient temporary paths')
    expect(prompt).toContain('invented credentials')
  })

  it('uses recent conversation context as the source for requests about previous output', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'react',
      memoryBlock: '',
      conversationContext: '[Assistant] Previous architecture report',
      terminalContext: ''
    })

    expect(prompt).toContain('Recent conversation context')
    expect(prompt).toContain('Previous architecture report')
    expect(prompt).toContain('use the Recent conversation context as the source of truth')
    expect(prompt).toContain('preserve this prior assistant content')
    expect(prompt).toContain('instead of redoing the investigation')
  })

  it('does not advertise terminal commands when terminal tools are disabled', () => {
    const prompt = new AgentPromptBuilder().buildToolLoopPrompt({
      mode: 'react',
      memoryBlock: '',
      terminalContext: '',
      terminalToolsEnabled: false
    })

    expect(prompt).toContain('Terminal tools are not available for this run')
    expect(prompt).toContain('Use the available non-terminal tools')
    expect(prompt).not.toContain('call execute_terminal_command')
    expect(prompt).not.toContain('run one shell command per tool call')
  })
})
