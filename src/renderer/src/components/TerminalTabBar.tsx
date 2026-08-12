import { useEffect, useRef } from 'react'
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
  labelTabs,
  terminalPage,
  activeTabId,
  executionTerminalId,
  agentPending,
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
  labelTabs?: AgentTerminalTab[]
  terminalPage: 'connections' | 'terminal'
  activeTabId: string
  executionTerminalId?: string
  agentPending?: boolean
  tabMenu: TerminalTabMenuState | null
  t: Dictionary
  onNewConnection: () => void
  onSelectTab: (tabId: string) => void
  onOpenTabMenu: (menu: TerminalTabMenuState) => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: (tabId: string) => void
}): React.JSX.Element {
  const titleSource = labelTabs ?? tabs
  const activeTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activeTabId, tabs.length, terminalPage])

  return (
    <div className="app-tabbar flex h-9 shrink-0 items-center gap-1 px-1.5">
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
        <>
          <div
            className="app-tabbar-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden"
            role="tablist"
            aria-label={t.connections.sshConnections}
          >
            {tabs.map((tab) => {
              const selected = terminalPage === 'terminal' && tab.id === activeTabId
              const executing =
                Boolean(agentPending) &&
                Boolean(executionTerminalId) &&
                tab.id === executionTerminalId

              return (
                <button
                  key={tab.id}
                  ref={selected ? activeTabRef : undefined}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`inline-flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-[background-color,border-color,color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    selected
                      ? 'border-primary/50 bg-primary/12 text-foreground'
                      : executing
                        ? 'border-primary/35 bg-primary/8 text-foreground'
                        : 'border-transparent text-muted-foreground hover:border-white/8 hover:bg-white/5 hover:text-foreground'
                  }`}
                  onClick={() => onSelectTab(tab.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onOpenTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
                  }}
                >
                  <TerminalActivityDot
                    active={tab.terminalReady}
                    executing={executing}
                    title={executing ? t.input.sessionTerminalExecuting : undefined}
                  />
                  <span className="truncate">{getTerminalDisplayTitle(tab, titleSource)}</span>
                  {executing && (
                    <span className="shrink-0 text-[10px] font-medium text-primary">
                      {t.app.running}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={t.common.new}
            onClick={onNewConnection}
          >
            <PlusIcon />
          </Button>
        </>
      )}
      {tabMenu && (
        <div
          className="fixed z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-lg overscroll-contain"
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
