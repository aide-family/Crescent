export interface AgentPromptInput {
  mode: string
  memoryBlock: string
  instructionContext?: string
  skillContext?: string
  terminalContext: string
  planSteps?: string[]
}

export class AgentPromptBuilder {
  buildChatOnlyPrompt(input: AgentPromptInput): string {
    return [this.buildStableBlock(), this.buildContextBlock(input), this.buildVolatileBlock(input)]
      .filter(Boolean)
      .join('\n\n')
  }

  buildToolLoopPrompt(input: AgentPromptInput): string {
    return [
      this.buildStableBlock(),
      this.buildToolGuidanceBlock(input.mode),
      this.buildContextBlock(input),
      this.buildVolatileBlock(input)
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  private buildStableBlock(): string {
    return [
      'You are Crescent, an AI assistant embedded beside an interactive terminal.',
      'Help with Linux, SSH, shell commands, debugging, and operations work.',
      'Always reply in the same natural language as the user’s latest request. If the user writes Chinese, reply in Chinese; if the user writes English, reply in English.',
      'Keep final output concise and terminal-friendly.'
    ].join('\n')
  }

  private buildToolGuidanceBlock(mode: string): string {
    return [
      mode === 'plan-execute'
        ? 'Mode: Plan-and-Execute. Follow the plan, execute with tools, and adapt if an observation invalidates a step.'
        : 'Mode: ReAct. Alternate reasoning and tool use until you can give a final answer.',
      'When terminal execution is needed, call execute_terminal_command. It runs in the current visible terminal session and returns the real output before you continue.',
      'If the user starts with /command or /cmd, treat it as a terminal execution request and use execute_terminal_command as needed.',
      'Work as a closed-loop operator: identify the target, run the minimum useful checks, verify the outcome, then give a final result with evidence and next actions.',
      'Optimize for speed. Prefer one batched, read-only terminal command over many small commands. Do not repeat checks unless new output makes it necessary.',
      'After a terminal command returns enough evidence, stop calling tools and summarize. Only run one more command when a specific missing fact blocks a correct answer.',
      'For operations or health-check tasks, include what was checked, key abnormal findings, affected hosts or services, and recommended next step.',
      'Do not use terminal commands to read Crescent local skill files such as SKILL.md; loaded skill content is provided in the Agent skills context.',
      'Avoid interactive or destructive commands unless the user explicitly asked for them.',
      'Use OpenAPI tools only when useful. Explain API or command failures clearly.'
    ].join('\n')
  }

  private buildContextBlock(input: AgentPromptInput): string {
    return [
      `Long-term memory:\n${input.memoryBlock}`,
      input.instructionContext ? `Local instruction files:\n${input.instructionContext}` : '',
      input.skillContext ? `Agent skills:\n${input.skillContext}` : '',
      input.terminalContext
        ? `Recent terminal context, use it to answer accurately but do not claim you executed new commands:\n${input.terminalContext}`
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  private buildVolatileBlock(input: AgentPromptInput): string {
    return input.planSteps?.length
      ? `Execution plan:\n${input.planSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
      : ''
  }
}
