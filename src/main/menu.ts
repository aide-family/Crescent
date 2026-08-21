import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getMenuLabels, normalizeMenuLocale, type MenuLocale } from '../shared/menu-labels'
import { safeWebContentsSend } from './safe-ipc-send'
import {
  checkThenDownloadFromMenu,
  onMenuUpdateBusyChange,
  setMenuUpdateLocale
} from './update/updater'
import { isAppUpdateCheckEnabled, shouldForceDevUpdateConfig } from './update/update-policy'

const CHECK_FOR_UPDATES_MENU_ID = 'check-for-updates'

let currentLocale: MenuLocale = 'en'
let checkForUpdatesEnabled = true
let installed = false

function canCheckForUpdates(): boolean {
  return isAppUpdateCheckEnabled({
    isPackaged: app.isPackaged,
    forceDevUpdates: shouldForceDevUpdateConfig()
  })
}

function applyApplicationMenu(): void {
  const labels = getMenuLabels(currentLocale)
  setMenuUpdateLocale(currentLocale)
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(labels))
  Menu.setApplicationMenu(menu)
}

function setCheckForUpdatesMenuEnabled(enabled: boolean): void {
  checkForUpdatesEnabled = enabled
  const item = Menu.getApplicationMenu()?.getMenuItemById(CHECK_FOR_UPDATES_MENU_ID)
  if (item) {
    item.enabled = enabled && canCheckForUpdates()
    return
  }
  applyApplicationMenu()
}

export function openSettingsFromMenu(): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!target) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  safeWebContentsSend(target.webContents, 'app:open-settings')
}

export function setApplicationMenuLocale(locale: unknown): MenuLocale {
  const next = normalizeMenuLocale(locale)
  if (next === currentLocale && installed) return currentLocale
  currentLocale = next
  applyApplicationMenu()
  return currentLocale
}

export function configureAboutPanel(iconPath: string): void {
  app.setAboutPanelOptions({
    applicationName: 'Crescent',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © 2026 Crescent',
    website: 'https://github.com/aide-family/Crescent',
    iconPath
  })
}

export function registerMenuIpc(): void {
  ipcMain.handle('app:set-locale', (_event, locale: unknown) => {
    const next = setApplicationMenuLocale(locale)
    return { ok: true as const, locale: next }
  })
}

export function installApplicationMenu(): void {
  currentLocale = normalizeMenuLocale(app.getLocale())
  if (!installed) {
    onMenuUpdateBusyChange((busy) => {
      setCheckForUpdatesMenuEnabled(!busy)
    })
    installed = true
  }
  applyApplicationMenu()
}

export function buildApplicationMenuTemplate(
  labels = getMenuLabels(currentLocale)
): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions = {
    label: labels.appName,
    submenu: [
      {
        label: labels.about,
        click: (): void => {
          app.showAboutPanel()
        }
      },
      { type: 'separator' },
      {
        id: CHECK_FOR_UPDATES_MENU_ID,
        label: labels.checkForUpdates,
        enabled: checkForUpdatesEnabled && canCheckForUpdates(),
        click: (): void => {
          void checkThenDownloadFromMenu()
        }
      },
      { type: 'separator' },
      {
        label: labels.settings,
        accelerator: 'CommandOrControl+,',
        click: (): void => {
          openSettingsFromMenu()
        }
      },
      ...(process.platform === 'darwin'
        ? ([
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: labels.hide },
            { role: 'hideOthers', label: labels.hideOthers },
            { role: 'unhide', label: labels.showAll },
            { type: 'separator' },
            { role: 'quit', label: labels.quit }
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { type: 'separator' },
            { role: 'quit', label: labels.quit }
          ] satisfies MenuItemConstructorOptions[]))
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: labels.edit,
    submenu: [
      { role: 'undo', label: labels.undo },
      { role: 'redo', label: labels.redo },
      { type: 'separator' },
      { role: 'cut', label: labels.cut },
      { role: 'copy', label: labels.copy },
      { role: 'paste', label: labels.paste },
      { role: 'selectAll', label: labels.selectAll }
    ]
  }

  const viewMenu: MenuItemConstructorOptions | null = is.dev
    ? {
        label: labels.view,
        submenu: [{ role: 'toggleDevTools', label: labels.toggleDevTools }]
      }
    : null

  const windowMenu: MenuItemConstructorOptions = {
    label: labels.window,
    submenu:
      process.platform === 'darwin'
        ? [
            { role: 'minimize', label: labels.minimize },
            { role: 'zoom', label: labels.zoom },
            { type: 'separator' },
            { role: 'front', label: labels.bringAllToFront }
          ]
        : [
            { role: 'minimize', label: labels.minimize },
            { role: 'close', label: labels.close }
          ]
  }

  return viewMenu ? [appMenu, editMenu, viewMenu, windowMenu] : [appMenu, editMenu, windowMenu]
}
