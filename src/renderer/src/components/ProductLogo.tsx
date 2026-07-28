import type { JSX } from 'react'
import { TerminalIcon } from 'lucide-react'

export function ProductLogo(): JSX.Element {
  return (
    <div
      className="relative flex size-9 items-center justify-center overflow-hidden rounded-md border border-white/15 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
      aria-hidden="true"
    >
      <span className="absolute inset-y-1 left-1 w-1 rounded-full bg-[var(--app-copper)]/90" />
      <TerminalIcon className="relative size-[18px]" aria-hidden="true" />
    </div>
  )
}
