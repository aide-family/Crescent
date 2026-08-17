import { app, shell, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerTerminalIpc, stopAllTerminalSessions } from './terminal/ipc'
import {
  appendRendererDiagnostic,
  attachRendererCrashRecovery,
  registerRendererRecoveryIpc
} from './renderer-recovery'
import { normalizeAttentionNotifyPayload } from '../shared/attention-notify'

let stopAttachmentCleanup: (() => void) | undefined

installWarningFilter()
installNativeLogFilter()
configureGpuPolicy()

function configureGpuPolicy(): void {
  const shouldDisableGpu =
    process.env.CRESCENT_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')
  const shouldEnableExperimentalGpuFlags =
    process.env.CRESCENT_EXPERIMENTAL_GPU_FLAGS === '1' ||
    process.argv.includes('--enable-crescent-gpu-flags')

  if (shouldDisableGpu) {
    app.disableHardwareAcceleration()
    return
  }

  // Reduce Chromium compositor tile OOM warnings on large terminal canvases.
  app.commandLine.appendSwitch('force-gpu-mem-available-mb', '4096')

  if (shouldEnableExperimentalGpuFlags) {
    app.commandLine.appendSwitch('enable-gpu-rasterization')
    app.commandLine.appendSwitch('enable-zero-copy')
  }
}

function installWarningFilter(): void {
  const originalEmitWarning = process.emitWarning.bind(process)

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const warningMessage = typeof warning === 'string' ? warning : warning.message
    const warningType =
      typeof args[0] === 'string'
        ? args[0]
        : typeof warning === 'object' && 'name' in warning
          ? warning.name
          : ''
    const isKnownSqliteWarning =
      warningType === 'ExperimentalWarning' &&
      warningMessage.includes('SQLite is an experimental feature')

    if (isKnownSqliteWarning) return
    ;(originalEmitWarning as (...parameters: unknown[]) => void)(warning, ...args)
  }) as typeof process.emitWarning
}

function installNativeLogFilter(): void {
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk)
    const isKnownMacInputMethodNoise =
      text.includes('TSM AdjustCapsLockLEDForKeyTransitionHandling') ||
      text.includes('error messaging the mach port for IMKCFRunLoopWakeUpReliable')
    const isKnownChromiumTileMemoryNoise = text.includes('tile memory limits exceeded')
    const isDisposedRenderFrameNoise =
      text.includes('Error sending from webFrameMain') ||
      text.includes('Render frame was disposed before WebFrameMain could be accessed')

    if (
      isKnownMacInputMethodNoise ||
      isKnownChromiumTileMemoryNoise ||
      isDisposedRenderFrameNoise
    ) {
      return true
    }
    return (originalWrite as (...parameters: unknown[]) => boolean)(chunk, ...args)
  }) as typeof process.stderr.write
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Renderer failed to load', { errorCode, errorDescription, validatedURL })
      appendRendererDiagnostic(
        `[did-fail-load] code=${errorCode} ${errorDescription} url=${validatedURL}`
      )
    }
  )
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level !== 'warning' && event.level !== 'error') return
    console.error(
      `[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`
    )
    appendRendererDiagnostic(`[renderer:${event.level}] ${event.message}`.slice(0, 500))
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === 'media')
    }
  )
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  const [
    { registerAgentIpc },
    { registerConnectionIpc },
    { startAttachmentCleanupScheduler },
    { initializeCrescentDatabase },
    { registerStorageIpc },
    { registerUpdateIpc },
    { configureAboutPanel, installApplicationMenu, registerMenuIpc }
  ] = await Promise.all([
    import('./agent/ipc'),
    import('./connections/ipc'),
    import('./attachment-cleanup'),
    import('./crescent-sqlite'),
    import('./storage/ipc'),
    import('./update/ipc'),
    import('./menu')
  ])

  app.setName('Crescent')
  configureAboutPanel(icon)
  registerMenuIpc()
  installApplicationMenu()
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU') {
      console.warn('GPU process gone', details)
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.crescent.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('app:notify-attention', (event, payload?: unknown) => {
    const normalized = normalizeAttentionNotifyPayload(payload)
    if (!Notification.isSupported()) return { ok: false }

    const notification = new Notification(
      process.platform === 'darwin'
        ? { title: normalized.title, body: normalized.body }
        : { title: normalized.title, body: normalized.body, icon }
    )
    const requester = BrowserWindow.fromWebContents(event.sender)
    const clickTarget = {
      pendingId: normalized.pendingId,
      tabId: normalized.tabId,
      chatTabId: normalized.chatTabId
    }
    notification.on('click', () => {
      const target =
        (requester && !requester.isDestroyed() ? requester : null) ??
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows()[0] ??
        null
      if (!target || target.isDestroyed()) return
      if (target.isMinimized()) target.restore()
      target.show()
      target.focus()
      target.webContents.send('app:attention-clicked', clickTarget)
    })
    notification.show()
    return { ok: true }
  })
  ipcMain.handle('app:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url.trim()) return { ok: false }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false }
      await shell.openExternal(parsed.toString())
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })
  initializeCrescentDatabase()
  registerRendererRecoveryIpc(icon)
  const { ensureDefaultInstructionFiles } = await import('./agent/instruction-files')
  ensureDefaultInstructionFiles()
  registerAgentIpc()
  registerConnectionIpc()
  registerStorageIpc()
  registerTerminalIpc()
  registerUpdateIpc()
  stopAttachmentCleanup = startAttachmentCleanupScheduler()

  const mainWindow = createWindow()
  attachRendererCrashRecovery(mainWindow, {
    iconPath: icon,
    notifyTitle: 'Crescent',
    notifyBody: 'Renderer recovered after a crash. Recent session will be restored when available.',
    loopTitle: 'Crescent',
    loopBody: 'Renderer crashed repeatedly. Auto-reload stopped; open the diagnostic panel.'
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createWindow()
      attachRendererCrashRecovery(window, {
        iconPath: icon,
        notifyTitle: 'Crescent',
        notifyBody:
          'Renderer recovered after a crash. Recent session will be restored when available.',
        loopTitle: 'Crescent',
        loopBody: 'Renderer crashed repeatedly. Auto-reload stopped; open the diagnostic panel.'
      })
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  stopAllTerminalSessions()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAttachmentCleanup?.()
  stopAttachmentCleanup = undefined
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
