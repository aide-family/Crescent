import { useEffect, useRef, useState, type ReactElement } from 'react'
import { CheckIcon, PaletteIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  APP_THEME_OPTIONS,
  readAppTheme,
  saveAppTheme,
  type AppThemeId
} from '@renderer/lib/app-theme'
import type { Dictionary } from '@renderer/i18n'

const THEME_LABEL_KEYS = {
  crescent: 'themeOriginal',
  'night-shift': 'themeNightShift',
  'route-survey': 'themeRouteSurvey',
  'ink-signal': 'themeInkSignal'
} as const satisfies Record<AppThemeId, keyof Dictionary['app']>

export function ThemeSwitcher({ t }: { t: Dictionary }): ReactElement {
  const [selectedTheme, setSelectedTheme] = useState<AppThemeId>(readAppTheme)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const themeLabel = t.app.themeSwitcher

  useEffect(() => {
    if (!open) return

    const closeWhenOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const chooseTheme = (theme: AppThemeId): void => {
    saveAppTheme(theme)
    setSelectedTheme(theme)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="relative" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t.app.themeSwitcher}
        title={t.app.themeSwitcher}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="app-theme-menu"
        onClick={() => setOpen((current) => !current)}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
        }}
      >
        <PaletteIcon aria-hidden="true" />
      </Button>
      <div
        id="app-theme-menu"
        hidden={!open}
        className="absolute top-full right-0 z-50 mt-2 w-60 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        role="group"
        aria-label={themeLabel}
      >
        <p className="px-2.5 pt-1.5 pb-2 text-xs font-medium text-muted-foreground">{themeLabel}</p>
        {APP_THEME_OPTIONS.map((theme) => {
          const label = t.app[THEME_LABEL_KEYS[theme.id]]
          const isSelected = selectedTheme === theme.id
          return (
            <button
              key={theme.id}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={isSelected}
              onClick={() => chooseTheme(theme.id)}
            >
              <span
                className="size-3 shrink-0 rounded-full border border-white/20"
                style={{ backgroundColor: theme.accent }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {isSelected ? <CheckIcon className="size-4 text-primary" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
