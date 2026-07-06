import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AgentCommandInput,
  AgentCommandResult,
  AgentConfig,
  AgentEvent,
  AgentModelOption,
  AgentRunInput,
  AgentValidationResult,
  ConnectionConfig,
  ConnectionInput
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
    run: (input: AgentRunInput) => Promise<{ ok: boolean; text?: string; error?: string }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
  }
  connections: {
    list: () => Promise<ConnectionConfig[]>
    save: (input: ConnectionInput) => Promise<ConnectionConfig[]>
    delete: (id: string) => Promise<ConnectionConfig[]>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TerminalAgentApi
  }
}
