import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AgentCommandInput,
  AgentCommandResult,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentModelOption,
  AgentRunInput,
  AgentValidationResult,
  ConnectionConfig,
  ConnectionInput,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionTab
} from '../main/agent/types'

interface TerminalAgentApi {
  terminal: {
    start: (options?: { cols?: number; rows?: number; tabId?: string }) => Promise<{
      sessionId: number
      tabId: string
      mode: 'pty' | 'pipe'
      pid: number
      shell: string
      cwd: string
    }>
    write: (data: string, tabId?: string) => void
    pasteCommand: (command: string, execute?: boolean, tabId?: string) => void
    getContext: (tabId?: string) => Promise<{
      mode: 'pty' | 'pipe' | 'none'
      pid?: number
      cwd: string
      shell: string
      output: string
    }>
    resize: (dimensions: { cols: number; rows: number; tabId?: string }) => void
    stop: (tabId?: string) => void
    clear: (tabId?: string) => void
    onData: (callback: (event: { tabId: string; data: string }) => void) => () => void
    onPrompt: (callback: (event: { tabId: string; cwd: string }) => void) => () => void
    onExit: (
      callback: (event: {
        tabId: string
        sessionId: number
        exitCode: number
        signal?: number
      }) => void
    ) => () => void
  }
  agent: {
    getConfig: () => Promise<AgentConfig>
    getModels: () => Promise<AgentModelOption[]>
    saveConfig: (config: Partial<AgentConfig>) => Promise<AgentConfig>
    validateConfig: (config: Partial<AgentConfig>) => Promise<AgentValidationResult>
    generateCommand: (input: AgentCommandInput) => Promise<AgentCommandResult>
    resolveConnectionIntent: (
      input: AgentConnectionIntentInput
    ) => Promise<AgentConnectionIntentResult>
    run: (input: AgentRunInput) => Promise<{ ok: boolean; text?: string; error?: string }>
    cancel: (runId: string) => Promise<{ ok: boolean }>
    supplement: (input: { runId: string; input: string }) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
  }
  connections: {
    list: () => Promise<ConnectionConfig[]>
    save: (input: ConnectionInput) => Promise<ConnectionConfig[]>
    delete: (id: string) => Promise<ConnectionConfig[]>
  }
  storage: {
    saveTabs: (tabs: StoredSessionTab[]) => Promise<{ ok: boolean }>
    saveAgentLog: (entry: StoredAgentLogEntry) => Promise<{ ok: boolean }>
    updateAgentLog: (
      input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>
    ) => Promise<{ ok: boolean }>
    saveAgentRun: (run: StoredAgentRun) => Promise<{ ok: boolean }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TerminalAgentApi
  }
}
