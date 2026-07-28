import { StatusDot } from '@renderer/components/StatusIndicators'
import type { Dictionary } from '@renderer/i18n'
import type { AgentTerminalTab } from '@renderer/lib/terminal-tabs'

export function AppFooter({
  shellState,
  activeTab,
  t
}: {
  shellState: 'ready' | 'pending' | 'not-ready'
  activeTab: AgentTerminalTab
  t: Dictionary
}): React.JSX.Element {
  return (
    <footer className="app-footer flex h-9 shrink-0 items-center px-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <StatusDot state={shellState} />
        {shellState === 'ready'
          ? `${t.app.shellReady} · ${activeTab.terminalMode.toUpperCase()}`
          : shellState === 'pending'
            ? t.app.shellStarting
            : t.app.shellStopped}
        <span className="text-muted-foreground/70">
          {t.app.workingDirectory}: {activeTab.terminalCwd || '...'}
        </span>
      </span>
    </footer>
  )
}
