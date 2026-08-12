import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react'

export type SkillManageMessage = {
  type: 'info' | 'success' | 'error'
  text: string
}

export type SkillInstallLogStatus = 'running' | 'success' | 'error'

export function SkillInstallStatusDot({
  status
}: {
  status: SkillInstallLogStatus
}): React.JSX.Element {
  if (status === 'running') {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent"
        aria-hidden="true"
      />
    )
  }

  if (status === 'error') {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
        aria-hidden="true"
      >
        <XIcon className="size-3" />
      </span>
    )
  }

  return (
    <span
      className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"
      aria-hidden="true"
    >
      <CheckIcon className="size-3" />
    </span>
  )
}

export function SkillManageStatus({
  message
}: {
  message: SkillManageMessage | null
}): React.JSX.Element | null {
  if (!message) return null

  const className =
    message.type === 'success'
      ? 'border-primary/35 bg-primary/8 text-foreground'
      : message.type === 'error'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border/70 bg-muted/20 text-muted-foreground'

  return (
    <pre
      className={`select-text max-h-32 overflow-auto rounded-md border p-2 text-xs leading-relaxed whitespace-pre-wrap ${className}`}
    >
      {message.text}
    </pre>
  )
}

export function StatusDot({
  state,
  title
}: {
  state: 'ready' | 'pending' | 'not-ready'
  title?: string
}): React.JSX.Element {
  const className =
    state === 'ready'
      ? 'bg-green-500'
      : state === 'pending'
        ? 'bg-yellow-400'
        : 'bg-red-500'

  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${className}`}
      title={title}
      aria-label={title}
    />
  )
}

export function McpStatusDot({
  status,
  title
}: {
  status: 'ready' | 'pending' | 'not-ready'
  title?: string
}): React.JSX.Element {
  if (status === 'ready') {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"
        title={title}
      >
        <CheckIcon className="size-3" aria-hidden="true" />
      </span>
    )
  }

  if (status === 'pending') {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-yellow-950"
        title={title}
      >
        <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
      title={title}
    >
      <XIcon className="size-3" aria-hidden="true" />
    </span>
  )
}

export function TerminalActivityDot({
  active,
  executing = false,
  title
}: {
  active: boolean
  executing?: boolean
  title?: string
}): React.JSX.Element {
  const className = executing
    ? 'bg-primary ring-1 ring-primary/50'
    : active
      ? 'bg-green-500'
      : 'bg-muted-foreground/30'

  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${className}`}
      title={title}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  )
}
