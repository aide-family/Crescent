import { TerminalAgentCore } from './core'
import type { AgentConfig, AgentEvent, TerminalCommandExecutor } from './types'
import type { AgentMemory } from './memory'

export interface AgentRunControls {
  signal?: AbortSignal
  instructionContext?: string
  skillContext?: string
  consumeSupplementalInputs?: () => string[]
}

export async function runTerminalAgent(
  config: AgentConfig,
  userInput: string,
  memory: AgentMemory,
  terminalContext: string,
  emit: (event: AgentEvent) => void,
  terminalExecutor?: TerminalCommandExecutor,
  controls?: AgentRunControls
): Promise<string> {
  return new TerminalAgentCore(config, memory, emit, terminalExecutor, controls).run(
    userInput,
    terminalContext
  )
}
