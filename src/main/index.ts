import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerTerminalIpc, stopAllTerminalSessions } from './terminal/ipc'

installWarningFilter()
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

function createWindow(): void {
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  const [
    { registerAgentIpc },
    { registerConnectionIpc },
    { initializeCrescentDatabase },
    { registerStorageIpc }
  ] = await Promise.all([
    import('./agent/ipc'),
    import('./connections/ipc'),
    import('./crescent-sqlite'),
    import('./storage/ipc')
  ])

  app.setName('Crescent')
  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  if (process.platform === 'darwin') {
    console.info('GPU feature status:', app.getGPUFeatureStatus())
  }
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
  initializeCrescentDatabase()
  registerAgentIpc()
  registerConnectionIpc()
  registerStorageIpc()
  registerTerminalIpc()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
