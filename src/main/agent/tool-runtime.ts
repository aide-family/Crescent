import { AgentBrain } from './brain'
import { validateGeneratedShellCommand } from './shell-command-validator'
import { loadOpenApiToolRegistry } from './tool-registry'
import { OpenApiToolExecutor } from './tool-executor'
import { DOCUMENT_PARSE_TOOLS, executeDocumentParseTool } from './document-tools'
import { executeMcpTool, loadMcpToolRegistry } from './mcp-runtime'
import { saveWikiDocument } from './wiki'
import { findBuiltInToolCatalogEntry } from '../../shared/agent-tool-catalog'
import {
  shouldRequireExternalToolApproval,
  type ExternalToolApprover
} from './external-tool-approval'
import type {
  AgentConfig,
  AgentEvent,
  HttpMethod,
  LocalFileWriter,
  OpenAiTool,
  SubterminalCommandExecutor,
  TerminalCommandExecutor,
  ToolCatalogEntry
} from './types'

const TERMINAL_TOOL_NAME = 'execute_terminal_command'
const SUBTERMINAL_TOOL_NAME = 'execute_subterminal_command'
const READ_SUBTERMINAL_TOOL_NAME = 'read_subterminal_output'
const INTERRUPT_SUBTERMINAL_TOOL_NAME = 'interrupt_subterminal'
const LOCAL_FILE_WRITE_TOOL_NAME = 'write_local_file'
const SAVE_WIKI_DOCUMENT_TOOL_NAME = 'save_wiki_document'
const TERMINAL_COMMAND_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: TERMINAL_TOOL_NAME,
    description:
      'Execute one shell command in a terminal that belongs to the current Crescent chat session, wait for completion, and return exit code plus output. Default target is the current/focused terminal. When session terminal inventory lists peer terminals or docked sub-terminals, pass targetTerminalId to run on a specific peer in the same session. Do not invent terminal ids outside that inventory. For one-shot remote commands that should not use an interactive peer PTY, use ssh with a concrete remote command (preferably via execute_subterminal_command). In PTY mode, password/passphrase/OTP prompts are surfaced to the user for input; in pipe fallback mode interactive prompts cannot be handled safely. Wait-mode commands have watchdog timeouts and are interrupted with Ctrl+C when they exceed it. Use this for the single next step only, then inspect the result before deciding the next command.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The exact single shell command to execute in the selected terminal environment. For another host without a peer terminal, use ssh with the concrete remote command to run. Do not batch unrelated inspections or chain multiple decision-dependent checks into one command. Shell loops, pipelines, and semicolon-separated commands are acceptable when they form one coherent read-only collection/reporting step.'
        },
        targetTerminalId: {
          type: 'string',
          description:
            'Optional tabId of a peer or docked sub-terminal from the session terminal inventory. Omit to use the current/focused terminal. Must match an id listed for this chat session.'
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
      'Execute one shell command in a named docked sub-terminal displayed under the current terminal. The sub-terminal is a full interactive PTY (local shell by default; use ssh with a concrete remote command for another host). Prefer mode=wait for finite collection commands. Prefer mode=detach for continuous observation such as top, atop, or tail -f so the main terminal can keep verifying in parallel; then use read_subterminal_output to sample output and interrupt_subterminal to stop. Password/passphrase/OTP prompts are surfaced to the user. Wait-mode commands have a watchdog timeout and are interrupted with Ctrl+C when they exceed it. Choose a clear role-based terminalName. At most three named sub-terminals are available per current terminal; reuse terminalName values for related follow-up commands.',
    parameters: {
      type: 'object',
      properties: {
        terminalName: {
          type: 'string',
          description:
            'Short stable name for the docked sub-terminal, such as host-a, cluster-b, watch, or local. Reuse the same name for related commands.'
        },
        command: {
          type: 'string',
          description:
            'The exact single shell command to execute in the docked sub-terminal. For another host, use ssh with the concrete remote command to run. Do not batch unrelated inspections or chain multiple decision-dependent checks into one command. Shell loops, pipelines, and semicolon-separated commands are acceptable when they form one coherent read-only collection/reporting step.'
        },
        mode: {
          type: 'string',
          enum: ['wait', 'detach'],
          description:
            'wait (default) runs until completion with timeout. detach starts the command and returns immediately so continuous watchers like top/atop can keep running while the main terminal verifies other evidence.'
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional timeout in milliseconds for mode=wait. Defaults to 120000 and is capped at 600000. Ignored for mode=detach.'
        }
      },
      required: ['terminalName', 'command']
    }
  }
}
const READ_SUBTERMINAL_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: READ_SUBTERMINAL_TOOL_NAME,
    description:
      'Read recent scrollback from a named docked sub-terminal. Use after mode=detach continuous observation, or whenever you need the latest sub-terminal output without sending a new command.',
    parameters: {
      type: 'object',
      properties: {
        terminalName: {
          type: 'string',
          description:
            'Name of the docked sub-terminal previously used with execute_subterminal_command.'
        },
        maxChars: {
          type: 'number',
          description: 'Optional max characters of recent output to return. Defaults to 12000.'
        }
      },
      required: ['terminalName']
    }
  }
}
const INTERRUPT_SUBTERMINAL_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: INTERRUPT_SUBTERMINAL_TOOL_NAME,
    description:
      'Send Ctrl+C to a named docked sub-terminal to stop a detached watch command such as top/atop/tail -f.',
    parameters: {
      type: 'object',
      properties: {
        terminalName: {
          type: 'string',
          description: 'Name of the docked sub-terminal to interrupt.'
        }
      },
      required: ['terminalName']
    }
  }
}
const LOCAL_FILE_WRITE_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: LOCAL_FILE_WRITE_TOOL_NAME,
    description:
      'Write generated local artifacts such as Markdown reports directly to the Crescent user machine. Use this only after the user supplied or confirmed the local destination path. Use this for user-requested local files instead of shell heredocs, python heredocs, or temporary sub-terminal file writes. Preserve the exact user-requested destination path. Creates parent directories as needed and does not overwrite existing files unless overwrite is true.',
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
const SAVE_WIKI_DOCUMENT_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: SAVE_WIKI_DOCUMENT_TOOL_NAME,
    description:
      'Save a Markdown SOP or best-practice document into the Crescent local knowledge base. Use this when the user asks to save operations, inspections, troubleshooting steps, SOPs, or best practices to the knowledge base/wiki. The document is stored as a .md file next to the Crescent config files and becomes retrievable in later conversations.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Knowledge-base document title. Use a concise operational title, for example "aide K8s inspection SOP".'
        },
        content: {
          type: 'string',
          description:
            'Full Markdown content to save. Include purpose, scope, prerequisites, repeatable steps, verification, risks, rollback/escalation notes, and source evidence when available.'
        },
        id: {
          type: 'string',
          description:
            'Optional stable markdown filename or id. Omit unless updating a known existing wiki document.'
        }
      },
      required: ['title', 'content']
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
  approveTool?: ExternalToolApprover
  emit: (event: AgentEvent) => void
}

export class AgentToolRuntime {
  private readonly handlers = new Map<string, ToolHandler>()
  private approveTool?: ExternalToolApprover
  private userInput = ''

  static async create(input: AgentToolRuntimeInput): Promise<AgentToolRuntime> {
    const runtime = new AgentToolRuntime()
    runtime.approveTool = input.approveTool
    runtime.userInput = input.userInput

    if (input.terminalExecutor) {
      runtime.registerTerminalTool(input.terminalExecutor, input.emit)
    }
    if (input.subterminalExecutor) {
      runtime.registerSubterminalTool(input.subterminalExecutor, input.emit)
    }
    if (input.localFileWriter) {
      runtime.registerLocalFileWriteTool(input.localFileWriter, input.userInput, input.emit)
    }
    runtime.registerWikiTool(input.emit)
    runtime.registerDocumentParseTools(input.brain, input.emit)

    if (hasOpenApiConfig(input.config)) {
      await runtime.registerOpenApiTools(input)
    }
    if (hasMcpConfig(input.config)) {
      await runtime.registerMcpTools(input)
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

    if (shouldRequireExternalToolApproval(handler.catalog) && this.approveTool) {
      const decision = await this.approveTool({
        toolName,
        rawArguments,
        catalog: handler.catalog,
        userInput: this.userInput
      })

      if (!decision.approved) {
        const rejectionReason = (decision.rejectionReason || decision.note || '').trim()
        return {
          ok: false,
          error: [
            `Tool execution was rejected by the user. Continue from this result and do not assume ${toolName} ran.`,
            rejectionReason ? `User rejection reason: ${rejectionReason}` : ''
          ]
            .filter(Boolean)
            .join('\n')
        }
      }
    }

    return handler.execute(rawArguments)
  }

  private registerTerminalTool(
    terminalExecutor: TerminalCommandExecutor,
    emit: (event: AgentEvent) => void
  ): void {
    this.handlers.set(TERMINAL_TOOL_NAME, {
      schema: TERMINAL_COMMAND_TOOL,
      catalog: findBuiltInToolCatalogEntry(TERMINAL_TOOL_NAME),
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
          message: args.targetTerminalId
            ? `Submitting command for review on terminal ${args.targetTerminalId}: ${args.command}`
            : `Submitting command for review: ${args.command}`
        })

        const result = await terminalExecutor.executeCommand(args.command, {
          timeoutMs: args.timeoutMs,
          targetTerminalId: args.targetTerminalId
        })

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
      catalog: findBuiltInToolCatalogEntry(SUBTERMINAL_TOOL_NAME),
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
          message:
            args.mode === 'detach'
              ? `Starting detached command in docked sub-terminal "${args.terminalName}": ${args.command}`
              : `Submitting command in docked sub-terminal "${args.terminalName}": ${args.command}`
        })

        const result = await subterminalExecutor.executeCommand(args.command, {
          terminalName: args.terminalName,
          timeoutMs: args.timeoutMs,
          mode: args.mode
        })

        return {
          ...result,
          output: truncateToolOutput(result.output)
        }
      }
    })

    this.handlers.set(READ_SUBTERMINAL_TOOL_NAME, {
      schema: READ_SUBTERMINAL_TOOL,
      catalog: findBuiltInToolCatalogEntry(READ_SUBTERMINAL_TOOL_NAME),
      execute: async (rawArguments) => {
        const args = parseSubterminalNameArgs(rawArguments)
        emit({
          type: 'tool',
          name: READ_SUBTERMINAL_TOOL_NAME,
          message: `Reading docked sub-terminal "${args.terminalName}" output`
        })

        if (!subterminalExecutor.readOutput) {
          return {
            ok: false,
            name: args.terminalName,
            tabId: '',
            mode: 'none',
            cwd: '',
            shell: '',
            output: '',
            busy: false,
            detached: false,
            error: 'Sub-terminal output reading is unavailable.'
          }
        }

        const result = await subterminalExecutor.readOutput({
          terminalName: args.terminalName,
          maxChars: args.maxChars
        })
        return {
          ...result,
          output: truncateToolOutput(result.output)
        }
      }
    })

    this.handlers.set(INTERRUPT_SUBTERMINAL_TOOL_NAME, {
      schema: INTERRUPT_SUBTERMINAL_TOOL,
      catalog: findBuiltInToolCatalogEntry(INTERRUPT_SUBTERMINAL_TOOL_NAME),
      execute: async (rawArguments) => {
        const args = parseSubterminalNameArgs(rawArguments)
        emit({
          type: 'tool',
          name: INTERRUPT_SUBTERMINAL_TOOL_NAME,
          message: `Interrupting docked sub-terminal "${args.terminalName}"`
        })

        if (!subterminalExecutor.interrupt) {
          return {
            ok: false,
            name: args.terminalName,
            error: 'Sub-terminal interrupt is unavailable.'
          }
        }

        return subterminalExecutor.interrupt({ terminalName: args.terminalName })
      }
    })
  }

  private registerLocalFileWriteTool(
    localFileWriter: LocalFileWriter,
    userInput: string,
    emit: (event: AgentEvent) => void
  ): void {
    this.handlers.set(LOCAL_FILE_WRITE_TOOL_NAME, {
      schema: LOCAL_FILE_WRITE_TOOL,
      catalog: findBuiltInToolCatalogEntry(LOCAL_FILE_WRITE_TOOL_NAME),
      execute: async (rawArguments) => {
        const args = parseLocalFileWriteArgs(rawArguments)
        if (requiresConfirmedLocalReportDestination(userInput, args.path)) {
          return {
            ok: false,
            path: args.path,
            error:
              'Local report destination was not confirmed by the user. Finish the inspection summary first, ask the user to confirm a local Crescent-machine directory or filename, then call write_local_file with that confirmed path.'
          }
        }

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

  private registerWikiTool(emit: (event: AgentEvent) => void): void {
    this.handlers.set(SAVE_WIKI_DOCUMENT_TOOL_NAME, {
      schema: SAVE_WIKI_DOCUMENT_TOOL,
      catalog: findBuiltInToolCatalogEntry(SAVE_WIKI_DOCUMENT_TOOL_NAME),
      execute: async (rawArguments) => {
        const args = parseWikiSaveArgs(rawArguments)
        emit({
          type: 'tool',
          name: SAVE_WIKI_DOCUMENT_TOOL_NAME,
          message: `Saving wiki document: ${args.title || '(untitled)'}`
        })

        try {
          const document = await saveWikiDocument(args)
          return { ok: true, document }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      }
    })
  }

  private registerDocumentParseTools(brain: AgentBrain, emit: (event: AgentEvent) => void): void {
    for (const schema of DOCUMENT_PARSE_TOOLS) {
      this.handlers.set(schema.function.name, {
        schema,
        catalog: findBuiltInToolCatalogEntry(schema.function.name),
        execute: async (rawArguments) => {
          const args = parseDocumentToolPath(rawArguments)
          emit({
            type: 'tool',
            name: schema.function.name,
            message: `Parsing local file: ${args.path || '(missing path)'}`
          })

          return executeDocumentParseTool(schema.function.name, rawArguments, brain)
        }
      })
    }
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
          description: schema.function.description ?? '',
          source: 'openapi',
          risk: isStateChangingHttpMethod(operation?.method) ? 'high' : 'medium',
          requiresApproval: isStateChangingHttpMethod(operation?.method),
          external: true,
          stateChanging: isStateChangingHttpMethod(operation?.method)
        },
        execute: (rawArguments) => executor.execute(schema.function.name, rawArguments)
      })
    }
  }

  private async registerMcpTools(input: AgentToolRuntimeInput): Promise<void> {
    const registry = await loadMcpToolRegistry(input.config)

    if (registry.errors.length > 0) {
      input.emit({
        type: 'status',
        message: `Some MCP servers failed to load: ${registry.errors.join('; ')}`
      })
      if (registry.tools.length === 0 && isExplicitMcpRequest(input.userInput)) {
        throw new Error(`MCP servers failed to load: ${registry.errors.join('; ')}`)
      }
    }
    if (registry.tools.length === 0) return

    input.emit({ type: 'status', message: formatLoadedMcpToolsMessage(registry.catalog) })

    const selectedToolNames = await input.brain.selectRelevantTools({
      userInput: input.userInput,
      catalog: registry.catalog,
      maxTools: Math.max(1, input.config.maxActiveTools)
    })
    const selected = new Set(selectedToolNames)
    const activeTools = registry.tools.filter((tool) => selected.has(tool.function.name))
    const selectedTools = activeTools.length > 0 ? activeTools : registry.tools.slice(0, 5)

    for (const schema of selectedTools) {
      const entry = registry.entries.get(schema.function.name)
      if (!entry) continue

      this.handlers.set(schema.function.name, {
        schema,
        catalog: entry.catalog,
        execute: (rawArguments) => executeMcpTool(entry, rawArguments)
      })
    }
  }
}

function requiresConfirmedLocalReportDestination(userInput: string, path: string): boolean {
  const context = `${userInput}\n${path}`.toLowerCase()
  if (!/\b(report|inspection|summary|audit|health)\b|巡检|报告|总结/i.test(context)) return false

  return !hasExplicitLocalPath(userInput)
}

function hasExplicitLocalPath(value: string): boolean {
  return /(?:~|\/|\$HOME)[^\s,;]*/.test(value)
}

function isStateChangingHttpMethod(method: HttpMethod | undefined): boolean {
  return method === 'post' || method === 'put' || method === 'patch' || method === 'delete'
}

function parseTerminalCommandArgs(rawArguments: string): {
  command: string
  timeoutMs?: number
  targetTerminalId?: string
} {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown

    if (!isRecord(parsed)) return { command: '' }

    const timeoutMs = Number(parsed.timeoutMs)
    const targetTerminalId =
      typeof parsed.targetTerminalId === 'string' ? parsed.targetTerminalId.trim() : ''

    return {
      command: typeof parsed.command === 'string' ? parsed.command.trim() : '',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
      targetTerminalId: targetTerminalId || undefined
    }
  } catch {
    return { command: '' }
  }
}

function parseSubterminalCommandArgs(rawArguments: string): {
  terminalName: string
  command: string
  timeoutMs?: number
  mode: 'wait' | 'detach'
} {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown

    if (!isRecord(parsed)) return { terminalName: 'temporary', command: '', mode: 'wait' }

    const timeoutMs = Number(parsed.timeoutMs)
    const mode = parsed.mode === 'detach' ? 'detach' : 'wait'

    return {
      terminalName:
        typeof parsed.terminalName === 'string' && parsed.terminalName.trim()
          ? parsed.terminalName.trim()
          : 'temporary',
      command: typeof parsed.command === 'string' ? parsed.command.trim() : '',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
      mode
    }
  } catch {
    return { terminalName: 'temporary', command: '', mode: 'wait' }
  }
}

function parseSubterminalNameArgs(rawArguments: string): {
  terminalName: string
  maxChars?: number
} {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown
    if (!isRecord(parsed)) return { terminalName: 'temporary' }

    const maxChars = Number(parsed.maxChars)
    return {
      terminalName:
        typeof parsed.terminalName === 'string' && parsed.terminalName.trim()
          ? parsed.terminalName.trim()
          : 'temporary',
      maxChars: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : undefined
    }
  } catch {
    return { terminalName: 'temporary' }
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

function parseWikiSaveArgs(rawArguments: string): {
  title: string
  content: string
  id?: string
} {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown

    if (!isRecord(parsed)) return { title: '', content: '' }

    return {
      title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
      content: typeof parsed.content === 'string' ? parsed.content : '',
      id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : undefined
    }
  } catch {
    return { title: '', content: '' }
  }
}

function parseDocumentToolPath(rawArguments: string): { path: string } {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown
    if (!isRecord(parsed)) return { path: '' }

    return {
      path: typeof parsed.path === 'string' ? parsed.path.trim() : ''
    }
  } catch {
    return { path: '' }
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

function hasMcpConfig(config: AgentConfig): boolean {
  return config.mcpServers.some((server) => server.enabled && server.command.trim())
}

function isExplicitMcpRequest(input: string): boolean {
  return /\bMCP\b|mcp_\w+|mcp:\/\//i.test(input)
}

function formatLoadedMcpToolsMessage(catalog: ToolCatalogEntry[]): string {
  const lines = catalog.map((tool) =>
    [`- ${tool.name}`, `${tool.method.toUpperCase()} ${tool.path}`, tool.description]
      .filter(Boolean)
      .join(' · ')
  )

  return [`Loaded ${catalog.length} MCP tools:`, ...lines].join('\n')
}
