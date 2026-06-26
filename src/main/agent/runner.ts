import { TerminalAgentCore } from './core'
import type { AgentConfig, AgentEvent } from './types'
import type { AgentMemory } from './memory'

export async function runTerminalAgent(
  config: AgentConfig,
  userInput: string,
  memory: AgentMemory,
  emit: (event: AgentEvent) => void
): Promise<string> {
  return new TerminalAgentCore(config, memory, emit).run(userInput)
}
