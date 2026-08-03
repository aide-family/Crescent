import type { RefObject } from 'react'
import { RefreshCwIcon, ServerIcon } from 'lucide-react'

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
  onRetryConnection
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
  onRetryConnection?: () => void
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
          <div className="relative min-h-0 flex-1">
            <div ref={terminalHostRef} className="terminal-canvas absolute inset-0" />
            {showTerminalRecovery ? (
              <div className="absolute inset-x-3 bottom-3 z-10 rounded-md border border-destructive/30 bg-background/95 px-3 py-3 shadow-sm backdrop-blur">
                <div className="text-sm font-medium text-foreground">
                  {t.terminal.connectionRecoveryTitle}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.terminal.connectionRecoveryHint}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {connectionRecovery?.canRetry && onRetryConnection ? (
                    <Button type="button" size="sm" onClick={onRetryConnection}>
                      <RefreshCwIcon data-icon="inline-start" />
                      {t.input.retryConnection}
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" onClick={onShowConnectionList}>
                    <ServerIcon data-icon="inline-start" />
                    {t.input.openConnections}
                  </Button>
                </div>
              </div>
            ) : null}
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
        />
      </div>
    </div>
  )
}
