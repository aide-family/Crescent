import type { JSX } from 'react'
import { TerminalIcon } from 'lucide-react'

export function ProductLogo(): JSX.Element {
  return (
    <div
      className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
      aria-hidden="true"
    >
      <TerminalIcon aria-hidden="true" />
    </div>
  )
}
