import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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

// Custom APIs for renderer
const api = {
  terminal: {
    start: (options?: {
      cols?: number
      rows?: number
      tabId?: string
    }): Promise<{
      sessionId: number
      tabId: string
      mode: 'pty' | 'pipe'
      pid: number
      shell: string
      cwd: string
    }> => ipcRenderer.invoke('terminal:start', options),
    write: (data: string, tabId?: string): void => {
      ipcRenderer.send('terminal:write', { data, tabId })
    },
    pasteCommand: (command: string, execute = false, tabId?: string): void => {
      ipcRenderer.send('terminal:paste-command', { command, execute, tabId })
    },
    getContext: (
      tabId?: string
    ): Promise<{
      mode: 'pty' | 'pipe' | 'none'
      pid?: number
      cwd: string
      shell: string
      output: string
    }> => ipcRenderer.invoke('terminal:get-context', { tabId }),
    resize: (dimensions: { cols: number; rows: number; tabId?: string }): void => {
      ipcRenderer.send('terminal:resize', dimensions)
    },
    stop: (tabId?: string): void => {
      ipcRenderer.send('terminal:stop', { tabId })
    },
    clear: (tabId?: string): void => {
      ipcRenderer.send('terminal:clear', { tabId })
    },
    onData: (callback: (event: { tabId: string; data: string }) => void): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; data: string }
      ): void => callback(event)

      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onPrompt: (callback: (event: { tabId: string; cwd: string }) => void): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; cwd: string }
      ): void => callback(event)

      ipcRenderer.on('terminal:prompt', listener)
      return () => ipcRenderer.removeListener('terminal:prompt', listener)
    },
    onExit: (
      callback: (event: {
        tabId: string
        sessionId: number
        exitCode: number
        signal?: number
      }) => void
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; sessionId: number; exitCode: number; signal?: number }
      ): void => callback(event)

      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    }
  },
  agent: {
    getConfig: (): Promise<AgentConfig> => ipcRenderer.invoke('agent:get-config'),
    getModels: (): Promise<AgentModelOption[]> => ipcRenderer.invoke('agent:get-models'),
    saveConfig: (config: Partial<AgentConfig>): Promise<AgentConfig> =>
      ipcRenderer.invoke('agent:save-config', config),
    validateConfig: (config: Partial<AgentConfig>): Promise<AgentValidationResult> =>
      ipcRenderer.invoke('agent:validate-config', config),
    generateCommand: (input: AgentCommandInput): Promise<AgentCommandResult> =>
      ipcRenderer.invoke('agent:generate-command', input),
    run: (input: AgentRunInput): Promise<{ ok: boolean; text?: string; error?: string }> =>
      ipcRenderer.invoke('agent:run', input),
    onEvent: (callback: (event: AgentEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: AgentEvent): void => callback(event)

      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    }
  },
  connections: {
    list: (): Promise<ConnectionConfig[]> => ipcRenderer.invoke('connections:list'),
    save: (input: ConnectionInput): Promise<ConnectionConfig[]> =>
      ipcRenderer.invoke('connections:save', input),
    delete: (id: string): Promise<ConnectionConfig[]> =>
      ipcRenderer.invoke('connections:delete', id)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
