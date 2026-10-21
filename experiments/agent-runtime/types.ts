import type { HostTool } from '../../src/main/agent/runtime/types.ts'
export type { HostTool }
export interface ToolCall {
  name: string
  input: Record<string, unknown>
}
export interface ExperimentEvent {
  type: 'token' | 'tool-start' | 'tool-end'
  text?: string
  name?: string
}
export interface ExperimentRuntime {
  id: string
  run(input: string, signal?: AbortSignal): Promise<string>
  abort(): void
  save(): unknown
  restore(value: unknown): void
}
export interface ExperimentOptions {
  tools: HostTool[]
  calls?: ToolCall[]
  emit?: (event: ExperimentEvent) => void
}
