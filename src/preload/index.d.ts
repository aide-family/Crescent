import type { api } from './api'

export type TerminalAgentApi = typeof api
interface RendererPlatformInfo {
  process: { platform: string; versions: Record<string, string | undefined> }
}

declare global {
  interface Window {
    electron: RendererPlatformInfo
    api: TerminalAgentApi
  }
}
