import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentConfig, AgentEvent, AgentModelOption, AgentRunInput } from '../main/agent/types'

interface TerminalAgentApi {
  terminal: {
    start: (options?: { cols?: number; rows?: number }) => Promise<{
      sessionId: number
      mode: 'pty' | 'pipe'
      pid: number
      shell: string
      cwd: string
    }>
    write: (data: string) => void
    resize: (dimensions: { cols: number; rows: number }) => void
    stop: () => void
    clear: () => void
    onData: (callback: (data: string) => void) => () => void
    onPrompt: (callback: (event: { cwd: string }) => void) => () => void
    onExit: (callback: (event: { sessionId: number; exitCode: number; signal?: number }) => void) => () => void
  }
  agent: {
    getConfig: () => Promise<AgentConfig>
    getModels: () => Promise<AgentModelOption[]>
    saveConfig: (config: Partial<AgentConfig>) => Promise<AgentConfig>
    run: (input: AgentRunInput) => Promise<{ ok: boolean; text?: string; error?: string }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TerminalAgentApi
  }
}
