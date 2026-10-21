import { useAppTheme } from '@renderer/hooks/useAppTheme'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { CheckIcon, PaletteIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { APP_THEME_OPTIONS, saveAppTheme, type AppThemeId } from '@renderer/lib/app-theme'
import type { Dictionary } from '@renderer/i18n'

const THEME_LABEL_KEYS = {
  crescent: 'themeOriginal',
  'night-shift': 'themeNightShift',
  'route-survey': 'themeRouteSurvey',
  'ink-signal': 'themeInkSignal'
} as const satisfies Record<AppThemeId, keyof Dictionary['app']>

export function ThemeSwitcher({ t }: { t: Dictionary }): ReactElement {
  const selectedTheme = useAppTheme()
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

    rootRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus()
    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const chooseTheme = (theme: AppThemeId): void => {
    saveAppTheme(theme)
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
        aria-haspopup="dialog"
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
        className="absolute top-full right-0 z-50 mt-2 w-[284px] rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        role="dialog"
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
              onKeyDown={(event) => {
                const buttons = Array.from(
                  rootRef.current?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? []
                )
                const index = buttons.indexOf(event.currentTarget)
                const next =
                  event.key === 'ArrowDown'
                    ? (index + 1) % buttons.length
                    : event.key === 'ArrowUp'
                      ? (index + buttons.length - 1) % buttons.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? buttons.length - 1
                          : -1
                if (next >= 0) {
                  event.preventDefault()
                  buttons[next]?.focus()
                }
              }}
              onClick={() => chooseTheme(theme.id)}
            >
              <span className="app-theme-preview" data-crescent-theme={theme.id} aria-hidden="true">
                <span className="app-theme-preview-terminal">&gt;_</span>
                <span className="app-theme-preview-panel">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {isSelected ? <CheckIcon className="size-4 text-primary" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
