import { StatusDot } from '@renderer/components/StatusIndicators'
import type { Dictionary } from '@renderer/i18n'
import type { AgentConfig } from '../../../shared/agent-types'
import type { AgentTerminalTab } from '@renderer/lib/terminal-tabs'

export function AppFooter({
  shellState,
  activeTab,
  agentMode,
  t
}: {
  shellState: 'ready' | 'pending' | 'not-ready'
  activeTab: AgentTerminalTab
  agentMode: AgentConfig['agentMode']
  t: Dictionary
}): React.JSX.Element {
  const modeLabel = agentMode === 'plan-execute' ? 'Plan-and-Execute' : 'ReAct'

  return (
    <footer className="app-footer flex h-9 shrink-0 items-center justify-between gap-3 px-4 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-2 truncate">
        <StatusDot state={shellState} />
        {shellState === 'ready'
          ? `${t.app.shellReady} · ${activeTab.terminalMode.toUpperCase()}`
          : shellState === 'pending'
            ? t.app.shellStarting
            : t.app.shellStopped}
        <span className="truncate text-muted-foreground/70">
          {t.app.workingDirectory}: {activeTab.terminalCwd || '...'}
        </span>
      </span>
      <span className="shrink-0 text-muted-foreground/80" title={t.settings.agentMode}>
        {t.settings.agentMode}: {modeLabel}
      </span>
    </footer>
  )
}
