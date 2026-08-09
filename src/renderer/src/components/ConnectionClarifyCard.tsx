import { useEffect, useMemo, useState } from 'react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { PendingAgentClarification } from '@renderer/lib/terminal-tabs'

export function ConnectionClarifyCard({
  clarification,
  t,
  onConfirm,
  onDismiss
}: {
  clarification: PendingAgentClarification
  t: Dictionary
  onConfirm: (label: string) => void
  onDismiss: () => void
}): React.JSX.Element | null {
  const options = useMemo(() => clarification.options ?? [], [clarification.options])
  const defaultIndex = useMemo(() => {
    if (options.length === 0) return 0
    const id = clarification.defaultOptionId
    if (!id) return 0
    const index = options.findIndex((option) => option.id === id)
    return index >= 0 ? index : 0
  }, [clarification.defaultOptionId, options])

  const [selectedIndex, setSelectedIndex] = useState(defaultIndex)

  useEffect(() => {
    if (options.length === 0) return

    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const inEditable =
        target != null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)

      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
        return
      }
      if (inEditable) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => (current + 1) % options.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => (current - 1 + options.length) % options.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const selected = options[selectedIndex]
        if (selected) onConfirm(selected.label)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onConfirm, onDismiss, options, selectedIndex])

  if (options.length === 0) return null

  return (
    <div
      className="mx-3 mb-2 space-y-2 rounded-md border border-border/50 bg-background/60 px-3 py-2"
      role="listbox"
      aria-label={t.terminal.clarifySelectConnection}
    >
      <div className="text-[11px] font-medium text-foreground/80">
        {t.terminal.clarifySelectConnection}
      </div>
      <ul className="space-y-1">
        {options.map((option, index) => {
          const selected = index === selectedIndex
          return (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[12px] ${
                  selected
                    ? 'bg-amber-500/15 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40'
                }`}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => onConfirm(option.label)}
              >
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-current opacity-70" />
                <span className="min-w-0">{option.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => {
            const selected = options[selectedIndex]
            if (selected) onConfirm(selected.label)
          }}
        >
          {t.terminal.clarifyConfirm}
        </Button>
        <span className="text-[10px] text-muted-foreground">{t.terminal.clarifyHintKeyboard}</span>
      </div>
    </div>
  )
}
