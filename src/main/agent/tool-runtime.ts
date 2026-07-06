import { AgentBrain } from './brain'
import { loadOpenApiToolRegistry } from './tool-registry'
import { OpenApiToolExecutor } from './tool-executor'
import type {
  AgentConfig,
  AgentEvent,
  OpenAiTool,
  TerminalCommandExecutor,
  ToolCatalogEntry
} from './types'

const TERMINAL_TOOL_NAME = 'execute_terminal_command'
const TERMINAL_COMMAND_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: TERMINAL_TOOL_NAME,
    description:
      'Execute a non-interactive shell command in the current visible terminal session, wait for completion, and return exit code plus output.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The exact shell command to execute in the current terminal environment. Use safe, non-interactive commands.'
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Defaults to 120000.'
        }
      },
      required: ['command']
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
  emit: (event: AgentEvent) => void
}

export class AgentToolRuntime {
  private readonly handlers = new Map<string, ToolHandler>()

  static async create(input: AgentToolRuntimeInput): Promise<AgentToolRuntime> {
    const runtime = new AgentToolRuntime()

    if (input.terminalExecutor) {
      runtime.registerTerminalTool(input.terminalExecutor, input.emit)
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
        emit({
          type: 'tool',
          name: TERMINAL_TOOL_NAME,
          message: `Running: ${args.command}`
        })

        const result = await terminalExecutor.executeCommand(args.command, args.timeoutMs)

        return {
          ...result,
          output: truncateToolOutput(result.output)
        }
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
