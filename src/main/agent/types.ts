import type OpenAI from 'openai'

import type { OpenApiOperationMeta } from '../../shared/agent-types'

export type OpenAiTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface ParsedToolBundle {
  tools: OpenAiTool[]
  operations: Map<string, OpenApiOperationMeta>
}

export type {
  AgentCommandInput,
  AgentCommandResult,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentEventMeta,
  AgentLongTermMemory,
  AgentMemoryRecord,
  AgentMode,
  AgentModelOption,
  AgentProviderConfig,
  AgentProviderModelConfig,
  AgentRunInput,
  AgentSkillContext,
  AgentSkillOption,
  AgentValidationResult,
  ConnectionConfig,
  ConnectionInput,
  ConnectionSource,
  HttpMethod,
  OpenApiOperationMeta,
  OperationRecord,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionTab,
  TerminalCommandExecutor,
  TerminalCommandResult,
  ToolCatalogEntry
} from '../../shared/agent-types'
