import { AgentBrain } from './brain'
import { validateGeneratedShellCommand } from './shell-command-validator'
import { loadOpenApiToolRegistry } from './tool-registry'
import { OpenApiToolExecutor } from './tool-executor'
import type {
  AgentConfig,
  AgentEvent,
  LocalFileWriter,
  OpenAiTool,
  SubterminalCommandExecutor,
  TerminalCommandExecutor,
  ToolCatalogEntry
} from './types'

const TERMINAL_TOOL_NAME = 'execute_terminal_command'
const SUBTERMINAL_TOOL_NAME = 'execute_subterminal_command'
const LOCAL_FILE_WRITE_TOOL_NAME = 'write_local_file'
const TERMINAL_COMMAND_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: TERMINAL_TOOL_NAME,
    description:
      'Execute one non-interactive shell command in the current visible terminal session, wait for completion, and return exit code plus output. Commands have a watchdog timeout and are interrupted with Ctrl+C when they exceed it. Use this for the single next step only, then inspect the result before deciding the next command. A single command may be a bounded compound shell loop/script when it performs one coherent read-only collection or reporting step.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The exact single shell command to execute in the current terminal environment. Use safe, non-interactive commands. Do not batch unrelated inspections or chain multiple decision-dependent checks into one command. Shell loops, pipelines, and semicolon-separated commands are acceptable when they form one coherent read-only collection/reporting step.'
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional timeout in milliseconds. Defaults to 120000 and is capped at 600000. Long-running or stuck commands are interrupted with Ctrl+C on timeout.'
        }
      },
      required: ['command']
    }
  }
}
const SUBTERMINAL_COMMAND_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: SUBTERMINAL_TOOL_NAME,
    description:
      'Execute a non-interactive shell command in a named temporary local-shell sub-terminal displayed under the current terminal. Commands have a watchdog timeout and are interrupted with Ctrl+C when they exceed it. Use this instead of the current terminal when the operation needs to leave the current terminal context, work on another host/cluster, or compare multiple targets while preserving the current terminal. A single command may be a bounded compound shell loop/script when it performs one coherent read-only collection or reporting step. For generated local files, use write_local_file instead of this tool. Choose a clear role-based terminalName. At most three named sub-terminals are available per current terminal; reuse terminalName values for related follow-up commands.',
    parameters: {
      type: 'object',
      properties: {
        terminalName: {
          type: 'string',
          description:
            'Short stable name for the temporary sub-terminal, such as host-a, cluster-b, or local. Reuse the same name for related commands.'
        },
        command: {
          type: 'string',
          description:
            'The exact single shell command to execute in the temporary sub-terminal. Use safe, non-interactive commands. Do not batch unrelated inspections or chain multiple decision-dependent checks into one command. Shell loops, pipelines, and semicolon-separated commands are acceptable when they form one coherent read-only collection/reporting step.'
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional timeout in milliseconds. Defaults to 120000 and is capped at 600000. Long-running or stuck commands are interrupted with Ctrl+C on timeout.'
        }
      },
      required: ['terminalName', 'command']
    }
  }
}
const LOCAL_FILE_WRITE_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: LOCAL_FILE_WRITE_TOOL_NAME,
    description:
      'Write generated local artifacts such as Markdown reports directly to the Crescent user machine. Use this for user-requested local files instead of shell heredocs, python heredocs, or temporary sub-terminal file writes. Preserve the exact user-requested destination path. Creates parent directories as needed and does not overwrite existing files unless overwrite is true.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path or ~/ path on the local Crescent machine where the artifact should be written.'
        },
        content: {
          type: 'string',
          description: 'Full file content to write. Do not omit sections that the user requested.'
        },
        overwrite: {
          type: 'boolean',
          description:
            'Set true only when the user explicitly asked to replace an existing local file. Defaults to false.'
        }
      },
      required: ['path', 'content']
    }
  }
}

interface ToolHandler {
  schema: OpenAiTool
  catalog?: ToolCatalogEntry
  execute: (rawArguments: string) => Promise<unknown>
}

export interface AgentToolRuntimeInput {
  config: AgentConfig
  brain: AgentBrain
  userInput: string
  terminalExecutor?: TerminalCommandExecutor
  subterminalExecutor?: SubterminalCommandExecutor
  localFileWriter?: LocalFileWriter
  emit: (event: AgentEvent) => void
}

export class AgentToolRuntime {
  private readonly handlers = new Map<string, ToolHandler>()

  static async create(input: AgentToolRuntimeInput): Promise<AgentToolRuntime> {
    const runtime = new AgentToolRuntime()

    if (input.terminalExecutor) {
      runtime.registerTerminalTool(input.terminalExecutor, input.emit)
    }
    if (input.subterminalExecutor) {
      runtime.registerSubterminalTool(input.subterminalExecutor, input.emit)
    }
    if (input.localFileWriter) {
      runtime.registerLocalFileWriteTool(input.localFileWriter, input.emit)
    }

    if (hasOpenApiConfig(input.config)) {
      await runtime.registerOpenApiTools(input)
    }

    return runtime
  }

  get tools(): OpenAiTool[] {
    return [...this.handlers.values()].map((handler) => handler.schema)
  }

  get catalog(): ToolCatalogEntry[] {
    return [...this.handlers.values()]
      .map((handler) => handler.catalog)
      .filter((entry): entry is ToolCatalogEntry => Boolean(entry))
  }

  hasTools(): boolean {
    return this.handlers.size > 0
  }

  async execute(toolName: string, rawArguments: string): Promise<unknown> {
    const handler = this.handlers.get(toolName)

    if (!handler) return { ok: false, error: `Unknown tool ${toolName}` }
    return handler.execute(rawArguments)
  }

  private registerTerminalTool(
    terminalExecutor: TerminalCommandExecutor,
    emit: (event: AgentEvent) => void
  ): void {
    this.handlers.set(TERMINAL_TOOL_NAME, {
      schema: TERMINAL_COMMAND_TOOL,
      catalog: {
        name: TERMINAL_TOOL_NAME,
        method: 'post',
        path: 'terminal://current-session',
        description: TERMINAL_COMMAND_TOOL.function.description ?? ''
      },
      execute: async (rawArguments) => {
        const args = parseTerminalCommandArgs(rawArguments)
        const validation = validateGeneratedShellCommand(args.command)

        if (!validation.ok) {
          return {
            ok: false,
            command: args.command,
            output: '',
            error: validation.error
          }
        }

        emit({
          type: 'tool',
          name: TERMINAL_TOOL_NAME,
          message: `Submitting command for review: ${args.command}`
        })

        const result = await terminalExecutor.executeCommand(args.command, args.timeoutMs)

        return {
          ...result,
          output: truncateToolOutput(result.output)
        }
      }
    })
  }

  private registerSubterminalTool(
    subterminalExecutor: SubterminalCommandExecutor,
    emit: (event: AgentEvent) => void
  ): void {
    this.handlers.set(SUBTERMINAL_TOOL_NAME, {
      schema: SUBTERMINAL_COMMAND_TOOL,
      catalog: {
        name: SUBTERMINAL_TOOL_NAME,
        method: 'post',
        path: 'terminal://temporary-subterminal',
        description: SUBTERMINAL_COMMAND_TOOL.function.description ?? ''
      },
      execute: async (rawArguments) => {
        const args = parseSubterminalCommandArgs(rawArguments)
        const validation = validateGeneratedShellCommand(args.command)

        if (!validation.ok) {
          return {
            ok: false,
            command: args.command,
            subterminalName: args.terminalName,
            output: '',
            error: validation.error
          }
        }

        emit({
          type: 'tool',
          name: SUBTERMINAL_TOOL_NAME,
          message: `Submitting command in temporary sub-terminal "${args.terminalName}": ${args.command}`
        })

        const result = await subterminalExecutor.executeCommand(args.command, {
          terminalName: args.terminalName,
          timeoutMs: args.timeoutMs
        })

        return {
          ...result,
          output: truncateToolOutput(result.output)
        }
      }
    })
  }

  private registerLocalFileWriteTool(
    localFileWriter: LocalFileWriter,
    emit: (event: AgentEvent) => void
  ): void {
    this.handlers.set(LOCAL_FILE_WRITE_TOOL_NAME, {
      schema: LOCAL_FILE_WRITE_TOOL,
      catalog: {
        name: LOCAL_FILE_WRITE_TOOL_NAME,
        method: 'post',
        path: 'file://local-artifact',
        description: LOCAL_FILE_WRITE_TOOL.function.description ?? ''
      },
      execute: async (rawArguments) => {
        const args = parseLocalFileWriteArgs(rawArguments)
        emit({
          type: 'tool',
          name: LOCAL_FILE_WRITE_TOOL_NAME,
          message: `Writing local artifact: ${args.path}`
        })

        return localFileWriter.writeFile(args.path, args.content, {
          overwrite: args.overwrite,
          encoding: 'utf-8'
        })
      }
    })
  }

  private async registerOpenApiTools(input: AgentToolRuntimeInput): Promise<void> {
    const registry = await loadOpenApiToolRegistry(input.config)
    const executor = new OpenApiToolExecutor(input.config, registry.operations)

    input.emit({ type: 'status', message: `Loaded ${registry.tools.length} OpenAPI tools.` })

    const selectedToolNames = await input.brain.selectRelevantTools({
      userInput: input.userInput,
      catalog: registry.catalog,
      maxTools: Math.max(1, input.config.maxActiveTools)
    })
    const selected = new Set(selectedToolNames)
    const activeTools = registry.tools.filter((tool) => selected.has(tool.function.name))
    const selectedTools = activeTools.length > 0 ? activeTools : registry.tools.slice(0, 5)

    for (const schema of selectedTools) {
      const operation = registry.operations.get(schema.function.name)

      this.handlers.set(schema.function.name, {
        schema,
        catalog: {
          name: schema.function.name,
          method: operation?.method ?? 'get',
          path: operation?.path ?? '',
          description: schema.function.description ?? ''
        },
        execute: (rawArguments) => executor.execute(schema.function.name, rawArguments)
      })
    }
  }
}

function parseTerminalCommandArgs(rawArguments: string): { command: string; timeoutMs?: number } {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown

    if (!isRecord(parsed)) return { command: '' }

    const timeoutMs = Number(parsed.timeoutMs)

    return {
      command: typeof parsed.command === 'string' ? parsed.command.trim() : '',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined
    }
  } catch {
    return { command: '' }
  }
}

function parseSubterminalCommandArgs(rawArguments: string): {
  terminalName: string
  command: string
  timeoutMs?: number
} {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown

    if (!isRecord(parsed)) return { terminalName: 'temporary', command: '' }

    const timeoutMs = Number(parsed.timeoutMs)

    return {
      terminalName:
        typeof parsed.terminalName === 'string' && parsed.terminalName.trim()
          ? parsed.terminalName.trim()
          : 'temporary',
      command: typeof parsed.command === 'string' ? parsed.command.trim() : '',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined
    }
  } catch {
    return { terminalName: 'temporary', command: '' }
  }
}

function parseLocalFileWriteArgs(rawArguments: string): {
  path: string
  content: string
  overwrite: boolean
} {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown

    if (!isRecord(parsed)) return { path: '', content: '', overwrite: false }

    return {
      path: typeof parsed.path === 'string' ? parsed.path.trim() : '',
      content: typeof parsed.content === 'string' ? parsed.content : '',
      overwrite: parsed.overwrite === true
    }
  } catch {
    return { path: '', content: '', overwrite: false }
  }
}

function truncateToolOutput(output: string): string {
  const maxLength = 16_000

  if (output.length <= maxLength) return output
  return `${output.slice(0, maxLength)}\n...[output truncated]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOpenApiConfig(config: AgentConfig): boolean {
  return Boolean(config.openApiBaseUrl.trim() && config.openApiDocument.trim())
}
