import { useEffect, useState } from 'react'
import { HardDriveIcon, ServerIcon, TriangleAlertIcon } from 'lucide-react'

import type { Dictionary } from '@renderer/i18n'

type Identity = Awaited<ReturnType<typeof window.api.terminal.getContext>>

/** Main owns target identity. Renderer only formats the typed context it receives. */
export function TerminalIdentity({
  tabId,
  t,
  compact = false
}: {
  tabId: string
  t: Dictionary
  compact?: boolean
}): React.JSX.Element {
  const [identity, setIdentity] = useState<Identity | null>(null)

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.api.terminal
        .getContext(tabId)
        .then((context) => {
          if (active) setIdentity(context)
        })
        .catch(() => {
          if (active) setIdentity(null)
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 1500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [tabId])

  if (!identity?.paneId)
    return <span className="text-muted-foreground">{t.terminal.targetUnknown}</span>

  const ssh = identity.executionMode === 'ssh'
  const phase = identity.connectionPhase
  const warning = ssh && phase !== 'ssh-ready'
  const observed = identity.observedHost
  const target =
    identity.targetScope === 'cluster'
      ? identity.clusterHostRegex || identity.expectedTarget
      : identity.expectedTarget
  const manualSsh = identity.connectionOrigin === 'manual-shell' && identity.manualSshActive
  const owner =
    identity.owner === 'user'
      ? t.terminal.ownerUser
      : identity.owner === 'agent'
        ? t.terminal.ownerAgent
        : identity.owner
  const status =
    phase === 'ssh-restoring'
      ? t.terminal.targetRestoring
      : phase === 'ssh-connecting'
        ? t.terminal.targetConnecting
        : phase === 'ssh-lost'
          ? t.terminal.targetDisconnected
          : phase === 'ssh-degraded'
            ? t.terminal.targetDegraded
            : undefined
  const location = ssh
    ? manualSsh
      ? observed || t.terminal.targetUnknown
      : [identity.connectionName, target].filter(Boolean).join(' / ') || t.terminal.targetUnknown
    : t.terminal.targetLocal
  const observedLabel =
    observed === 'local-shell'
      ? t.terminal.targetLocal
      : identity.returnToJumpHost
        ? `${t.terminal.targetJumpHost}: ${observed}`
        : observed
  const full = [
    identity.paneRole === 'subterminal' ? t.terminal.subterminal : t.terminal.mainTerminal,
    owner,
    manualSsh ? t.terminal.manualSsh : ssh ? 'SSH' : t.terminal.targetLocal,
    location,
    status,
    warning && observedLabel ? `${t.terminal.targetUnknown}: ${observedLabel}` : undefined,
    identity.monitorPolicy === 'special' ? identity.sshHopChain?.join(' → ') : undefined
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 text-[11px] ${warning ? 'text-amber-500' : 'text-muted-foreground'}`}
      title={full}
      aria-label={full}
    >
      {warning ? (
        <TriangleAlertIcon className="size-3 shrink-0" aria-hidden="true" />
      ) : ssh ? (
        <ServerIcon className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <HardDriveIcon className="size-3 shrink-0" aria-hidden="true" />
      )}
      {!compact && (
        <span className="shrink-0 font-medium">
          {identity.paneRole === 'subterminal' ? t.terminal.subterminal : t.terminal.mainTerminal}
        </span>
      )}
      {owner && <span className="max-w-28 shrink-0 truncate">{owner}</span>}
      <span className="shrink-0">
        {manualSsh ? t.terminal.manualSsh : ssh ? 'SSH' : t.terminal.targetLocal}
      </span>
      {ssh && identity.connectionName && (
        <span className="min-w-0 truncate">{identity.connectionName}</span>
      )}
      {ssh && (
        <span className="max-w-[45%] shrink-0 truncate font-medium">
          {manualSsh ? observed || location : target || location}
        </span>
      )}
      {status && <span className="shrink-0 font-medium">{status}</span>}
      {warning && observedLabel && <span className="min-w-0 truncate">{observedLabel}</span>}
    </div>
  )
}
