import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { getMenuLabels, type MenuLocale } from '../../shared/menu-labels'
import { safeWebContentsSend } from '../safe-ipc-send'
import type { AppUpdateActionResult, AppUpdateStatusEvent } from '../../shared/update-types'
import { downloadUpdateInstaller } from './download-installer'
import {
  isAppUpdateCheckEnabled,
  isExpectedUpdateNetworkError,
  shouldForceDevUpdateConfig,
  summarizeUpdateNetworkError
} from './update-policy'

let configured = false
let menuUpdateRequested = false
let menuDownloadRequested = false
let menuDialogPending = false
let menuLocale: MenuLocale = 'en'
let busyListener: ((busy: boolean) => void) | undefined
let lastAvailableInfo: UpdateInfo | undefined

function broadcast(event: AppUpdateStatusEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    safeWebContentsSend(window.webContents, 'update:status', event)
  }
}

function setMenuBusy(busy: boolean): void {
  busyListener?.(busy)
}

function clearMenuUpdateFlow(): void {
  menuUpdateRequested = false
  menuDownloadRequested = false
  menuDialogPending = false
  setMenuBusy(false)
}

function isMenuUpdateFlowActive(): boolean {
  return menuUpdateRequested || menuDownloadRequested
}

function beginMenuDialog(): boolean {
  if (!isMenuUpdateFlowActive()) return false
  if (menuDialogPending) return false
  menuDialogPending = true
  return true
}

async function showMenuDialog(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (parent) return dialog.showMessageBox(parent, options)
  return dialog.showMessageBox(options)
}

async function presentMenuUpdateError(message: string): Promise<void> {
  if (!beginMenuDialog()) return
  const labels = getMenuLabels(menuLocale)
  await showMenuDialog({
    type: 'error',
    buttons: [labels.ok],
    defaultId: 0,
    title: labels.updateErrorTitle,
    message: labels.updateErrorTitle,
    detail: message
  })
  clearMenuUpdateFlow()
}

async function presentUpToDate(version: string): Promise<void> {
  if (!beginMenuDialog()) return
  const labels = getMenuLabels(menuLocale)
  await showMenuDialog({
    type: 'info',
    buttons: [labels.ok],
    defaultId: 0,
    title: labels.updateUpToDateTitle,
    message: labels.updateUpToDateTitle,
    detail: labels.updateUpToDateMessage.replace('{version}', version || app.getVersion())
  })
  clearMenuUpdateFlow()
}

async function presentInstallPrompt(version: string): Promise<void> {
  if (!beginMenuDialog()) return
  const labels = getMenuLabels(menuLocale)
  const result = await showMenuDialog({
    type: 'info',
    buttons: [labels.restartNow, labels.later],
    defaultId: 0,
    cancelId: 1,
    title: labels.updateDownloadedTitle,
    message: labels.updateDownloadedTitle,
    detail: labels.updateDownloadedMessage.replace('{version}', version)
  })
  clearMenuUpdateFlow()
  if (result.response === 0) {
    installAppUpdate()
  }
}

export function onMenuUpdateBusyChange(listener: (busy: boolean) => void): void {
  busyListener = listener
}

export function setMenuUpdateLocale(locale: MenuLocale): void {
  menuLocale = locale
}

function isUpdateCheckEnabled(): boolean {
  return isAppUpdateCheckEnabled({
    isPackaged: app.isPackaged,
    forceDevUpdates: shouldForceDevUpdateConfig()
  })
}

export function configureAutoUpdater(): void {
  if (configured) return
  configured = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info() {
      // Quiet by default: "Checking for update" is expected product noise.
    },
    warn(message?: unknown) {
      console.warn(String(message ?? ''))
    },
    error(message?: unknown) {
      const text = String(message ?? '')
      if (isExpectedUpdateNetworkError(text)) {
        console.warn(`Update check failed (${summarizeUpdateNetworkError(text)})`)
        return
      }
      console.error(text)
    }
  }

  // Unpackaged `npm run dev` must not hit GitHub. Opt in with CRESCENT_DEV_UPDATES=1.
  autoUpdater.forceDevUpdateConfig = shouldForceDevUpdateConfig()

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    lastAvailableInfo = info
    broadcast({
      state: 'available',
      version: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((note) => note.note).join('\n')
            : undefined
    })
    if (!menuUpdateRequested) return
    menuUpdateRequested = false
    menuDownloadRequested = true
    void downloadAppUpdate().then((result) => {
      if (!result.ok) {
        void presentMenuUpdateError(result.error || getMenuLabels(menuLocale).updateErrorTitle)
      }
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    lastAvailableInfo = undefined
    broadcast({
      state: 'not-available',
      version: info.version
    })
    if (menuUpdateRequested) {
      void presentUpToDate(info.version)
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      state: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      state: 'downloaded',
      version: info.version
    })
    if (menuDownloadRequested) {
      void presentInstallPrompt(info.version)
    }
  })

  autoUpdater.on('error', (error) => {
    const message = error?.message || String(error)
    if (isExpectedUpdateNetworkError(message) && !isMenuUpdateFlowActive()) {
      broadcast({ state: 'idle' })
      return
    }
    broadcast({
      state: 'error',
      message
    })
    if (isMenuUpdateFlowActive()) {
      void presentMenuUpdateError(message)
    }
  })
}

export function getAppVersion(): string {
  return app.getVersion()
}

export async function checkForAppUpdates(): Promise<AppUpdateActionResult> {
  configureAutoUpdater()
  if (!isUpdateCheckEnabled()) {
    return { ok: true, skipped: true }
  }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isExpectedUpdateNetworkError(message) && !isMenuUpdateFlowActive()) {
      return { ok: true, skipped: true }
    }
    broadcast({ state: 'error', message })
    return { ok: false, error: message }
  }
}

export async function downloadAppUpdate(): Promise<{ ok: boolean; error?: string }> {
  configureAutoUpdater()
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    broadcast({ state: 'error', message })
    return { ok: false, error: message }
  }
}

export function installAppUpdate(): { ok: boolean; error?: string } {
  configureAutoUpdater()
  try {
    // isSilent=false, isForceRunAfter=true
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    broadcast({ state: 'error', message })
    return { ok: false, error: message }
  }
}

export async function downloadInstallerToDownloads(): Promise<{
  ok: boolean
  path?: string
  error?: string
}> {
  configureAutoUpdater()
  if (!lastAvailableInfo) {
    const result = await checkForAppUpdates()
    if (!result.ok) return result
  }
  if (!lastAvailableInfo) {
    return { ok: false, error: 'No update available' }
  }

  try {
    const { path } = await downloadUpdateInstaller(lastAvailableInfo, (transferred, total) => {
      broadcast({
        state: 'downloading',
        percent: total > 0 ? (transferred / total) * 100 : 0,
        bytesPerSecond: 0,
        transferred,
        total
      })
    })
    broadcast({
      state: 'downloaded',
      version: lastAvailableInfo.version,
      installerPath: path
    })
    return { ok: true, path }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    broadcast({ state: 'error', message })
    return { ok: false, error: message }
  }
}

export async function checkThenDownloadFromMenu(): Promise<void> {
  if (isMenuUpdateFlowActive() || menuDialogPending) return
  configureAutoUpdater()
  if (!isUpdateCheckEnabled()) {
    return
  }
  menuUpdateRequested = true
  setMenuBusy(true)
  const result = await checkForAppUpdates()
  if (result.skipped) {
    clearMenuUpdateFlow()
    return
  }
  if (!result.ok) {
    await presentMenuUpdateError(result.error || getMenuLabels(menuLocale).updateErrorTitle)
  }
}
