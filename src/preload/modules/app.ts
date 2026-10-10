import { ipcRenderer } from 'electron'

export const appApi = {
  notifyAttention: (input: {
    title: string
    body: string
    pendingId?: string
    tabId?: string
    chatTabId?: string
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:notify-attention', input),
  getRendererRecoveryMode: (): Promise<{ mode: 'none' | 'pending' | 'crash-loop' }> =>
    ipcRenderer.invoke('app:get-renderer-recovery-mode'),
  clearRendererRecovery: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:clear-renderer-recovery'),
  exportRendererDiagnostics: (): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke('app:export-renderer-diagnostics'),
  reportDiagnosticError: (message: string): void => {
    ipcRenderer.send('renderer:diagnostic-error', { message: message.slice(0, 2048) })
  },
  setLocale: (locale: 'zh-CN' | 'en'): Promise<{ ok: boolean; locale: 'zh-CN' | 'en' }> =>
    ipcRenderer.invoke('app:set-locale', locale),
  getWorkbenchLayout: (): Promise<{ layout: 'split' | 'chat' | 'terminal' | null }> =>
    ipcRenderer.invoke('app:get-workbench-layout'),
  setWorkbenchLayout: (
    layout: 'split' | 'chat' | 'terminal'
  ): Promise<{ ok: boolean; layout?: 'split' | 'chat' | 'terminal'; error?: string }> =>
    ipcRenderer.invoke('app:set-workbench-layout', layout),
  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:open-external', url),
  writeClipboardText: (value: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('app:write-clipboard-text', value),
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('app:open-settings', listener)
    return () => ipcRenderer.removeListener('app:open-settings', listener)
  },
  onAttentionClicked: (
    callback: (payload: { pendingId?: string; tabId?: string; chatTabId?: string }) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { pendingId?: string; tabId?: string; chatTabId?: string }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('app:attention-clicked', listener)
    return () => ipcRenderer.removeListener('app:attention-clicked', listener)
  }
}
