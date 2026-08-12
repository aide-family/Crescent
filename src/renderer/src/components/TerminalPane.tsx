import type { RefObject } from 'react'
import { ServerIcon, TriangleAlertIcon, XIcon } from 'lucide-react'

import { ConnectionList } from '@renderer/components/ConnectionList'
import {
  SubterminalPanel,
  type SubterminalHeightResizeState,
  type SubterminalResizeState
} from '@renderer/components/SubterminalPanel'
import { TerminalTabBar, type TerminalTabMenuState } from '@renderer/components/TerminalTabBar'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { AgentTerminalTab } from '@renderer/lib/terminal-tabs'
import type { ConnectionConfig } from '../../../shared/agent-types'

export function TerminalPane({
  widthPercent,
  fillWidth,
  terminalTabs,
  labelTabs,
  terminalPage,
  activeTabId,
  executionTerminalId,
  agentPending,
  activeTab,
  tabMenu,
  displayConnections,
  filteredDisplayConnections,
  connectionSearchQuery,
  terminalHostRef,
  subterminalCollapsed,
  subterminalPanelHeight,
  subterminalResizeRef,
  subterminalHeightResizeRef,
  connectionRecovery,
  t,
  formatConnectionTarget,
  onNewConnection,
  onSelectTab,
  onOpenTabMenu,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onConnectionQueryChange,
  onShowConnectionList,
  onConnect,
  onSubterminalCollapsedChange,
  onCloseSubterminal,
  onCloseAllSubterminals,
  onOpenLocalSubterminal,
  onViewRecovery,
  onDismissRecovery
}: {
  widthPercent: number
  fillWidth: boolean
  terminalTabs: AgentTerminalTab[]
  labelTabs: AgentTerminalTab[]
  terminalPage: 'connections' | 'terminal'
  activeTabId: string
  executionTerminalId?: string
  agentPending?: boolean
  activeTab: AgentTerminalTab
  tabMenu: TerminalTabMenuState | null
  displayConnections: ConnectionConfig[]
  filteredDisplayConnections: ConnectionConfig[]
  connectionSearchQuery: string
  terminalHostRef: RefObject<HTMLDivElement | null>
  subterminalCollapsed: boolean
  subterminalPanelHeight: number
  subterminalResizeRef: React.MutableRefObject<SubterminalResizeState | null>
  subterminalHeightResizeRef: React.MutableRefObject<SubterminalHeightResizeState | null>
  connectionRecovery?: {
    visible: boolean
    canRetry: boolean
    connecting?: boolean
    pipeFallback?: boolean
    reason?: string
    dismissed?: boolean
  }
  t: Dictionary
  formatConnectionTarget: (connection: ConnectionConfig) => string
  onNewConnection: () => void
  onSelectTab: (tabId: string) => void
  onOpenTabMenu: (menu: TerminalTabMenuState) => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: (tabId: string) => void
  onConnectionQueryChange: (query: string) => void
  onShowConnectionList: () => void
  onConnect: (connection: ConnectionConfig) => void
  onSubterminalCollapsedChange: (collapsed: boolean) => void
  onCloseSubterminal: (parentTabId: string, subterminalId: string) => void
  onCloseAllSubterminals: (parentTabId: string) => void
  onOpenLocalSubterminal?: () => void
  onViewRecovery?: () => void
  onDismissRecovery?: () => void
}): React.JSX.Element {
  const showTerminalRecovery = Boolean(
    connectionRecovery?.visible && terminalTabs.length > 0 && !activeTab.terminalReady
  )

  return (
    <div
      className="app-terminal-pane flex min-h-0 flex-col"
      style={{ width: fillWidth ? '100%' : `${widthPercent}%` }}
    >
      <TerminalTabBar
        tabs={terminalTabs}
        labelTabs={labelTabs}
        terminalPage={terminalPage}
        activeTabId={activeTabId}
        executionTerminalId={executionTerminalId}
        agentPending={agentPending}
        tabMenu={tabMenu}
        t={t}
        onNewConnection={onNewConnection}
        onSelectTab={onSelectTab}
        onOpenTabMenu={onOpenTabMenu}
        onCloseTab={onCloseTab}
        onCloseOtherTabs={onCloseOtherTabs}
        onCloseAllTabs={onCloseAllTabs}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {terminalTabs.length === 0 ? (
          <div className="min-h-0 flex-1 bg-background/80 p-4">
            <ConnectionList
              className="mx-auto h-full max-w-3xl"
              connections={displayConnections}
              filteredConnections={filteredDisplayConnections}
              query={connectionSearchQuery}
              t={t}
              formatConnectionTarget={formatConnectionTarget}
              onQueryChange={onConnectionQueryChange}
              headerAction={
                <Button type="button" variant="outline" size="sm" onClick={onShowConnectionList}>
                  <ServerIcon data-icon="inline-start" />
                  {t.connections.manageConnections}
                </Button>
              }
              renderConnectionActions={(connection) => (
                <Button
                  type="button"
                  size="icon-xs"
                  aria-label={t.connections.connect}
                  title={t.connections.connect}
                  onClick={() => onConnect(connection)}
                >
                  <ServerIcon aria-hidden="true" />
                </Button>
              )}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {showTerminalRecovery && !connectionRecovery?.dismissed ? (
              <div className="flex shrink-0 items-center gap-2 border-b bg-background/95 px-3 py-1.5 text-xs">
                <TriangleAlertIcon
                  className="size-3.5 shrink-0 text-amber-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t.terminal.terminalRecoveryBanner}
                </span>
                {onViewRecovery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={onViewRecovery}
                  >
                    {t.terminal.terminalRecoveryView}
                  </Button>
                ) : null}
                {onDismissRecovery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.terminal.terminalRecoveryDismiss}
                    title={t.terminal.terminalRecoveryDismiss}
                    onClick={onDismissRecovery}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
              <div ref={terminalHostRef} className="terminal-canvas absolute inset-0" />
            </div>
          </div>
        )}
        <SubterminalPanel
          activeTab={activeTab}
          collapsed={subterminalCollapsed}
          panelHeight={subterminalPanelHeight}
          resizeRef={subterminalResizeRef}
          heightResizeRef={subterminalHeightResizeRef}
          t={t}
          onCollapsedChange={onSubterminalCollapsedChange}
          onCloseSubterminal={onCloseSubterminal}
          onCloseAllSubterminals={onCloseAllSubterminals}
          onOpenLocalSubterminal={onOpenLocalSubterminal}
        />
      </div>
    </div>
  )
}
