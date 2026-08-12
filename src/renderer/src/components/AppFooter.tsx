import { StatusDot } from '@renderer/components/StatusIndicators'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { AgentConfig } from '../../../shared/agent-types'
import type { AgentTerminalTab } from '@renderer/lib/terminal-tabs'
import { RefreshCwIcon } from 'lucide-react'

export function AppFooter({
  shellState,
  disconnected = false,
  activeTab,
  agentMode,
  t,
  onRetryShell
}: {
  shellState: 'ready' | 'pending' | 'not-ready'
  disconnected?: boolean
  activeTab: AgentTerminalTab
  agentMode: AgentConfig['agentMode']
  t: Dictionary
  onRetryShell?: () => void
}): React.JSX.Element {
  const modeLabel = agentMode === 'plan-execute' ? 'Plan-and-Execute' : 'ReAct'
  const failed = shellState === 'not-ready' && Boolean(activeTab.terminalStartError?.trim())
  const statusLabel = disconnected
    ? t.app.shellDisconnected
    : shellState === 'ready'
      ? `${t.app.shellReady} · ${activeTab.terminalMode.toUpperCase()}`
      : shellState === 'pending'
        ? t.app.shellStarting
        : failed
          ? t.app.shellFailed
          : t.app.shellStopped
  const dotState: 'ready' | 'pending' | 'not-ready' = disconnected ? 'pending' : shellState

  return (
    <footer className="app-footer flex h-9 shrink-0 items-center justify-between gap-3 px-4 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-2 truncate">
        <StatusDot state={dotState} />
        <span className="truncate" title={activeTab.terminalStartError || undefined}>
          {statusLabel}
          {failed && activeTab.terminalStartError ? ` · ${activeTab.terminalStartError}` : null}
        </span>
        <span className="truncate text-muted-foreground/70">
          {t.app.workingDirectory}: {activeTab.terminalCwd || '...'}
        </span>
        {failed && onRetryShell ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={onRetryShell}
          >
            <RefreshCwIcon data-icon="inline-start" className="size-3" />
            {t.app.shellRetry}
          </Button>
        ) : null}
      </span>
      <span className="shrink-0 text-muted-foreground/80" title={t.settings.agentMode}>
        {t.settings.agentMode}: {modeLabel}
      </span>
    </footer>
  )
}
