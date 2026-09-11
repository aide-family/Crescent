import { LockIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'

export function TerminalLockOverlay({
  commandRunning,
  t,
  onInterrupt
}: {
  commandRunning: boolean
  t: Dictionary
  onInterrupt: () => void
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-1.5">
      <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-primary/40 bg-background/95 px-2 py-1 shadow-sm">
        <LockIcon className="size-3 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-[11px] font-medium text-foreground">{t.terminal.inputLocked}</span>
        <span className="text-[11px] text-muted-foreground">{t.terminal.agentExecuting}</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!commandRunning}
          aria-label={t.terminal.interruptCommand}
          title={t.terminal.interruptCommand}
          onClick={onInterrupt}
        >
          Ctrl+C
        </Button>
      </div>
    </div>
  )
}
