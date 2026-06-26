import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AgentConfig, AgentEvent, AgentModelOption, AgentRunInput } from '../main/agent/types'

// Custom APIs for renderer
const api = {
  terminal: {
    start: (options?: { cols?: number; rows?: number }): Promise<{
      sessionId: number
      mode: 'pty' | 'pipe'
      pid: number
      shell: string
      cwd: string
    }> =>
      ipcRenderer.invoke('terminal:start', options),
    write: (data: string): void => {
      ipcRenderer.send('terminal:write', data)
    },
    resize: (dimensions: { cols: number; rows: number }): void => {
      ipcRenderer.send('terminal:resize', dimensions)
    },
    stop: (): void => {
      ipcRenderer.send('terminal:stop')
    },
    clear: (): void => {
      ipcRenderer.send('terminal:clear')
    },
    onData: (callback: (data: string) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: string): void => callback(data)

      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onPrompt: (callback: (event: { cwd: string }) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: { cwd: string }): void => callback(event)

      ipcRenderer.on('terminal:prompt', listener)
      return () => ipcRenderer.removeListener('terminal:prompt', listener)
    },
    onExit: (callback: (event: { sessionId: number; exitCode: number; signal?: number }) => void): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { sessionId: number; exitCode: number; signal?: number }
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
    run: (input: AgentRunInput): Promise<{ ok: boolean; text?: string; error?: string }> =>
      ipcRenderer.invoke('agent:run', input),
    onEvent: (callback: (event: AgentEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: AgentEvent): void => callback(event)

      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    }
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
