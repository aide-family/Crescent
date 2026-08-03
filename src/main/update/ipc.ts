import { ipcMain } from 'electron'
import {
  checkForAppUpdates,
  configureAutoUpdater,
  downloadAppUpdate,
  getAppVersion,
  installAppUpdate
} from './updater'

export function registerUpdateIpc(): void {
  configureAutoUpdater()

  ipcMain.handle('update:get-version', async () => {
    return { version: getAppVersion() }
  })

  ipcMain.handle('update:check', async () => {
    return checkForAppUpdates()
  })

  ipcMain.handle('update:download', async () => {
    return downloadAppUpdate()
  })

  ipcMain.handle('update:install', async () => {
    return installAppUpdate()
  })
}
