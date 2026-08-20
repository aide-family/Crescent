import { Loader2Icon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import {
  capturePinIsActionable,
  capturePinLabel,
  type CaptureDraftPhase
} from '@renderer/lib/capture-draft-ui'
import { formatLogTime } from '@renderer/lib/agent-log'
import type { CaptureKind } from '../../../shared/agent-types'

export function CaptureDraftPin({
  kind,
  phase,
  hasContent,
  t,
  onOpen
}: {
  kind: CaptureKind
  phase: CaptureDraftPhase
  hasContent: boolean
  t: Dictionary
  onOpen: () => void
}): React.JSX.Element {
  const generating = phase === 'generating'
  const actionable = capturePinIsActionable(phase, hasContent)

  return (
    <div className="flex h-8 items-center gap-2 border-l-2 border-primary bg-primary/8 px-2.5 text-[11px]">
      {generating ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-foreground">
        {capturePinLabel(kind, phase, t)}
      </span>
      {actionable ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 px-2 text-primary"
          onClick={onOpen}
        >
          {t.capture.pinOpen}
        </Button>
      ) : null}
    </div>
  )
}

export function CaptureDraftReadyRow({
  text,
  createdAt,
  t,
  onOpen
}: {
  text: string
  createdAt: string
  t: Dictionary
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md border-l-2 border-primary bg-primary/8 px-2.5 py-1.5 text-left text-[11px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{text}</span>
      <time className="shrink-0 tabular-nums text-muted-foreground/80" dateTime={createdAt}>
        {formatLogTime(createdAt)}
      </time>
      <span className="shrink-0 text-primary">{t.capture.pinOpen}</span>
    </button>
  )
}
