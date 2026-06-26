import type OpenAI from 'openai'

export type OpenAiTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type AgentMode = 'react' | 'plan-execute'

export type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'
  | 'trace'

export interface AgentConfig {
  openAiApiKey: string
  openAiBaseUrl: string
  model: string
  agentMode: AgentMode
  maxActiveTools: number
  openApiBaseUrl: string
  openApiDocument: string
}

export interface AgentRunInput {
  input: string
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
