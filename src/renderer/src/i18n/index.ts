import en from './en'
import zhCN from './zh-CN'

export const dictionaries = {
  en,
  'zh-CN': zhCN
}

export type Locale = keyof typeof dictionaries
export type Dictionary = (typeof dictionaries)[Locale]

export const localeOptions: Array<{ value: Locale; label: string; shortLabel: string }> = [
  { value: 'zh-CN', label: '中文', shortLabel: '中' },
  { value: 'en', label: 'English', shortLabel: 'EN' }
]

export function nextLocale(current: Locale): Locale {
  const index = localeOptions.findIndex((option) => option.value === current)
  const next = localeOptions[(index + 1) % localeOptions.length]
  return next?.value ?? current
}

export function resolveInitialLocale(): Locale {
  const stored = localStorage.getItem('crescent.locale')
  if (stored && stored in dictionaries) return stored as Locale

  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
