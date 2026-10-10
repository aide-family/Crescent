import { APP_THEME_IDS, APP_THEMES, type AppThemeId } from './theme-definitions'
export type { AppThemeId } from './theme-definitions'

export const APP_THEME_STORAGE_KEY = 'crescent.app-theme'
export const APP_THEME_CHANGE_EVENT = 'crescent-theme-change'
export const APP_THEME_OPTIONS = APP_THEME_IDS.map((id) => ({
  id,
  accent: APP_THEMES[id].meta.accent
}))
let currentTheme: AppThemeId | undefined

function storedTheme(): AppThemeId {
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY)
    return APP_THEME_IDS.find((id) => id === stored) ?? 'crescent'
  } catch {
    return 'crescent'
  }
}

export function readAppTheme(): AppThemeId {
  return (currentTheme ??= storedTheme())
}

function applyAppThemeAttribute(theme: AppThemeId): void {
  const root = document.documentElement
  root.classList.add('dark')
  if (theme === 'crescent') root.removeAttribute('data-crescent-theme')
  else root.setAttribute('data-crescent-theme', theme)
}

export function initializeAppTheme(): void {
  applyAppThemeAttribute(readAppTheme())
}

export function saveAppTheme(theme: AppThemeId): void {
  if (!APP_THEME_IDS.includes(theme)) return
  const previous = readAppTheme()
  currentTheme = theme
  applyAppThemeAttribute(theme)
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
  } catch {
    // Keep the current session theme if storage is unavailable.
  }
  if (previous !== theme)
    window.dispatchEvent(new CustomEvent(APP_THEME_CHANGE_EVENT, { detail: { theme } }))
}

export function subscribeAppTheme(listener: () => void): () => void {
  window.addEventListener(APP_THEME_CHANGE_EVENT, listener)
  return () => window.removeEventListener(APP_THEME_CHANGE_EVENT, listener)
}
