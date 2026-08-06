/** @deprecated Plan/react modes removed; Pi session loop is the only runtime. */
export type AgentMode = 'react' | 'plan-execute'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'

export interface AgentConfig {
  openAiApiKey?: string
  openAiBaseUrl?: string
  providers: AgentProviderConfig[]
  providerId?: string
  model: string
  /** Workspace directory for Pi read/write/edit/bash tools. */
  workspaceCwd?: string
  /** @deprecated Ignored; Pi owns the agent loop. Kept for config migration. */
  agentMode: AgentMode
  /** @deprecated Ignored after Pi migration. */
  maxActiveTools: number
  /** @deprecated Agent no longer drives terminal commands. */
  commandWhitelist: string[]
  /** @deprecated OpenAPI tools removed from agent loop; retained for settings migration. */
  openApiProfiles: AgentOpenApiProfile[]
  openApiProfileId?: string
  openApiBaseUrl: string
  openApiDocument: string
  openApiTimeoutMs: number
  openApiMaxRetries: number
  openApiRetryBackoffMs: number
  skillRoot: string
  /** @deprecated MCP tools removed from agent loop; retained for settings migration. */
  mcpServers: AgentMcpServerConfig[]
}

export interface AgentOpenApiProfile {
  id: string
  name: string
  baseUrl: string
  document: string
  timeoutMs: number
  maxRetries: number
  retryBackoffMs: number
  /** Optional guidance injected into the agent system prompt for this profile. */
  promptTemplate?: string
  /** Saved prompts the user can insert/run from the UI. */
  pinnedWorkflows?: AgentPinnedWorkflow[]
  /** Empty = no allow restriction. Exact OpenAPI tool function names. */
  toolAllowList?: string[]
  /** Exact OpenAPI tool function names that must never be registered. */
  toolDenyList?: string[]
}

export interface AgentPinnedWorkflow {
  id: string
  name: string
  prompt: string
  pinned?: boolean
}

export type AgentMcpTransport = 'stdio'

export interface AgentMcpServerConfig {
  id: string
  name: string
  transport: AgentMcpTransport
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  toolAllowList?: string[]
  toolDenyList?: string[]
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

export type ConnectionSource = 'ssh-config' | 'custom' | 'local'

export interface ConnectionConfig {
  id: string
  source: ConnectionSource
  name: string
  host: string
  user?: string
  password?: string
  passwordEnvVar?: string
  resolvedPassword?: string
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
  password?: string
  passwordEnvVar?: string
  port?: number
  identityFile?: string
  sshOptions?: string[]
  description?: string
  actions?: string[]
}

export interface AgentPathReference {
  id: string
  kind: 'file' | 'directory'
  path: string
  name: string
}

export interface PastedAttachmentInput {
  name: string
  mimeType?: string
  base64: string
}

export interface TranscribeAudioInput {
  base64: string
  mimeType?: string
  name?: string
  language?: string
}

export interface TranscribeAudioResult {
  ok: boolean
  text?: string
  path?: string
  error?: string
}

export interface TranscriptionSupportResult {
  supported: boolean
  providerId: string
  baseUrl: string
  reason?: string
}

export interface AgentWikiReference {
  id: string
  title: string
  path: string
  content: string
}

export interface WikiDocumentSummary {
  id: string
  title: string
  path: string
  updatedAt: string
  excerpt: string
}

export interface WikiDocument extends WikiDocumentSummary {
  content: string
}

export interface WikiSaveInput {
  title: string
  content: string
  id?: string
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

export interface AgentSessionTerminalRef {
  tabId: string
  title: string
  connectionId?: string
  connectionName?: string
  isSsh: boolean
  cwd?: string
  isCurrent?: boolean
  /** Docked sub-terminal under a parent tab in the same chat session. */
  kind?: 'terminal' | 'subterminal'
  parentTabId?: string
  subterminalName?: string
}

export interface AgentRunInput {
  runId?: string
  input: string
  skillInput?: string
  conversationContext?: string
  providerId?: string
  model?: string
  /** Chat/session tab id used as Pi session key. */
  tabId?: string
  /** @deprecated Agent no longer executes in terminal panes. */
  terminalContext?: string
  /** @deprecated Agent no longer executes in terminal panes. */
  allowTerminalTools?: boolean
  /** @deprecated Agent no longer auto-connects SSH for runs. */
  connectionId?: string
  /** @deprecated Agent no longer targets session terminals. */
  sessionTerminals?: AgentSessionTerminalRef[]
  locale?: string
}

export interface AgentConnectionIntentInput {
  input: string
  conversationContext?: string
  currentConnectionId?: string
  currentConnectionName?: string
  terminalSummary?: string
}

export interface AgentConnectionIntentResult {
  ok: boolean
  shouldConnect?: boolean
  connectionId?: string
  confidence?: number
  executeAfterLogin?: boolean
  userGoal?: string
  matchBasis?: 'name' | 'host' | 'user' | 'description' | 'none'
  needsClarification?: boolean
  clarificationQuestion?: string
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
  terminalExited?: boolean
  detached?: boolean
  subterminalName?: string
  subterminalTabId?: string
}

export interface TerminalCommandExecutor {
  executeCommand(
    command: string,
    timeoutMsOrOptions?: number | { timeoutMs?: number; targetTerminalId?: string }
  ): Promise<TerminalCommandResult>
}

export interface SubterminalCommandExecutor {
  executeCommand(
    command: string,
    options: { terminalName: string; timeoutMs?: number; mode?: 'wait' | 'detach' }
  ): Promise<TerminalCommandResult>
  readOutput?(options: {
    terminalName: string
    maxChars?: number
  }): Promise<{
    ok: boolean
    name: string
    tabId: string
    mode: 'pty' | 'pipe' | 'none'
    cwd: string
    shell: string
    output: string
    busy: boolean
    detached: boolean
    error?: string
  }>
  interrupt?(options: {
    terminalName: string
  }): Promise<{ ok: boolean; name: string; tabId?: string; error?: string }>
}

export interface LocalFileWriteResult {
  ok: boolean
  path: string
  bytes?: number
  overwritten?: boolean
  permissionRequested?: boolean
  authorizationPath?: string
  error?: string
}

export interface LocalFileWriter {
  writeFile(
    path: string,
    content: string,
    options?: { overwrite?: boolean; encoding?: 'utf-8' }
  ): Promise<LocalFileWriteResult>
}

export type CommandRiskLevel = 'low' | 'medium' | 'high'

export interface CommandAuditResult {
  summary: string
  operationReason: string
  risk: CommandRiskLevel
  requiresApproval: boolean
  riskPoints: string[]
  impactAnalysis: string
  recommendation: string
}

export interface CommandApprovalRequest {
  id: string
  runId: string
  tabId?: string
  command: string
  timeoutMs?: number
  audit: CommandAuditResult
}

export interface CommandApprovalDecision {
  requestId: string
  approved: boolean
  note?: string
  rejectionReason?: string
}

export interface CommandApprovalDismiss {
  requestId: string
  runId: string
}

export interface AgentValidationResult {
  ok: boolean
  modelOk?: boolean
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

export interface AgentSkillOption {
  id: string
  name: string
  description: string
  aliases?: string[]
  path: string
  source: string
  removable?: boolean
}

export interface AgentSkillSearchResult {
  id: string
  name: string
  description: string
  source: string
  url?: string
  installSource: string
  installSkill?: string
  installs?: number
}

export interface AgentSkillInstallResult {
  ok: boolean
  output: string
  skills: AgentSkillOption[]
  fallbackInstalledAll?: boolean
  requestedSkill?: string
}

export type AgentSkillInstallEvent =
  | {
      installId: string
      type: 'log'
      data: string
    }
  | {
      installId: string
      type: 'done'
      result: AgentSkillInstallResult
    }
  | {
      installId: string
      type: 'error'
      error: string
      canceled?: boolean
    }

export interface AgentSkillContext {
  catalog: AgentSkillOption[]
  matched: Array<AgentSkillOption & { content: string; reason: 'referenced' | 'matched' }>
  promptBlock: string
}

export interface AgentSkillUsage {
  name: string
  description: string
  path: string
  source: string
  reason: 'referenced' | 'matched'
  removable?: boolean
}

export interface LocalInstructionDocument {
  name: string
  path: string
  content: string
  exists: boolean
}

export type AgentEvent =
  | ({ type: 'status'; message: string } & AgentEventMeta)
  | ({ type: 'thought'; message: string } & AgentEventMeta)
  | ({ type: 'plan'; steps: string[] } & AgentEventMeta)
  | ({ type: 'skills'; message: string; skills: AgentSkillUsage[] } & AgentEventMeta)
  | ({ type: 'tool'; name: string; message: string } & AgentEventMeta)
  | ({
      type: 'command'
      phase: 'started' | 'finished'
      command: string
      result?: TerminalCommandResult
      elapsedMs?: number
    } & AgentEventMeta)
  | ({ type: 'command-review'; command: string; audit: CommandAuditResult } & AgentEventMeta)
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

export interface ToolCatalogEntry {
  name: string
  method: HttpMethod
  path: string
  description: string
  source?: 'built-in' | 'openapi' | 'mcp'
  risk?: CommandRiskLevel
  requiresApproval?: boolean
  external?: boolean
  stateChanging?: boolean
}

export interface StoredSessionTab {
  tabId: string
  sessionGroupId?: string
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
  startedAt?: string
  elapsedMs?: number
  trace?: AgentRunTrace
}

export type OpsHistoryRating = 'like' | 'dislike'

export interface OpsHistoryRecord {
  id: string
  tabId: string
  /** Connection this feedback belongs to (SSH id, or builtin local terminal). */
  connectionId: string
  runId: string
  rating: OpsHistoryRating
  userGoal: string
  pathSummary: string
  lesson: string
  createdAt: string
  updatedAt: string
}

export interface SubmitOpsFeedbackInput {
  tabId: string
  runId: string
  rating: OpsHistoryRating
  /** Prefer explicit connection; falls back to the stored agent run. */
  connectionId?: string
}

export interface SubmitOpsFeedbackResult {
  ok: boolean
  record?: OpsHistoryRecord
  error?: string
}

export interface UpdateOpsFeedbackInput {
  id: string
  rating?: OpsHistoryRating
  userGoal?: string
  pathSummary?: string
  lesson?: string
}

export interface UpdateOpsFeedbackResult {
  ok: boolean
  record?: OpsHistoryRecord
  error?: string
}

export interface AgentRunTraceStep {
  index: number
  title: string
  detail: string
}

export interface AgentRunTrace {
  version: 1
  runId: string
  tabId: string
  input: string
  status: StoredAgentRun['status']
  connectionId?: string
  startedAt?: string
  finishedAt?: string
  elapsedMs?: number
  steps: AgentRunTraceStep[]
  resultSummary?: string
  error?: string
}

export interface StoredSessionHistoryItem extends StoredSessionTab {
  updatedAt: string
  summary?: string
  lastMessage?: string
  lastMessageAt?: string
  runCount: number
}

export interface StoredSessionSummaryUpdate {
  tabId: string
  title: string
  summary: string
  updatedAt: string
}

export interface StoredSessionHistoryDetail extends StoredSessionHistoryItem {
  logs: StoredAgentLogEntry[]
}
