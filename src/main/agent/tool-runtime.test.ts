import { describe, expect, it, vi } from 'vitest'

import { AgentToolRuntime } from './tool-runtime'
import type {
  AgentConfig,
  AgentEvent,
  TerminalCommandExecutor,
  TerminalCommandResult
} from './types'
import type { AgentBrain } from './brain'

const config: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: '',
  openApiDocument: ''
}

describe('AgentToolRuntime', () => {
  it('registers and dispatches the current terminal tool', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const commandResult: TerminalCommandResult = {
      ok: true,
      command: 'pwd',
      mode: 'pty',
      cwd: '/tmp',
      exitCode: 0,
      output: 'ok'
    }
    const terminalExecutor: TerminalCommandExecutor = {
      executeCommand: vi.fn(async (command: string) => ({ ...commandResult, command }))
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'check status',
      terminalExecutor,
      emit
    })
    const result = await runtime.execute(
      'execute_terminal_command',
      JSON.stringify({ command: 'pwd' })
    )

    expect(runtime.hasTools()).toBe(true)
    expect(runtime.tools.map((tool) => tool.function.name)).toEqual(['execute_terminal_command'])
    expect(terminalExecutor.executeCommand).toHaveBeenCalledWith('pwd', undefined)
    expect(result).toMatchObject({ ok: true, command: 'pwd', output: 'ok' })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool', name: 'execute_terminal_command' })
    )
  })
})
