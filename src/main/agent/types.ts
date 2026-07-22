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
  AgentMcpServerConfig,
  AgentMcpTransport,
  AgentMode,
  AgentModelOption,
  AgentPathReference,
  AgentProviderConfig,
  AgentProviderModelConfig,
  AgentRunInput,
  AgentSkillContext,
  AgentSkillInstallResult,
  AgentSkillOption,
  AgentSkillSearchResult,
  AgentValidationResult,
  CommandApprovalDecision,
  CommandApprovalRequest,
  CommandAuditResult,
  CommandRiskLevel,
  ConnectionConfig,
  ConnectionInput,
  ConnectionSource,
  HttpMethod,
  LocalFileWriter,
  LocalFileWriteResult,
  OpenApiOperationMeta,
  OperationRecord,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionSummaryUpdate,
  StoredSessionTab,
  SubterminalCommandExecutor,
  TerminalCommandExecutor,
  TerminalCommandResult,
  ToolCatalogEntry,
  WikiDocument,
  WikiDocumentSummary,
  WikiSaveInput
} from '../../shared/agent-types'
