import { ipcRenderer } from 'electron'
import type {
  AppUpdateActionResult,
  AppUpdateStatusEvent,
  AppUpdateVersionResult
} from '../../shared/update-types'

export const updateApi = {
  getVersion: (): Promise<AppUpdateVersionResult> => ipcRenderer.invoke('update:get-version'),
  check: (): Promise<AppUpdateActionResult> => ipcRenderer.invoke('update:check'),
  download: (): Promise<AppUpdateActionResult> => ipcRenderer.invoke('update:download'),
  downloadInstaller: (): Promise<AppUpdateActionResult> =>
    ipcRenderer.invoke('update:download-installer'),
  install: (): Promise<AppUpdateActionResult> => ipcRenderer.invoke('update:install'),
  onStatus: (callback: (event: AppUpdateStatusEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: AppUpdateStatusEvent): void =>
      callback(event)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  }
}
