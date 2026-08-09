import type { RefObject } from 'react'
import { CheckIcon, CopyIcon, RefreshCwIcon, ServerIcon } from 'lucide-react'

import { ActionLogRow, AgentLogContent } from '@renderer/components/AgentLogContent'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import {
  connectionFailureMarkers,
  formatLogTime,
  isConnectionFailureLog,
  isConversationLog,
  logClassName,
  logListItemSpacingClass,
  logRoleLabel
} from '@renderer/lib/agent-log'
import type { AgentLogEntry, AgentRunViewState } from '@renderer/lib/terminal-tabs'

export function AgentLogList({
  logRef,
  entries,
  liveRunByLogId,
  copiedLogId,
  thinking,
  thinkingMessage,
  connectionRecovery,
  t,
  onCopyEntry,
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace,
  onOpsFeedback,
  onResolveApproval,
  feedbackByLogId,
  feedbackBusyLogId,
  onRetryConnection,
  onOpenConnections,
  onAddCommandToWhitelist,
  onInjectSuggestions,
  onOpenModelSettings,
  onSaveAsSop
}: {
  logRef: RefObject<HTMLDivElement | null>
  entries: AgentLogEntry[]
  liveRunByLogId?: Record<number, AgentRunViewState>
  copiedLogId?: number | null
  thinking?: boolean
  thinkingMessage?: string
  connectionRecovery?: {
    visible: boolean
    canRetry: boolean
  }
  t: Dictionary
  onCopyEntry: (entry: AgentLogEntry) => void
  onCopyResult: (entry: AgentLogEntry) => void
  onExportResult: (entry: AgentLogEntry) => void
  onExportFull: (entry: AgentLogEntry) => void
  onExportTrace: (entry: AgentLogEntry) => void
  onOpsFeedback: (entry: AgentLogEntry, rating: 'like' | 'dislike') => void
  onResolveApproval?: (requestId: string, approved: boolean, note?: string) => void
  onAddCommandToWhitelist?: (command: string) => void
  onInjectSuggestions?: (texts: string[]) => void
  onOpenModelSettings?: () => void
  onSaveAsSop?: (entry: AgentLogEntry) => void
  feedbackByLogId?: Record<number, 'like' | 'dislike'>
  feedbackBusyLogId?: number | null
  onRetryConnection?: () => void
  onOpenConnections?: () => void
}): React.JSX.Element {
  const markers = connectionFailureMarkers(t)
  const latestFailure = [...entries]
    .reverse()
    .find((entry) => entry.kind === 'error' && isConnectionFailureLog(entry.text, markers))
  const showRecovery = Boolean(connectionRecovery?.visible && latestFailure)

  return (
    <div
      ref={logRef}
      className="relative z-0 min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-4 text-sm"
    >
      {entries.length === 0 && !thinking ? (
        <div className="mt-8 rounded-lg border border-dashed border-border/70 bg-muted/15 px-4 py-6 text-center">
          <div className="text-sm font-medium text-foreground">
            {t.input.emptyConversationTitle}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t.input.emptyConversationHint}
          </p>
        </div>
      ) : null}

      {entries
        .filter((entry) => entry.kind !== 'user-supplement')
        .map((entry, entryIndex, visibleEntries) => {
        const previousKind = entryIndex > 0 ? visibleEntries[entryIndex - 1]?.kind : undefined
        const conversation = isConversationLog(entry.kind)
        const spacing = logListItemSpacingClass(entry.kind, previousKind, entryIndex === 0)

        return (
          <div
            key={entry.id}
            data-agent-log-entry={entry.id}
            data-log-kind={entry.kind}
            className={
              conversation ? `${logClassName(entry.kind)} min-w-0 ${spacing}` : `min-w-0 ${spacing}`
            }
          >
            {conversation ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-semibold tracking-wide text-foreground/80">
                      {logRoleLabel(entry.kind, t)}
                    </span>
                    <time dateTime={entry.createdAt}>{formatLogTime(entry.createdAt)}</time>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.common.copySelectionOrMessage}
                      title={t.common.copySelectionOrMessage}
                      onClick={() => onCopyEntry(entry)}
                    >
                      {copiedLogId === entry.id ? (
                        <CheckIcon aria-hidden="true" />
                      ) : (
                        <CopyIcon aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                <AgentLogContent
                  entry={entry}
                  liveRun={liveRunByLogId?.[entry.id]}
                  t={t}
                  copied={copiedLogId === entry.id}
                  feedbackRating={feedbackByLogId?.[entry.id] ?? null}
                  feedbackBusy={feedbackBusyLogId === entry.id}
                  onCopyResult={() => onCopyResult(entry)}
                  onExportResult={() => onExportResult(entry)}
                  onExportFull={() => onExportFull(entry)}
                  onExportTrace={() => onExportTrace(entry)}
                  onOpsFeedback={(rating) => onOpsFeedback(entry, rating)}
                  onResolveApproval={onResolveApproval}
                  onAddCommandToWhitelist={onAddCommandToWhitelist}
                  onInjectSuggestions={onInjectSuggestions}
                  onOpenModelSettings={onOpenModelSettings}
                  onSaveAsSop={onSaveAsSop ? () => onSaveAsSop(entry) : undefined}
                />
              </>
            ) : (
              <ActionLogRow entry={entry} t={t} />
            )}
          </div>
        )
      })}

      {showRecovery ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
          <div className="text-sm font-medium text-foreground">
            {t.input.connectionRecoveryTitle}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t.input.connectionRecoveryHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {connectionRecovery?.canRetry && onRetryConnection ? (
              <Button type="button" size="sm" onClick={onRetryConnection}>
                <RefreshCwIcon data-icon="inline-start" />
                {t.input.retryConnection}
              </Button>
            ) : null}
            {onOpenConnections ? (
              <Button type="button" size="sm" variant="outline" onClick={onOpenConnections}>
                <ServerIcon data-icon="inline-start" />
                {t.input.openConnections}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {thinking ? (
        <div className="mt-3 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
            {t.input.thinking}
          </div>
          <p className="mt-1 leading-relaxed">
            {thinkingMessage || t.input.thinkingAnalyzingRequest}
          </p>
        </div>
      ) : null}
    </div>
  )
}
