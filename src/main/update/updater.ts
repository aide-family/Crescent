import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import { safeWebContentsSend } from '../safe-ipc-send'
import type { AppUpdateStatusEvent } from '../../shared/update-types'

let configured = false

function broadcast(event: AppUpdateStatusEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    safeWebContentsSend(window.webContents, 'update:status', event)
  }
}

export function configureAutoUpdater(): void {
  if (configured) return
  configured = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // In development, electron-updater reads dev-app-update.yml next to the project.
  autoUpdater.forceDevUpdateConfig = is.dev

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
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
  })

  autoUpdater.on('update-not-available', (info) => {
    broadcast({
      state: 'not-available',
      version: info.version
    })
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
  })

  autoUpdater.on('error', (error) => {
    broadcast({
      state: 'error',
      message: error?.message || String(error)
    })
  })
}

export function getAppVersion(): string {
  return app.getVersion()
}

export async function checkForAppUpdates(): Promise<{ ok: boolean; error?: string }> {
  configureAutoUpdater()
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
