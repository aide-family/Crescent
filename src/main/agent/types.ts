import type OpenAI from 'openai'

export type OpenAiTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type AgentMode = 'react' | 'plan-execute'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'

export interface AgentConfig {
  openAiApiKey?: string
  openAiBaseUrl?: string
  providers: AgentProviderConfig[]
  model: string
  agentMode: AgentMode
  maxActiveTools: number
  openApiBaseUrl: string
  openApiDocument: string
}

export interface AgentProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
  models: AgentProviderModelConfig[]
}

export interface AgentProviderModelConfig {
  id: string
  name?: string
  reasoning?: boolean
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
  runId?: string
  input: string
  terminalContext?: string
  connectionId?: string
  tabId?: string
}

export interface AgentConnectionIntentInput {
  input: string
}

export interface AgentConnectionIntentResult {
  ok: boolean
  connectionId?: string
  confidence?: number
  reason?: string
  error?: string
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
  providerName: string
  reasoning: boolean
}

export type AgentEvent =
  | ({ type: 'status'; message: string } & AgentEventMeta)
  | ({ type: 'thought'; message: string } & AgentEventMeta)
  | ({ type: 'plan'; steps: string[] } & AgentEventMeta)
  | ({ type: 'tool'; name: string; message: string } & AgentEventMeta)
  | ({ type: 'token'; text: string } & AgentEventMeta)
  | ({ type: 'error'; message: string } & AgentEventMeta)
  | ({ type: 'done'; message: string } & AgentEventMeta)

export interface AgentEventMeta {
  runId?: string
  tabId?: string
}

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

export interface StoredSessionTab {
  tabId: string
  title: string
  connectionId?: string
  connectionName?: string
  isSsh: boolean
  terminalCwd?: string
  terminalMode?: 'pty' | 'pipe'
}

export interface StoredAgentLogEntry {
  tabId: string
  logId: number
  kind: string
  text: string
  createdAt: string
}

export interface StoredAgentRun {
  runId: string
  tabId: string
  input: string
  status: 'running' | 'success' | 'error' | 'canceled'
  connectionId?: string
  output?: string
  error?: string
}
