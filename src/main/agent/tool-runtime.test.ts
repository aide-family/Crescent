import { describe, expect, it, vi } from 'vitest'

import { AgentToolRuntime } from './tool-runtime'
import { getDefaultAgentProviders } from './openclaw-config'
import type {
  AgentConfig,
  AgentEvent,
  LocalFileWriter,
  SubterminalCommandExecutor,
  TerminalCommandExecutor,
  TerminalCommandResult
} from './types'
import type { AgentBrain } from './brain'

const config: AgentConfig = {
  providers: getDefaultAgentProviders(),
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
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
    expect(runtime.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['execute_terminal_command', 'parse_pdf_file', 'parse_docx_file'])
    )
    expect(runtime.tools[0]?.function.description).toContain('Execute one non-interactive')
    expect(runtime.tools[0]?.function.parameters).toMatchObject({
      properties: {
        command: {
          description: expect.stringContaining('single shell command')
        }
      }
    })
    expect(terminalExecutor.executeCommand).toHaveBeenCalledWith('pwd', undefined)
    expect(result).toMatchObject({ ok: true, command: 'pwd', output: 'ok' })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool', name: 'execute_terminal_command' })
    )
  })

  it('rejects incomplete shell syntax before terminal execution', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const terminalExecutor: TerminalCommandExecutor = {
      executeCommand: vi.fn()
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'collect inventory',
      terminalExecutor,
      emit
    })
    const result = await runtime.execute(
      'execute_terminal_command',
      JSON.stringify({ command: '&&' })
    )

    expect(terminalExecutor.executeCommand).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      command: '&&',
      error: expect.stringContaining('incomplete shell syntax')
    })
  })

  it('registers and dispatches the temporary sub-terminal tool', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const commandResult: TerminalCommandResult = {
      ok: true,
      command: 'pwd',
      mode: 'pty',
      cwd: '/tmp',
      exitCode: 0,
      output: 'ok',
      subterminalName: 'local'
    }
    const terminalExecutor: TerminalCommandExecutor = {
      executeCommand: vi.fn(async (command: string) => ({ ...commandResult, command }))
    }
    const subterminalExecutor: SubterminalCommandExecutor = {
      executeCommand: vi.fn(async (command: string, options) => ({
        ...commandResult,
        command,
        subterminalName: options.terminalName
      }))
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'save report locally',
      terminalExecutor,
      subterminalExecutor,
      emit
    })
    const result = await runtime.execute(
      'execute_subterminal_command',
      JSON.stringify({ terminalName: 'local', command: 'pwd' })
    )

    expect(runtime.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['execute_terminal_command', 'execute_subterminal_command'])
    )
    expect(subterminalExecutor.executeCommand).toHaveBeenCalledWith('pwd', {
      terminalName: 'local',
      timeoutMs: undefined
    })
    expect(result).toMatchObject({ ok: true, command: 'pwd', output: 'ok' })
  })

  it('registers and dispatches the local file writer tool', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const localFileWriter: LocalFileWriter = {
      writeFile: vi.fn(async (path: string, content: string, options) => ({
        ok: true,
        path,
        bytes: Buffer.byteLength(content, 'utf-8'),
        overwritten: options?.overwrite === true
      }))
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'write report to ~/Documents/work',
      localFileWriter,
      emit
    })
    const result = await runtime.execute(
      'write_local_file',
      JSON.stringify({
        path: '~/Documents/work/report.md',
        content: '# Report\n\nok',
        overwrite: false
      })
    )

    expect(runtime.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['write_local_file', 'parse_markdown_file'])
    )
    expect(localFileWriter.writeFile).toHaveBeenCalledWith(
      '~/Documents/work/report.md',
      '# Report\n\nok',
      { overwrite: false, encoding: 'utf-8' }
    )
    expect(result).toMatchObject({
      ok: true,
      path: '~/Documents/work/report.md',
      bytes: 12,
      overwritten: false
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool', name: 'write_local_file' })
    )
  })

  it('registers the local wiki save tool for conversation-driven knowledge capture', async () => {
    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: '把这个巡检过程保存到知识库',
      emit: vi.fn<(event: AgentEvent) => void>()
    })
    const wikiTool = runtime.tools.find((tool) => tool.function.name === 'save_wiki_document')

    expect(wikiTool?.function.description).toContain('Crescent local knowledge base')
    expect(wikiTool?.function.parameters).toMatchObject({
      required: ['title', 'content'],
      properties: {
        title: {
          description: expect.stringContaining('Knowledge-base document title')
        },
        content: {
          description: expect.stringContaining('Full Markdown content')
        }
      }
    })
    expect(runtime.catalog.map((tool) => tool.name)).toContain('save_wiki_document')
  })
})
