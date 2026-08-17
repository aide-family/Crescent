import type { KeyboardEvent, ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'

import { Input } from '@renderer/components/ui/input'
import type { Dictionary } from '@renderer/i18n'
import type { ConnectionConfig } from '../../../shared/agent-types'

interface ConnectionListProps {
  connections: ConnectionConfig[]
  filteredConnections: ConnectionConfig[]
  query: string
  selectedConnectionId?: string
  t: Dictionary
  className?: string
  headerAction?: ReactNode
  showCustomMetadata?: boolean
  formatConnectionTarget: (connection: ConnectionConfig) => string
  onQueryChange: (query: string) => void
  onSelectConnection?: (connection: ConnectionConfig) => void
  renderConnectionActions: (connection: ConnectionConfig) => ReactNode
}

function connectionSourceLabel(connection: ConnectionConfig, t: Dictionary): string {
  if (connection.source === 'local') return t.connections.defaultTerminal
  if (connection.source === 'ssh-config') return '~/.ssh/config'
  return connection.description || '~/.crescent/config.json'
}

function ConnectionIdentity({
  connection,
  formatConnectionTarget,
  showCustomMetadata,
  t
}: {
  connection: ConnectionConfig
  formatConnectionTarget: (connection: ConnectionConfig) => string
  showCustomMetadata: boolean
  t: Dictionary
}): React.JSX.Element {
  return (
    <>
      <p className="truncate text-[13px] font-medium leading-snug">{connection.name}</p>
      <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatConnectionTarget(connection)}
      </p>
      <p className="truncate text-[10px] text-muted-foreground/90">
        {connectionSourceLabel(connection, t)}
        {showCustomMetadata && connection.source === 'custom'
          ? ` · ${connection.sshOptions?.length || 0} ${t.connections.sshOptionsCount} · ${connection.actions?.length || 0} ${t.connections.actionsCount}`
          : ''}
      </p>
    </>
  )
}

function focusConnectionIdentity(connectionId: string): void {
  const node = document.querySelector<HTMLButtonElement>(
    `[data-connection-id="${CSS.escape(connectionId)}"]`
  )
  node?.focus()
}

export function ConnectionList({
  connections,
  filteredConnections,
  query,
  selectedConnectionId,
  t,
  className = '',
  headerAction,
  showCustomMetadata = false,
  formatConnectionTarget,
  onQueryChange,
  onSelectConnection,
  renderConnectionActions
}: ConnectionListProps): React.JSX.Element {
  function moveSelection(currentId: string, direction: 1 | -1): void {
    if (!onSelectConnection) return
    const index = filteredConnections.findIndex((item) => item.id === currentId)
    const next = filteredConnections[index + direction]
    if (!next) return
    onSelectConnection(next)
    focusConnectionIdentity(next.id)
  }

  function handleIdentityKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    connection: ConnectionConfig
  ): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(connection.id, 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(connection.id, -1)
    }
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="connection-list-header shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="app-section-label">{t.connections.existing}</h3>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              {filteredConnections.length}/{connections.length}
            </p>
          </div>
          {headerAction ? (
            <div className="flex shrink-0 items-center gap-2">{headerAction}</div>
          ) : null}
        </div>
        <div className="app-search-field">
          <SearchIcon aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t.connections.searchPlaceholder}
            aria-label={t.connections.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="connection-list-scroll min-h-0 flex-1 space-y-1 overflow-auto overscroll-contain pt-2">
        {connections.length === 0 ? (
          <p className="app-empty-state">{t.connections.noConnections}</p>
        ) : filteredConnections.length === 0 ? (
          <p className="app-empty-state">{t.connections.noSearchResults}</p>
        ) : (
          filteredConnections.map((connection) => (
            <div
              key={connection.id}
              data-selected={selectedConnectionId === connection.id ? 'true' : undefined}
              className="app-list-row text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                {onSelectConnection ? (
                  <button
                    type="button"
                    data-connection-id={connection.id}
                    className="min-w-0 flex-1 space-y-0.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => onSelectConnection(connection)}
                    onKeyDown={(event) => handleIdentityKeyDown(event, connection)}
                  >
                    <ConnectionIdentity
                      connection={connection}
                      formatConnectionTarget={formatConnectionTarget}
                      showCustomMetadata={showCustomMetadata}
                      t={t}
                    />
                  </button>
                ) : (
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <ConnectionIdentity
                      connection={connection}
                      formatConnectionTarget={formatConnectionTarget}
                      showCustomMetadata={showCustomMetadata}
                      t={t}
                    />
                  </div>
                )}
                <div
                  className="flex shrink-0 items-start gap-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  {renderConnectionActions(connection)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
