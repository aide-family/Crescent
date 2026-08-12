import {
  BrowserWindow,
  Notification,
  dialog,
  ipcMain,
  type RenderProcessGoneDetails
} from 'electron'
import { writeFileSync } from 'fs'

import { writeCrescentDbFlag, readCrescentDbFlag } from './crescent-sqlite'

const CRASH_WINDOW_MS = 60_000
const CRASH_LOOP_THRESHOLD = 3
const MAX_DIAGNOSTIC_LINES = 200

const crashTimestamps: number[] = []
const diagnosticLines: string[] = []
let autoReloadBlocked = false

export function appendRendererDiagnostic(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  diagnosticLines.push(`${new Date().toISOString()} ${trimmed}`)
  while (diagnosticLines.length > MAX_DIAGNOSTIC_LINES) diagnosticLines.shift()
}

export function getRendererRecoveryMode(): 'none' | 'pending' | 'crash-loop' {
  if (readCrescentDbFlag('renderer_recovery_crash_loop')) return 'crash-loop'
  if (readCrescentDbFlag('renderer_recovery_pending')) return 'pending'
  return 'none'
}

export function clearRendererRecoveryFlags(): void {
  writeCrescentDbFlag('renderer_recovery_pending', false)
  writeCrescentDbFlag('renderer_recovery_crash_loop', false)
  autoReloadBlocked = false
}

export function registerRendererRecoveryIpc(_iconPath: string): void {
  ipcMain.handle('app:get-renderer-recovery-mode', () => {
    return { mode: getRendererRecoveryMode() }
  })

  ipcMain.handle('app:clear-renderer-recovery', () => {
    clearRendererRecoveryFlags()
    return { ok: true }
  })

  ipcMain.handle('app:export-renderer-diagnostics', async () => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    const result = await dialog.showSaveDialog(target ?? undefined, {
      title: 'Export Crescent diagnostics',
      defaultPath: `crescent-diagnostics-${Date.now()}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }

    const body = [
      'Crescent renderer diagnostics',
      `exportedAt=${new Date().toISOString()}`,
      `recoveryMode=${getRendererRecoveryMode()}`,
      `autoReloadBlocked=${autoReloadBlocked}`,
      '',
      ...diagnosticLines
    ].join('\n')
    writeFileSync(result.filePath, body, 'utf-8')
    return { ok: true, path: result.filePath }
  })

  ipcMain.on('renderer:diagnostic-error', (_event, payload?: { message?: string }) => {
    const message = String(payload?.message ?? '').slice(0, 2048)
    if (!message) return
    appendRendererDiagnostic(`[renderer-error] ${message}`)
    console.error('[renderer:diagnostic-error]', message)
  })
}

export function attachRendererCrashRecovery(
  mainWindow: BrowserWindow,
  options: {
    iconPath: string
    notifyTitle: string
    notifyBody: string
    loopTitle: string
    loopBody: string
  }
): void {
  mainWindow.webContents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
    handleRendererGone(mainWindow, details, options)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    // Successful load after recovery: keep flags for renderer bootstrap to consume.
  })
}

function handleRendererGone(
  mainWindow: BrowserWindow,
  details: RenderProcessGoneDetails,
  options: {
    iconPath: string
    notifyTitle: string
    notifyBody: string
    loopTitle: string
    loopBody: string
  }
): void {
  const summary = `reason=${details.reason} exitCode=${details.exitCode}`
  console.error('Renderer process gone', details)
  appendRendererDiagnostic(`[render-process-gone] ${summary}`)

  const now = Date.now()
  crashTimestamps.push(now)
  while (crashTimestamps.length > 0 && now - crashTimestamps[0] > CRASH_WINDOW_MS) {
    crashTimestamps.shift()
  }

  if (mainWindow.isDestroyed()) return

  if (crashTimestamps.length >= CRASH_LOOP_THRESHOLD || autoReloadBlocked) {
    autoReloadBlocked = true
    const alreadyCrashLoop = readCrescentDbFlag('renderer_recovery_crash_loop')
    writeCrescentDbFlag('renderer_recovery_pending', false)
    writeCrescentDbFlag('renderer_recovery_crash_loop', true)
    showNotification(options.loopTitle, options.loopBody, options.iconPath)
    // Reload once into diagnostic UI; never loop-reload while already in crash-loop.
    if (!alreadyCrashLoop && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.reload()
    }
    return
  }

  writeCrescentDbFlag('renderer_recovery_crash_loop', false)
  writeCrescentDbFlag('renderer_recovery_pending', true)
  showNotification(options.notifyTitle, options.notifyBody, options.iconPath)
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.reload()
  }
}

function showNotification(title: string, body: string, iconPath: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification(
    process.platform === 'darwin' ? { title, body } : { title, body, icon: iconPath }
  )
  notification.show()
}
