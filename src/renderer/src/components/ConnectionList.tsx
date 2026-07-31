import type { ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
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
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="connection-list-header shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.connections.existing}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {filteredConnections.length}/{connections.length}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">{connections.length}</Badge>
            {headerAction}
          </div>
        </div>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t.connections.searchPlaceholder}
            className="h-9 pl-8"
            aria-label={t.connections.searchPlaceholder}
          />
        </div>
      </div>
      <div className="connection-list-scroll min-h-0 flex-1 space-y-2 overflow-auto pt-3">
        {connections.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            {t.connections.noConnections}
          </p>
        ) : filteredConnections.length === 0 ? (
          <p className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
            {t.connections.noSearchResults}
          </p>
        ) : (
          filteredConnections.map((connection) => (
            <div
              key={connection.id}
              className={`rounded-md border bg-card p-3 text-xs shadow-sm transition hover:border-primary/50 hover:bg-muted/20 ${
                selectedConnectionId === connection.id
                  ? 'border-primary/70 bg-background shadow-md shadow-primary/10 ring-1 ring-primary/30'
                  : ''
              }`}
              onClick={() => onSelectConnection?.(connection)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words text-sm font-semibold leading-snug">
                    {connection.name}
                  </p>
                  <p className="break-all font-mono text-[11px] text-muted-foreground">
                    {formatConnectionTarget(connection)}
                  </p>
                  <p className="break-words text-muted-foreground">
                    {connection.source === 'local'
                      ? t.connections.defaultTerminal
                      : connection.source === 'ssh-config'
                        ? '~/.ssh/config'
                        : connection.description || '~/.crescent/config.json'}
                  </p>
                  {showCustomMetadata && connection.source === 'custom' && (
                    <p className="text-muted-foreground">
                      {connection.sshOptions?.length || 0} {t.connections.sshOptionsCount} ·{' '}
                      {connection.actions?.length || 0} {t.connections.actionsCount}
                    </p>
                  )}
                </div>
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
