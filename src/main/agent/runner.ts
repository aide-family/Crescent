import { TerminalAgentCore } from './core'
import type { AgentConfig, AgentEvent, TerminalCommandExecutor } from './types'
import type { AgentMemory } from './memory'

export async function runTerminalAgent(
  config: AgentConfig,
  userInput: string,
  memory: AgentMemory,
  terminalContext: string,
  emit: (event: AgentEvent) => void,
  terminalExecutor?: TerminalCommandExecutor
): Promise<string> {
  return new TerminalAgentCore(config, memory, emit, terminalExecutor).run(
    userInput,
    terminalContext
  )
}
