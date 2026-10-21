import { rendererIpc } from '../ipc-security'
import {
  checkForAppUpdates,
  configureAutoUpdater,
  downloadAppUpdate,
  downloadInstallerToDownloads,
  getAppVersion,
  installAppUpdate
} from './updater'

export function registerUpdateIpc(): void {
  configureAutoUpdater()

  rendererIpc.handle('update:get-version', async () => {
    return { version: getAppVersion() }
  })

  rendererIpc.handle('update:check', async () => {
    return checkForAppUpdates()
  })

  rendererIpc.handle('update:download', async () => {
    return downloadAppUpdate()
  })

  rendererIpc.handle('update:download-installer', async () => {
    return downloadInstallerToDownloads()
  })

  rendererIpc.handle('update:install', async () => {
    return installAppUpdate()
  })
}
