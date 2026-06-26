import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentConfig, AgentEvent, AgentRunInput } from '../main/agent/types'

interface TerminalAgentApi {
  agent: {
    getConfig: () => Promise<AgentConfig>
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
