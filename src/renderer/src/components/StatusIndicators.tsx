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
      ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
      : message.type === 'error'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

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
      ? 'bg-green-500 shadow-green-500/40'
      : state === 'pending'
        ? 'bg-yellow-400 shadow-yellow-400/40'
        : 'bg-red-500 shadow-red-500/40'

  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full shadow-[0_0_8px] ${className}`}
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

export function TerminalActivityDot({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${
        active ? 'bg-green-500 shadow-[0_0_8px] shadow-green-500/50' : 'bg-muted-foreground/30'
      }`}
      aria-hidden="true"
    />
  )
}
