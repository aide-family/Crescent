export const APP_THEME_STORAGE_KEY = 'crescent.app-theme'

export const APP_THEME_OPTIONS = [
  { id: 'crescent', accent: '#13c2c2' },
  { id: 'night-shift', accent: '#b8e454' },
  { id: 'route-survey', accent: '#34c8c4' },
  { id: 'ink-signal', accent: '#ff5c56' }
] as const

export type AppThemeId = (typeof APP_THEME_OPTIONS)[number]['id']

export function readAppTheme(): AppThemeId {
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY)
    return APP_THEME_OPTIONS.find((theme) => theme.id === stored)?.id ?? 'crescent'
  } catch {
    return 'crescent'
  }
}

function applyAppThemeAttribute(theme: AppThemeId): void {
  const root = document.documentElement
  root.classList.add('dark')

  if (theme === 'crescent') {
    root.removeAttribute('data-crescent-theme')
    return
  }

  root.setAttribute('data-crescent-theme', theme)
}

export function initializeAppTheme(): void {
  applyAppThemeAttribute(readAppTheme())
}

export function saveAppTheme(theme: AppThemeId): void {
  applyAppThemeAttribute(theme)

  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
  } catch {
    // Keep the current session theme if local storage is unavailable.
  }
}
