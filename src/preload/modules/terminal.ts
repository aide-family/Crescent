import { ipcRenderer } from 'electron'

export const terminalApi = {
  prepareHandoff: (
    sourceId: string,
    tabId: string,
    target: import('../../shared/handoff').HandoffTarget
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:prepare-handoff', { sourceId, tabId, target }),
  continueWaiting: (tabId: string, timeoutMs = 120000): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('terminal:continue-waiting', { tabId, timeoutMs }),
  start: (options?: {
    cols?: number
    rows?: number
    tabId?: string
    initialCommand?: string
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
  pasteCommand: (
    command: string,
    execute = false,
    tabId?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:paste-command', { command, execute, tabId }),
  getContext: (
    tabId?: string
  ): Promise<{
    mode: 'pty' | 'pipe' | 'none'
    pid?: number
    cwd: string
    shell: string
    output: string
    expectedHost?: string
    sessionAligned?: 'aligned' | 'drifted' | 'unknown'
    alignment?: 'aligned' | 'drifted' | 'unknown'
    promptHost?: string
    aliases?: string[]
    ready?: boolean
    jumpPromptHost?: string
    runtimeExpectedHost?: string
    returnToJumpHost?: boolean
    restoring?: boolean
    paneRole?: 'main' | 'subterminal'
    paneId?: string
    owner?: string
    executionMode?: 'local' | 'ssh'
    connectionId?: string
    connectionName?: string
    expectedTarget?: string
    observedHost?: string
    connectionPhase?: import('../../shared/connection-state').ConnectionPhase
    connectionOrigin?: import('../../shared/connection-state').ConnectionOrigin
    monitorPolicy?: import('../../shared/connection-state').MonitorPolicy
    targetScope?: 'host' | 'cluster'
    sshHopChain?: string[]
    manualSshActive?: boolean
    clusterHostRegex?: string
  }> => ipcRenderer.invoke('terminal:get-context', { tabId }),
  resize: (dimensions: { cols: number; rows: number; tabId?: string }): void => {
    ipcRenderer.send('terminal:resize', dimensions)
  },
  stop: (tabId?: string): void => {
    ipcRenderer.send('terminal:stop', { tabId })
  },
  teardownGracefully: (options: {
    tabId: string
    timeoutMs?: number
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:teardown-gracefully', options),
  clearRestoring: (tabId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('terminal:clear-restoring', { tabId }),
  clear: (tabId?: string): void => {
    ipcRenderer.send('terminal:clear', { tabId })
  },
  setExpectedHost: (options: {
    tabId: string
    host?: string | null
    clusterHostRegex?: string | null
    connectionId?: string
    connectionName?: string
  }): Promise<{ ok: boolean; host?: string; error?: string }> =>
    ipcRenderer.invoke('terminal:set-expected-host', options),
  patchClusterHostRegex: (options: {
    tabId: string
    clusterHostRegex?: string | null
  }): Promise<{ ok: boolean; clusterHostRegex?: string; error?: string }> =>
    ipcRenderer.invoke('terminal:patch-cluster-host-regex', options),
  confirmLogin: (options: {
    tabId: string
    sourceTabId?: string
    localHost?: string
    expectedTargetHost?: string
    jumpPromptHost?: string
  }): Promise<{
    ok: boolean
    tabId?: string
    promptHost?: string
    learned?: boolean
    alignment?: 'aligned' | 'drifted' | 'unknown'
    ready?: boolean
    aliases?: string[]
    error?: string
  }> => ipcRenderer.invoke('terminal:confirm-login', options),
  openSubterminal: (options: {
    parentTabId: string
    terminalName: string
    cols?: number
    rows?: number
    initialCommand?: string
  }): Promise<{
    ok: boolean
    name?: string
    tabId?: string
    sessionId?: number
    mode?: 'pty' | 'pipe'
    pid?: number
    shell?: string
    cwd?: string
    error?: string
  }> => ipcRenderer.invoke('terminal:open-subterminal', options),
  readSubterminal: (options: {
    parentTabId: string
    terminalName: string
    maxChars?: number
  }): Promise<{
    ok: boolean
    name: string
    tabId: string
    mode: 'pty' | 'pipe' | 'none'
    cwd: string
    shell: string
    output: string
    busy: boolean
    detached: boolean
    error?: string
  }> => ipcRenderer.invoke('terminal:read-subterminal', options),
  interruptSubterminal: (options: {
    parentTabId: string
    terminalName: string
  }): Promise<{ ok: boolean; name: string; tabId?: string; error?: string }> =>
    ipcRenderer.invoke('terminal:interrupt-subterminal', options),
  interrupt: (tabId: string): Promise<{ ok: boolean; interrupted: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:interrupt', { tabId }),
  onData: (callback: (event: { tabId: string; data: string }) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: { tabId: string; data: string }): void =>
      callback(event)

    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onPrompt: (
    callback: (event: { tabId: string; cwd: string; prompt?: string }) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      event: { tabId: string; cwd: string; prompt?: string }
    ): void => callback(event)

    ipcRenderer.on('terminal:prompt', listener)
    return () => ipcRenderer.removeListener('terminal:prompt', listener)
  },
  onExit: (
    callback: (event: {
      tabId: string
      sessionId: number
      exitCode: number
      signal?: number | string
    }) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      event: { tabId: string; sessionId: number; exitCode: number; signal?: number | string }
    ): void => callback(event)

    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
  onEnvironmentDrift: (
    callback: (event: {
      tabId: string
      observedHost: string
      expectedHost: string
      driftKey?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      event: { tabId: string; observedHost: string; expectedHost: string; driftKey?: string }
    ): void => callback(event)

    ipcRenderer.on('terminal:environment-drift', listener)
    return () => ipcRenderer.removeListener('terminal:environment-drift', listener)
  },
  onConnectionOrigin: (
    callback: (event: { tabId: string; connectionOrigin: 'manual-shell' }) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      event: { tabId: string; connectionOrigin: 'manual-shell' }
    ): void => callback(event)
    ipcRenderer.on('terminal:connection-origin', listener)
    return () => ipcRenderer.removeListener('terminal:connection-origin', listener)
  }
}
