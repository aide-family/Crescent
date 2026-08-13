import { useEffect, useRef, type KeyboardEvent } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { TerminalActivityDot } from '@renderer/components/StatusIndicators'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { getTerminalDisplayTitle, type AgentTerminalTab } from '@renderer/lib/terminal-tabs'

export interface TerminalTabMenuState {
  tabId: string
  x: number
  y: number
}

function focusTerminalTab(tabId: string): void {
  document
    .querySelector<HTMLButtonElement>(`[data-terminal-tab-id="${CSS.escape(tabId)}"]`)
    ?.focus()
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
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    activeTabRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activeTabId, tabs.length, terminalPage])

  function moveSelection(currentId: string, direction: 1 | -1): void {
    const index = tabs.findIndex((tab) => tab.id === currentId)
    if (index < 0) return
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (!next) return
    onSelectTab(next.id)
    focusTerminalTab(next.id)
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: AgentTerminalTab): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveSelection(tab.id, 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveSelection(tab.id, -1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      const first = tabs[0]
      if (first) {
        onSelectTab(first.id)
        focusTerminalTab(first.id)
      }
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      const last = tabs[tabs.length - 1]
      if (last) {
        onSelectTab(last.id)
        focusTerminalTab(last.id)
      }
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onCloseTab(tab.id)
    }
  }

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
            className="app-tabbar-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-contain"
            role="tablist"
            aria-label={t.connections.sshConnections}
          >
            {tabs.map((tab) => {
              const selected = terminalPage === 'terminal' && tab.id === activeTabId
              const executing =
                Boolean(agentPending) &&
                Boolean(executionTerminalId) &&
                tab.id === executionTerminalId
              const title = getTerminalDisplayTitle(tab, titleSource)

              return (
                <div key={tab.id} className="group relative shrink-0">
                  <button
                    ref={selected ? activeTabRef : undefined}
                    type="button"
                    role="tab"
                    data-terminal-tab-id={tab.id}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    title={title}
                    className={`inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border py-0 pr-6 pl-2 text-xs transition-[background-color,border-color,color] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                      selected
                        ? 'border-primary/50 bg-primary/12 text-foreground'
                        : executing
                          ? 'border-primary/35 bg-primary/8 text-foreground'
                          : 'border-transparent text-muted-foreground hover:border-white/8 hover:bg-white/5 hover:text-foreground'
                    }`}
                    onClick={() => onSelectTab(tab.id)}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return
                      event.preventDefault()
                      onCloseTab(tab.id)
                    }}
                    onKeyDown={(event) => handleTabKeyDown(event, tab)}
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
                    <span className="truncate">{title}</span>
                    {executing && (
                      <span className="shrink-0 text-[10px] font-medium text-primary">
                        {t.app.running}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`absolute top-1/2 right-1 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none transition-[background-color,color,opacity] hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 ${
                      selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    aria-label={`${t.common.closeTab}: ${title}`}
                    title={t.common.closeTab}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={t.common.new}
            title={t.common.new}
            onClick={onNewConnection}
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        </>
      )}
      {tabMenu && (
        <div
          className="fixed z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-lg overscroll-contain"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onCloseTab(tabMenu.tabId)}
          >
            {t.common.closeTab}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onCloseOtherTabs(tabMenu.tabId)}
          >
            {t.common.closeOtherTabs}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-md px-2 py-1.5 text-left text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onCloseAllTabs(tabMenu.tabId)}
          >
            {t.common.closeAllTabs}
          </button>
        </div>
      )}
    </div>
  )
}
