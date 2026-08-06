import { describe, expect, it, vi } from 'vitest'

import { AgentToolRuntime } from './tool-runtime'
import type { ExternalToolApprover } from './external-tool-approval'
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
  providers: [
    {
      id: 'test-provider',
      name: 'Test Provider',
      baseUrl: 'https://model.example.test/v1',
      apiKey: '',
      models: [{ id: 'test-model', name: 'test-model' }]
    }
  ],
  providerId: 'test-provider',
  model: 'test-model',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiProfiles: [],
  openApiProfileId: undefined,
  openApiBaseUrl: '',
  openApiDocument: '',
  openApiTimeoutMs: 30_000,
  openApiMaxRetries: 2,
  openApiRetryBackoffMs: 300,
  skillRoot: '~/.agents/skills',
  mcpServers: []
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
    expect(runtime.tools[0]?.function.description).toContain('Execute one shell command')
    expect(runtime.tools[0]?.function.description).toContain(
      'use ssh with a concrete remote command'
    )
    expect(runtime.tools[0]?.function.parameters).toMatchObject({
      properties: {
        command: {
          description: expect.stringContaining('For another host without a peer terminal, use ssh')
        },
        targetTerminalId: {
          description: expect.stringContaining('peer or docked sub-terminal')
        }
      }
    })
    expect(terminalExecutor.executeCommand).toHaveBeenCalledWith('pwd', {
      timeoutMs: undefined,
      targetTerminalId: undefined
    })
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

  it('dispatches ssh commands to the terminal executor', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const commandResult: TerminalCommandResult = {
      ok: true,
      command: "ssh 10.42.131.142 'df -hT /home'",
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
      userInput: 'handle disk alert on 10.42.131.142',
      terminalExecutor,
      emit
    })
    const result = await runtime.execute(
      'execute_terminal_command',
      JSON.stringify({ command: "ssh 10.42.131.142 'df -hT /home'" })
    )

    expect(terminalExecutor.executeCommand).toHaveBeenCalledWith(
      "ssh 10.42.131.142 'df -hT /home'",
      {
        timeoutMs: undefined,
        targetTerminalId: undefined
      }
    )
    expect(result).toMatchObject({
      ok: true,
      command: "ssh 10.42.131.142 'df -hT /home'",
      output: 'ok'
    })
  })

  it('passes targetTerminalId to the terminal executor', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const terminalExecutor: TerminalCommandExecutor = {
      executeCommand: vi.fn(async (command: string) => ({
        ok: true,
        command,
        mode: 'pty' as const,
        cwd: '/tmp',
        exitCode: 0,
        output: 'ok'
      }))
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'compare hosts',
      terminalExecutor,
      emit
    })
    await runtime.execute(
      'execute_terminal_command',
      JSON.stringify({ command: 'hostname', targetTerminalId: 'peer-tab' })
    )

    expect(terminalExecutor.executeCommand).toHaveBeenCalledWith('hostname', {
      timeoutMs: undefined,
      targetTerminalId: 'peer-tab'
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
      timeoutMs: undefined,
      mode: 'wait'
    })
    expect(result).toMatchObject({ ok: true, command: 'pwd', output: 'ok' })
  })

  it('dispatches detached sub-terminal commands without waiting', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const subterminalExecutor: SubterminalCommandExecutor = {
      executeCommand: vi.fn(async (command: string, options) => ({
        ok: true,
        command,
        mode: 'pty',
        cwd: '/tmp',
        output: '',
        detached: true,
        subterminalName: options.terminalName,
        subterminalTabId: 'parent::subterminal::watch'
      })),
      readOutput: vi.fn(async (options) => ({
        ok: true,
        name: options.terminalName,
        tabId: 'parent::subterminal::watch',
        mode: 'pty' as const,
        cwd: '/tmp',
        shell: '/bin/zsh',
        output: 'top output',
        busy: false,
        detached: true
      })),
      interrupt: vi.fn(async (options) => ({
        ok: true,
        name: options.terminalName,
        tabId: 'parent::subterminal::watch'
      }))
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'watch cpu with top',
      terminalExecutor: { executeCommand: vi.fn() },
      subterminalExecutor,
      emit
    })

    const detachResult = await runtime.execute(
      'execute_subterminal_command',
      JSON.stringify({ terminalName: 'watch', command: 'top', mode: 'detach' })
    )
    expect(subterminalExecutor.executeCommand).toHaveBeenCalledWith('top', {
      terminalName: 'watch',
      timeoutMs: undefined,
      mode: 'detach'
    })
    expect(detachResult).toMatchObject({
      ok: true,
      detached: true,
      subterminalName: 'watch',
      output: ''
    })

    const readResult = await runtime.execute(
      'read_subterminal_output',
      JSON.stringify({ terminalName: 'watch' })
    )
    expect(subterminalExecutor.readOutput).toHaveBeenCalledWith({
      terminalName: 'watch',
      maxChars: undefined
    })
    expect(readResult).toMatchObject({ ok: true, output: 'top output', detached: true })

    const interruptResult = await runtime.execute(
      'interrupt_subterminal',
      JSON.stringify({ terminalName: 'watch' })
    )
    expect(subterminalExecutor.interrupt).toHaveBeenCalledWith({ terminalName: 'watch' })
    expect(interruptResult).toMatchObject({ ok: true, name: 'watch' })

    expect(runtime.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining([
        'execute_subterminal_command',
        'read_subterminal_output',
        'interrupt_subterminal'
      ])
    )
  })

  it('dispatches ssh commands to the temporary sub-terminal executor', async () => {
    const emit = vi.fn<(event: AgentEvent) => void>()
    const terminalExecutor: TerminalCommandExecutor = {
      executeCommand: vi.fn()
    }
    const commandResult: TerminalCommandResult = {
      ok: true,
      command: "ssh 10.42.131.142 'df -hT /home'",
      mode: 'pty',
      cwd: '/tmp',
      exitCode: 0,
      output: 'ok',
      subterminalName: 'target'
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
      userInput: 'handle disk alert on 10.42.131.142',
      terminalExecutor,
      subterminalExecutor,
      emit
    })
    const result = await runtime.execute(
      'execute_subterminal_command',
      JSON.stringify({ terminalName: 'target', command: "ssh 10.42.131.142 'df -hT /home'" })
    )

    expect(subterminalExecutor.executeCommand).toHaveBeenCalledWith(
      "ssh 10.42.131.142 'df -hT /home'",
      {
        terminalName: 'target',
        timeoutMs: undefined,
        mode: 'wait'
      }
    )
    expect(result).toMatchObject({
      ok: true,
      command: "ssh 10.42.131.142 'df -hT /home'",
      subterminalName: 'target',
      output: 'ok'
    })
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

  it('rejects report writes when the user has not confirmed a local destination', async () => {
    const localFileWriter: LocalFileWriter = {
      writeFile: vi.fn()
    }

    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'inspect the cluster and write an inspection report',
      localFileWriter,
      emit: vi.fn<(event: AgentEvent) => void>()
    })
    const result = await runtime.execute(
      'write_local_file',
      JSON.stringify({
        path: '~/inspection-report.md',
        content: '# Report\n\nok',
        overwrite: false
      })
    )

    expect(result).toMatchObject({
      ok: false,
      path: '~/inspection-report.md'
    })
    expect(localFileWriter.writeFile).not.toHaveBeenCalled()
  })

  it('registers the local wiki save tool for conversation-driven knowledge capture', async () => {
    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'Save this inspection process to the knowledge base',
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

  it('blocks OpenAPI/MCP tools until approveTool allows them', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const approveTool = vi.fn<ExternalToolApprover>(async () => ({
      approved: false,
      rejectionReason: 'too risky'
    }))
    const runtime = await AgentToolRuntime.create({
      config,
      brain: {} as AgentBrain,
      userInput: 'create an order',
      approveTool,
      emit: vi.fn<(event: AgentEvent) => void>()
    })

    ;(
      runtime as unknown as {
        handlers: Map<
          string,
          {
            schema: { type: 'function'; function: { name: string } }
            catalog: {
              name: string
              method: 'post'
              path: string
              description: string
              source: 'openapi'
              risk: 'high'
              requiresApproval: true
              external: true
              stateChanging: true
            }
            execute: typeof execute
          }
        >
      }
    ).handlers.set('create_order', {
      schema: {
        type: 'function',
        function: { name: 'create_order' }
      },
      catalog: {
        name: 'create_order',
        method: 'post',
        path: '/orders',
        description: 'Create order',
        source: 'openapi',
        risk: 'high',
        requiresApproval: true,
        external: true,
        stateChanging: true
      },
      execute
    })

    const rejected = await runtime.execute('create_order', JSON.stringify({ body: { sku: 'a' } }))
    expect(approveTool).toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(rejected).toMatchObject({
      ok: false,
      error: expect.stringContaining('rejected by the user')
    })

    approveTool.mockResolvedValueOnce({ approved: true })
    const approved = await runtime.execute('create_order', JSON.stringify({ body: { sku: 'a' } }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(approved).toEqual({ ok: true })
  })
})
