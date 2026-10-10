import type { AgentConfig, AgentEvent } from '../types'

export type RuntimeThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max'
export interface RuntimeModel {
  id: string
  provider: string
  name: string
  reasoning: boolean
  contextWindow: number
}
export interface RuntimeEventMeta {
  runId: string
  tabId?: string
  locale?: string
  fromSubagent?: boolean
}
export interface RuntimeEvent {
  events: AgentEvent[]
  usageChanged: boolean
  retryError?: string
  compaction?: { reason: 'manual' | 'threshold' | 'overflow'; aborted: boolean }
}
/** Host-facing session contract. Runtime adapters do not own execution policy. */
export interface AgentRuntimeSession {
  readonly messages: unknown[]
  readonly model: RuntimeModel | undefined
  readonly isStreaming: boolean
  readonly isCompacting: boolean
  prompt(input: string): Promise<void>
  steer(input: string): Promise<void>
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  abortRetry(): void
  compact(instructions?: string): Promise<{ tokensBefore: number; estimatedTokensAfter?: number }>
  setModel(model: RuntimeModel): Promise<void>
  setThinkingLevel(level: RuntimeThinkingLevel): void
  setActiveToolsByName(names: string[]): void
  getActiveToolNames(): string[]
  getSessionStats(): unknown
  getContextUsage():
    | { tokens: number | null; contextWindow: number; percent: number | null }
    | undefined
  getContext(): unknown[]
  getRevision(): string | undefined
  subscribe(listener: (event: RuntimeEvent) => void, meta: RuntimeEventMeta): () => void
  dispose(): void
}
export interface AgentRuntimeAdapter<Options> {
  readonly id: string
  createSession(options: Options): Promise<AgentRuntimeSession>
  listModels(config: AgentConfig): Promise<readonly RuntimeModel[]>
}
/** Supplied by Crescent. Permission checks and side effects stay in the host. */
export interface HostTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute(input: unknown, signal?: AbortSignal): Promise<unknown>
}
