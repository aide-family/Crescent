import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function queryFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.closest('[aria-hidden="true"]')
  )
}

export function useAppModalA11y(
  open: boolean,
  options: {
    onEscape?: () => void
    panelRef?: RefObject<HTMLElement | null>
  } = {}
): RefObject<HTMLDivElement | null> {
  const overlayRef = useRef<HTMLDivElement>(null)
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    if (!open) return

    const { onEscape, panelRef } = optionsRef.current
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const panel =
      panelRef?.current ??
      overlayRef.current?.querySelector<HTMLElement>('.app-modal-panel') ??
      overlayRef.current

    if (panel) {
      const focusables = queryFocusables(panel)
      ;(focusables[0] ?? panel).focus()
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const focusables = queryFocusables(panel)
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus?.()
    }
  }, [open])

  return overlayRef
}
