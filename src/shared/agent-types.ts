export type AgentMode = 'react' | 'plan-execute'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'

export interface AgentConfig {
  openAiApiKey?: string
  openAiBaseUrl?: string
  providers: AgentProviderConfig[]
  model: string
  agentMode: AgentMode
  maxActiveTools: number
  commandWhitelist: string[]
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

export type CommandRiskLevel = 'low' | 'medium' | 'high'

export interface CommandAuditResult {
  summary: string
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
  path: string
  source: string
}

export interface AgentSkillContext {
  catalog: AgentSkillOption[]
  matched: Array<AgentSkillOption & { content: string; reason: 'referenced' | 'matched' }>
  promptBlock: string
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
  | ({ type: 'tool'; name: string; message: string } & AgentEventMeta)
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

export interface StoredSessionHistoryItem extends StoredSessionTab {
  updatedAt: string
  lastMessage?: string
  lastMessageAt?: string
  runCount: number
}

export interface StoredSessionHistoryDetail extends StoredSessionHistoryItem {
  logs: StoredAgentLogEntry[]
}
