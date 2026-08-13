export type MenuLocale = 'zh-CN' | 'en'

export interface MenuLabels {
  appName: string
  about: string
  checkForUpdates: string
  settings: string
  edit: string
  undo: string
  redo: string
  cut: string
  copy: string
  paste: string
  selectAll: string
  view: string
  toggleDevTools: string
  window: string
  minimize: string
  zoom: string
  close: string
  bringAllToFront: string
  quit: string
  hide: string
  hideOthers: string
  showAll: string
  updateUpToDateTitle: string
  updateUpToDateMessage: string
  updateErrorTitle: string
  updateDownloadedTitle: string
  updateDownloadedMessage: string
  restartNow: string
  later: string
  ok: string
}

const zhCN: MenuLabels = {
  appName: 'Crescent',
  about: '关于 Crescent',
  checkForUpdates: '检查后更新',
  settings: '设置',
  edit: '编辑',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
  view: '显示',
  toggleDevTools: '开发者工具',
  window: '窗口',
  minimize: '最小化',
  zoom: '缩放',
  close: '关闭',
  bringAllToFront: '前置全部窗口',
  quit: '退出 Crescent',
  hide: '隐藏 Crescent',
  hideOthers: '隐藏其他',
  showAll: '显示全部',
  updateUpToDateTitle: '已是最新版本',
  updateUpToDateMessage: '当前已是最新版本（{version}）。',
  updateErrorTitle: '更新失败',
  updateDownloadedTitle: '更新已就绪',
  updateDownloadedMessage: '新版本 {version} 已下载完成。立即重启以完成安装？',
  restartNow: '立即重启',
  later: '稍后',
  ok: '好'
}

const en: MenuLabels = {
  appName: 'Crescent',
  about: 'About Crescent',
  checkForUpdates: 'Check for Updates',
  settings: 'Settings',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  view: 'View',
  toggleDevTools: 'Toggle Developer Tools',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  close: 'Close',
  bringAllToFront: 'Bring All to Front',
  quit: 'Quit Crescent',
  hide: 'Hide Crescent',
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  updateUpToDateTitle: "You're up to date",
  updateUpToDateMessage: 'Crescent {version} is the latest version.',
  updateErrorTitle: 'Update failed',
  updateDownloadedTitle: 'Update ready',
  updateDownloadedMessage: 'Version {version} has been downloaded. Restart now to install it?',
  restartNow: 'Restart Now',
  later: 'Later',
  ok: 'OK'
}

const dictionaries: Record<MenuLocale, MenuLabels> = {
  'zh-CN': zhCN,
  en
}

export function normalizeMenuLocale(locale: unknown): MenuLocale {
  if (typeof locale !== 'string' || !locale.trim()) return 'en'
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function getMenuLabels(locale: MenuLocale | string | unknown): MenuLabels {
  return dictionaries[normalizeMenuLocale(locale)]
}
