import { PlusIcon } from 'lucide-react'

import { TerminalActivityDot } from '@renderer/components/StatusIndicators'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { getTerminalDisplayTitle, type AgentTerminalTab } from '@renderer/lib/terminal-tabs'

export interface TerminalTabMenuState {
  tabId: string
  x: number
  y: number
}

export function TerminalTabBar({
  tabs,
  terminalPage,
  activeTabId,
  tabMenu,
  t,
  onNewConnection,
  onSelectTab,
  onOpenTabMenu,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs
}: {
  tabs: AgentTerminalTab[]
  terminalPage: 'connections' | 'terminal'
  activeTabId: string
  tabMenu: TerminalTabMenuState | null
  t: Dictionary
  onNewConnection: () => void
  onSelectTab: (tabId: string) => void
  onOpenTabMenu: (menu: TerminalTabMenuState) => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: (tabId: string) => void
}): React.JSX.Element {
  return (
    <div className="app-tabbar flex h-10 shrink-0 items-center gap-1 px-2">
      {tabs.length === 0 ? (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">
            {t.connections.sshConnections}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onNewConnection}>
            <PlusIcon data-icon="inline-start" />
            {t.common.new}
          </Button>
        </div>
      ) : (
        tabs.map((tab) => {
          const selected = terminalPage === 'terminal' && tab.id === activeTabId

          return (
            <button
              key={tab.id}
              type="button"
              aria-selected={selected}
              className={`inline-flex h-7 max-w-40 items-center gap-1.5 rounded-md border px-2 text-xs transition ${
                selected
                  ? 'border-primary/70 bg-primary/15 text-foreground shadow-sm ring-1 ring-primary/40'
                  : 'border-transparent text-muted-foreground hover:border-white/10 hover:bg-muted/40 hover:text-foreground'
              }`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                onOpenTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
              }}
            >
              <TerminalActivityDot active={tab.terminalReady} />
              <span className="truncate">{getTerminalDisplayTitle(tab)}</span>
            </button>
          )
        })
      )}
      {tabMenu && (
        <div
          className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onCloseTab(tabMenu.tabId)}
          >
            {t.common.closeTab}
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            onClick={() => onCloseOtherTabs(tabMenu.tabId)}
          >
            {t.common.closeOtherTabs}
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            onClick={() => onCloseAllTabs(tabMenu.tabId)}
          >
            {t.common.closeAllTabs}
          </button>
        </div>
      )}
    </div>
  )
}
