import { ipcRenderer } from 'electron'
import type {
  WhaleModelsSnapshot,
  WhaleMonitorConfigInput,
  WhaleMonitorSettings,
  WhaleMonitorSnapshot,
  WhaleUsageSnapshot
} from '../../shared/whale-monitor'

export const whaleMonitorApi = {
  getSnapshot: (): Promise<WhaleMonitorSnapshot> =>
    ipcRenderer.invoke('whale-monitor:get-snapshot'),
  saveSettings: (input: WhaleMonitorConfigInput): Promise<WhaleMonitorSettings> =>
    ipcRenderer.invoke('whale-monitor:save-settings', input),
  refreshUsage: (range: { startDate: string; endDate: string }): Promise<WhaleUsageSnapshot> =>
    ipcRenderer.invoke('whale-monitor:refresh-usage', range),
  refreshModels: (): Promise<WhaleModelsSnapshot> =>
    ipcRenderer.invoke('whale-monitor:refresh-models'),
  setPosition: (position: { x: number; y: number }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('whale-monitor:set-position', position),
  onSnapshot: (callback: (snapshot: WhaleMonitorSnapshot) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: WhaleMonitorSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('whale-monitor:snapshot', listener)
    return () => ipcRenderer.removeListener('whale-monitor:snapshot', listener)
  }
}
