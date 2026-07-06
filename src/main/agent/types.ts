import type OpenAI from 'openai'

export type OpenAiTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type AgentMode = 'react' | 'plan-execute'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'

export interface AgentConfig {
  openAiApiKey: string
  openAiBaseUrl: string
  model: string
  agentMode: AgentMode
  maxActiveTools: number
  openApiBaseUrl: string
  openApiDocument: string
}

export type ConnectionSource = 'ssh-config' | 'custom'

export interface ConnectionConfig {
  id: string
  source: ConnectionSource
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  sshOptions?: string[]
  description?: string
  actions?: string[]
}

export interface ConnectionInput {
  id?: string
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  sshOptions?: string[]
  description?: string
  actions?: string[]
}

export interface OperationRecord {
  id: string
  createdAt: string
  connectionId?: string
  connectionName?: string
  command?: string
  status: 'success' | 'error'
  summary: string
  output?: string
}

export interface AgentRunInput {
  input: string
  terminalContext?: string
  connectionId?: string
  tabId?: string
}

export interface AgentCommandInput {
  instruction: string
  cwd?: string
  shell?: string
  terminalContext?: string
}

export interface AgentCommandResult {
  ok: boolean
  command?: string
  explanation?: string
  risk?: 'low' | 'medium' | 'high'
  error?: string
}

export interface TerminalCommandResult {
  ok: boolean
  command: string
  mode?: 'pty' | 'pipe'
  cwd?: string
  exitCode?: number
  output: string
  error?: string
  timedOut?: boolean
}

export interface TerminalCommandExecutor {
  executeCommand(command: string, timeoutMs?: number): Promise<TerminalCommandResult>
}

export interface AgentValidationResult {
  ok: boolean
  toolCount?: number
  tools?: ToolCatalogEntry[]
  error?: string
}

export interface AgentModelOption {
  id: string
  name: string
  providerId: string
  reasoning: boolean
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'thought'; message: string }
  | { type: 'plan'; steps: string[] }
  | { type: 'tool'; name: string; message: string }
  | { type: 'token'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; message: string }

export interface OpenApiOperationMeta {
  name: string
  method: HttpMethod
  path: string
  operationId?: string
  summary?: string
  description?: string
  requestBodyContentType?: string
}

export interface AgentMemoryRecord {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface AgentLongTermMemory {
  preferences: string[]
  notes: string[]
  operations: OperationRecord[]
}

export interface ParsedToolBundle {
  tools: OpenAiTool[]
  operations: Map<string, OpenApiOperationMeta>
}

export interface ToolCatalogEntry {
  name: string
  method: HttpMethod
  path: string
  description: string
}
