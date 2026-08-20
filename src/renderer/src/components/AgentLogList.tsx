import { useMemo, type RefObject } from 'react'
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  RefreshCwIcon,
  ServerIcon,
  TriangleAlertIcon
} from 'lucide-react'

import { ActionLogRow, AgentLogContent } from '@renderer/components/AgentLogContent'
import { CaptureDraftReadyRow } from '@renderer/components/CaptureDraftPin'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import {
  connectionFailureMarkers,
  formatLogTime,
  isConnectionFailureLog,
  isConnectionStatusText,
  isConversationLog,
  logClassName,
  logListItemSpacingClass,
  logRoleLabel
} from '@renderer/lib/agent-log'
import type { AgentLogEntry, AgentRunViewState } from '@renderer/lib/terminal-tabs'
import type { CaptureKind } from '../../../shared/agent-types'

export function AgentLogList({
  logRef,
  entries,
  tabId,
  liveRunByLogId,
  copiedLogId,
  thinking,
  thinkingMessage,
  thinkingCollapsedByDefault,
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
  savingSopLogId,
  onRetryConnection,
  onReinitTerminal,
  onOpenConnections,
  onAddCommandToWhitelist,
  onInjectSuggestions,
  onOpenModelSettings,
  onSaveAsSop,
  captureReadyLogs = [],
  hiddenCaptureReadyLogIds = [],
  onOpenCaptureDraft,
  hasEarlierLogs,
  loadingEarlier,
  onLoadEarlier
}: {
  logRef: RefObject<HTMLDivElement | null>
  entries: AgentLogEntry[]
  tabId?: string
  liveRunByLogId?: Record<number, AgentRunViewState>
  copiedLogId?: number | null
  thinking?: boolean
  thinkingMessage?: string
  thinkingCollapsedByDefault?: boolean
  connectionRecovery?: {
    visible: boolean
    canRetry: boolean
    connecting?: boolean
    pipeFallback?: boolean
    reason?: string
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
  captureReadyLogs?: Array<{ logId: number; kind: CaptureKind }>
  hiddenCaptureReadyLogIds?: number[]
  onOpenCaptureDraft?: (kind: CaptureKind) => void
  feedbackByLogId?: Record<number, 'like' | 'dislike'>
  feedbackBusyLogId?: number | null
  savingSopLogId?: number | null
  onRetryConnection?: () => void
  onReinitTerminal?: () => void
  onOpenConnections?: () => void
  hasEarlierLogs?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void | Promise<void>
}): React.JSX.Element {
  const markers = connectionFailureMarkers(t)
  const latestFailure = [...entries]
    .reverse()
    .find((entry) => entry.kind === 'error' && isConnectionFailureLog(entry.text, markers))
  const showRecovery = Boolean(connectionRecovery?.visible && latestFailure)
  // Absorb legacy/edge standalone connection status rows into the nearest
  // assistant card so the timeline never renders fragmented system lines.
  const absorbedByAssistantId = useMemo(() => {
    const map = new Map<number, Array<{ id: number; text: string; createdAt: string }>>()
    let currentAssistantId: number | undefined
    for (const entry of entries) {
      if (entry.kind === 'assistant') {
        currentAssistantId = entry.id
        continue
      }
      if (entry.kind === 'status' && isConnectionStatusText(entry.text, t)) {
        if (currentAssistantId !== undefined) {
          const bucket = map.get(currentAssistantId) ?? []
          bucket.push({ id: entry.id, text: entry.text, createdAt: entry.createdAt })
          map.set(currentAssistantId, bucket)
        }
      }
    }
    return map
  }, [entries, t])
  const absorbedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const bucket of absorbedByAssistantId.values()) {
      for (const entry of bucket) ids.add(entry.id)
    }
    return ids
  }, [absorbedByAssistantId])
  const hiddenReadyIds = useMemo(
    () => new Set(hiddenCaptureReadyLogIds),
    [hiddenCaptureReadyLogIds]
  )
  const readyLogById = useMemo(
    () => new Map(captureReadyLogs.map((item) => [item.logId, item.kind])),
    [captureReadyLogs]
  )

  return (
    <div
      ref={logRef}
      className="relative z-0 min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain px-4 pb-4 text-sm"
    >
      {onLoadEarlier && hasEarlierLogs ? (
        <div className="mb-3 flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={loadingEarlier}
            onClick={() => void onLoadEarlier()}
          >
            {loadingEarlier ? t.input.loadingEarlierLogs : t.input.loadEarlierLogs}
          </Button>
        </div>
      ) : null}
      {entries.length === 0 && !thinking ? (
        <div className="mt-10 rounded-xl border border-dashed border-border/60 bg-muted/10 px-5 py-8 text-center">
          <div className="text-sm font-medium text-pretty text-foreground">
            {t.input.emptyConversationTitle}
          </div>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pretty text-muted-foreground">
            {t.input.emptyConversationHint}
          </p>
        </div>
      ) : null}

      {entries
        .filter((entry) => entry.kind !== 'user-supplement')
        .filter((entry) => !(entry.kind === 'status' && absorbedIds.has(entry.id)))
        .filter((entry) => !hiddenReadyIds.has(entry.id))
        .map((entry, entryIndex, visibleEntries) => {
          const previousKind = entryIndex > 0 ? visibleEntries[entryIndex - 1]?.kind : undefined
          const conversation = isConversationLog(entry.kind)
          const spacing = logListItemSpacingClass(entry.kind, previousKind, entryIndex === 0)
          const readyKind = readyLogById.get(entry.id)

          return (
            <div
              key={entry.id}
              data-agent-log-entry={entry.id}
              data-log-kind={entry.kind}
              className={
                conversation
                  ? `${logClassName(entry.kind)} min-w-0 ${spacing}`
                  : `min-w-0 ${spacing}`
              }
            >
              {conversation ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-medium text-foreground/70">
                        {logRoleLabel(entry.kind, t)}
                      </span>
                      <time
                        className="tabular-nums text-muted-foreground/70"
                        dateTime={entry.createdAt}
                      >
                        {formatLogTime(entry.createdAt)}
                      </time>
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
                    tabId={tabId}
                    t={t}
                    copied={copiedLogId === entry.id}
                    feedbackRating={feedbackByLogId?.[entry.id] ?? null}
                    feedbackBusy={feedbackBusyLogId === entry.id}
                    savingSop={savingSopLogId === entry.id}
                    absorbedStatusEntries={
                      entry.kind === 'assistant' ? absorbedByAssistantId.get(entry.id) : undefined
                    }
                    thinkingCollapsedByDefault={thinkingCollapsedByDefault}
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
              ) : readyKind && onOpenCaptureDraft ? (
                <CaptureDraftReadyRow
                  text={entry.text}
                  createdAt={entry.createdAt}
                  t={t}
                  onOpen={() => onOpenCaptureDraft(readyKind)}
                />
              ) : (
                <ActionLogRow entry={entry} t={t} />
              )}
            </div>
          )
        })}

      {showRecovery ? (
        <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {connectionRecovery?.connecting ? (
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <TriangleAlertIcon className="size-3.5 text-amber-500" aria-hidden="true" />
            )}
            <span>{t.input.connectionRecoveryTitle}</span>
          </div>
          {connectionRecovery?.connecting ? (
            <p className="mt-1 text-xs text-muted-foreground">{t.input.retryConnecting}</p>
          ) : connectionRecovery?.pipeFallback ? (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t.input.reinitTerminalHint}
              </p>
              {connectionRecovery.reason ? (
                <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground/80">
                  {connectionRecovery.reason}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t.input.connectionRecoveryHint}
              </p>
              {connectionRecovery?.reason ? (
                <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground/80">
                  {connectionRecovery.reason}
                </p>
              ) : null}
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {connectionRecovery?.connecting ? null : connectionRecovery?.pipeFallback ? (
              <Button type="button" size="sm" onClick={onReinitTerminal}>
                <RefreshCwIcon data-icon="inline-start" />
                {t.input.reinitTerminal}
              </Button>
            ) : connectionRecovery?.canRetry && onRetryConnection ? (
              <Button type="button" size="sm" onClick={onRetryConnection}>
                <RefreshCwIcon data-icon="inline-start" />
                {t.input.retryConnection}
              </Button>
            ) : null}
            {onOpenConnections ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onOpenConnections}
                disabled={connectionRecovery?.connecting}
              >
                <ServerIcon data-icon="inline-start" />
                {t.input.openConnections}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {thinking ? (
        <div className="mt-3 flex items-start gap-2 px-0.5 text-xs text-muted-foreground">
          <span className="mt-1.5 inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="font-medium text-foreground/80">{t.input.thinking}</div>
            <p className="mt-0.5 leading-relaxed">
              {thinkingMessage || t.input.thinkingAnalyzingRequest}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
