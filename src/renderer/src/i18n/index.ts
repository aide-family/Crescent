import en from './en'
import zhCN from './zh-CN'

export const dictionaries = {
  en,
  'zh-CN': zhCN
}

export type Locale = keyof typeof dictionaries
export type Dictionary = (typeof dictionaries)[Locale]

export const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' }
]

export function resolveInitialLocale(): Locale {
  const stored = localStorage.getItem('crescent.locale')
  if (stored && stored in dictionaries) return stored as Locale

  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
