import {
  FullAgentRunOverlay,
  type FullAgentRunOverlayTab
} from '@renderer/components/FullAgentRunOverlay'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { QuotaErrorCard } from '@renderer/components/QuotaErrorCard'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { ParsedAgentRunDocument } from '@renderer/lib/agent-run-document'
import {
  omitDuplicateTrailingMessage,
  shouldShowAgentRunResult
} from '@renderer/lib/agent-run-document'
import { hasAgentTextTruncationMarker } from '@renderer/lib/agent-text-limits'
import {
  BookMarkedIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  Loader2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useState } from 'react'
import type { OpsHistoryRating } from '../../../shared/agent-types'
import { sortTimelineBySeq } from '../../../shared/connection-state'
import { ApprovalStepCard } from './timeline/ApprovalStepCard'
import { ConnectionFlowGroup, LoginResultCard } from './timeline/ConnectionRows'
import {
  coalesceVisiblePtyToolSteps,
  formatDuration,
  groupTimelineSteps,
  hasConnectionFlowFinished,
  isNoiseStatusStep,
  resolveActivity
} from './timeline/helpers'
import { MessageStepRow, ThoughtStepRow, UserSupplementStepRow } from './timeline/MessageRows'
import { ResultActionBar, ResultSuggestionsPicker } from './timeline/ResultActions'
import { CollapsedLowRiskGroup, ToolCallRow } from './timeline/ToolRows'
export { groupTimelineSteps } from './timeline/helpers'
export type { TimelineItem } from './timeline/helpers'

export function AgentRunTimeline({
  document,
  t,
  copied,
  feedbackRating,
  feedbackBusy,
  savingSop,
  storageRef,
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace,
  onOpsFeedback,
  onResolveApproval,
  onAddCommandToWhitelist,
  onInjectSuggestions,
  onOpenModelSettings,
  onSaveAsSop,
  onInterruptCommand,
  onFocusTerminal,
  fallbackExecutionTabId,
  thinkingCollapsedByDefault = true
}: {
  document: ParsedAgentRunDocument
  t: Dictionary
  copied: boolean
  feedbackRating?: OpsHistoryRating | null
  feedbackBusy?: boolean
  savingSop?: boolean
  /** When set, finished runs can open the on-demand full process/result overlay. */
  storageRef?: { tabId: string; logId: number; runId?: string }
  onCopyResult?: () => void
  onExportResult?: () => void
  onExportFull?: () => void
  onExportTrace?: () => void
  onOpsFeedback?: (rating: OpsHistoryRating) => void
  onResolveApproval?: (requestId: string, approved: boolean, note?: string) => void
  onAddCommandToWhitelist?: (command: string) => void
  onInjectSuggestions?: (texts: string[]) => void
  onOpenModelSettings?: () => void
  onSaveAsSop?: () => void
  onInterruptCommand?: (tabId: string) => void
  onFocusTerminal?: (tabId: string) => void
  fallbackExecutionTabId?: string
  thinkingCollapsedByDefault?: boolean
}): React.JSX.Element {
  const [fullOverlayTab, setFullOverlayTab] = useState<FullAgentRunOverlayTab | null>(null)
  const runFinished =
    typeof document.elapsedMs === 'number' || Boolean(document.errorMarkdown?.trim())
  const hasApprovalStep = document.steps.some((step) => step.kind === 'approval')
  const visibleSteps = omitDuplicateTrailingMessage(
    sortTimelineBySeq(
      coalesceVisiblePtyToolSteps(
        document.steps.filter((step) => !isNoiseStatusStep(step, t, hasApprovalStep))
      )
    ),
    document.resultMarkdown
  )
  const timelineItems = groupTimelineSteps(visibleSteps, t)
  const hasResultContent = Boolean(
    document.resultMarkdown?.trim() || document.errorMarkdown?.trim()
  )
  const loginMeta = document.loginMeta
  const loginFinished = Boolean(loginMeta && typeof document.elapsedMs === 'number')
  // Formal Result chrome only after the run finishes — mid-run prose lives in message steps.
  const showResult = shouldShowAgentRunResult({
    hasResultContent,
    elapsedMs: document.elapsedMs
  })
  const resultBodyMarkdown = document.resultMarkdown?.trim() ?? ''
  const errorBodyMarkdown = document.errorMarkdown?.trim() ?? ''
  const resultTruncated = hasAgentTextTruncationMarker(resultBodyMarkdown)
  const errorTruncated = hasAgentTextTruncationMarker(errorBodyMarkdown)
  const canOpenFullRun = Boolean(storageRef && runFinished)
  const activity = resolveActivity(document, visibleSteps, t)
  const showActivity = Boolean(activity) && !runFinished && !loginMeta
  return (
    <div className="app-agent-run min-w-0 space-y-2.5">
      {timelineItems.length > 0 ? (
        <div className="app-agent-timeline min-w-0 space-y-2">
          {timelineItems.map((item) => {
            if (item.kind === 'low-risk-group') {
              return <CollapsedLowRiskGroup key={item.id} steps={item.steps} t={t} />
            }
            if (item.kind === 'connection-flow') {
              return (
                <ConnectionFlowGroup
                  key={item.id}
                  steps={item.steps}
                  t={t}
                  connectionName={document.loginMeta?.connectionName || item.connectionName}
                  finished={
                    Boolean(document.errorMarkdown) ||
                    loginFinished ||
                    hasConnectionFlowFinished(item.steps, t)
                  }
                  failed={Boolean(document.errorMarkdown)}
                />
              )
            }
            const step = item.step
            const index = item.index
            if (step.kind === 'thought') {
              return (
                <ThoughtStepRow
                  key={step.id}
                  step={step}
                  t={t}
                  collapsedByDefault={thinkingCollapsedByDefault}
                />
              )
            }
            if (step.kind === 'message') {
              return <MessageStepRow key={step.id} step={step} t={t} />
            }
            if (step.kind === 'status') {
              return (
                <div
                  key={step.id}
                  className="text-[11px] leading-relaxed text-muted-foreground/80"
                  title={step.detail}
                >
                  {step.title}
                </div>
              )
            }
            if (step.kind === 'user-supplement') {
              return <UserSupplementStepRow key={step.id} step={step} t={t} />
            }
            if (step.kind === 'tool') {
              const previous = visibleSteps[index - 1]
              const hideCommand =
                previous?.kind === 'approval' &&
                Boolean(step.command?.trim()) &&
                previous.command.trim() === step.command?.trim()
              return (
                <ToolCallRow
                  key={step.id}
                  step={step}
                  t={t}
                  hideCommand={hideCommand}
                  onInterruptCommand={onInterruptCommand}
                  onFocusTerminal={onFocusTerminal}
                  fallbackExecutionTabId={fallbackExecutionTabId}
                />
              )
            }
            if (step.kind === 'approval') {
              return (
                <ApprovalStepCard
                  key={step.id}
                  step={step}
                  t={t}
                  onResolve={onResolveApproval}
                  onAddToWhitelist={onAddCommandToWhitelist}
                />
              )
            }
            return null
          })}
        </div>
      ) : null}

      {showActivity ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          <span>{activity}</span>
        </div>
      ) : null}

      {loginFinished ? (
        <>
          <LoginResultCard document={document} t={t} />
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-1.5">
            <span className="min-w-0 shrink-0 text-left text-[10px] text-muted-foreground">
              {typeof document.elapsedMs === 'number'
                ? `${t.input.elapsed}：${formatDuration(document.elapsedMs)}`
                : document.elapsedMarkdown
                  ? `${t.input.elapsed}：${document.elapsedMarkdown}`
                  : null}
            </span>
            <ResultActionBar
              t={t}
              copied={copied}
              feedbackRating={feedbackRating}
              feedbackBusy={feedbackBusy}
              savingSop={savingSop}
              onCopyResult={onCopyResult}
              onOpsFeedback={onOpsFeedback}
              onSaveAsSop={onSaveAsSop}
              onExportResult={onExportResult}
              onExportFull={onExportFull}
              onExportTrace={onExportTrace}
            />
          </div>
        </>
      ) : showResult ? (
        <div className="app-agent-result min-w-0 rounded-xl border border-border/70 bg-card/50">
          {(document.resultMarkdown?.trim() || document.errorMarkdown?.trim()) && (
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
              {document.errorMarkdown?.trim() && !document.resultMarkdown?.trim() ? (
                <TriangleAlertIcon
                  className="size-3.5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              )}
              <span className="text-xs font-semibold tracking-wide text-foreground/85">
                {document.errorMarkdown?.trim() && !document.resultMarkdown?.trim()
                  ? t.input.error
                  : t.input.result}
              </span>
            </div>
          )}
          {document.resultMarkdown?.trim() ? (
            <div className="min-w-0 space-y-2 px-3 py-2.5">
              {resultTruncated && canOpenFullRun ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2 text-xs text-foreground/85">
                  <span>{t.input.resultTruncatedHint}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setFullOverlayTab('result')}
                  >
                    {t.input.fullRunViewResult}
                  </Button>
                </div>
              ) : null}
              <div className="min-w-0 text-[15px] leading-relaxed text-foreground">
                <MarkdownContent value={resultBodyMarkdown} t={t} />
              </div>
              {onInjectSuggestions ? (
                <ResultSuggestionsPicker
                  resultMarkdown={document.resultMarkdown}
                  t={t}
                  onInject={onInjectSuggestions}
                />
              ) : null}
            </div>
          ) : null}
          {document.errorMarkdown?.trim() ? (
            document.errorKind === 'quota' ? (
              <QuotaErrorCard
                t={t}
                provider={document.errorProvider}
                resetHint={document.errorResetHint}
                message={document.errorMarkdown}
                onOpenModelSettings={onOpenModelSettings}
              />
            ) : (
              <div className="px-3 py-2.5 text-sm text-destructive">
                <MarkdownContent value={errorBodyMarkdown} t={t} />
              </div>
            )
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/15 px-3 py-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 shrink-0 text-left text-[10px] text-muted-foreground">
                {typeof document.elapsedMs === 'number'
                  ? `${t.input.elapsed}：${formatDuration(document.elapsedMs)}`
                  : document.elapsedMarkdown
                    ? `${t.input.elapsed}：${document.elapsedMarkdown}`
                    : null}
              </span>
              {canOpenFullRun ? (
                <div className="flex flex-wrap items-center gap-1">
                  {visibleSteps.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-muted-foreground"
                      onClick={() => setFullOverlayTab('steps')}
                    >
                      {t.input.fullRunViewSteps}
                    </Button>
                  ) : null}
                  {(resultBodyMarkdown || errorBodyMarkdown) &&
                  (!resultTruncated || errorTruncated) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-muted-foreground"
                      onClick={() => setFullOverlayTab('result')}
                    >
                      {t.input.fullRunViewResult}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="select-none"
                aria-label={copied ? t.common.copied : t.common.copyResultTooltip}
                title={copied ? t.common.copied : t.common.copyResultTooltip}
                onPointerDown={(event) => event.preventDefault()}
                onClick={onCopyResult}
              >
                {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              </Button>
              {onSaveAsSop ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={savingSop}
                  aria-label={t.common.saveAsSopTooltip}
                  title={t.common.saveAsSopTooltip}
                  onClick={onSaveAsSop}
                >
                  {savingSop ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <BookMarkedIcon aria-hidden="true" />
                  )}
                </Button>
              ) : null}
              {onOpsFeedback ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={
                      feedbackBusy || feedbackRating === 'like' || feedbackRating === 'dislike'
                    }
                    aria-label={
                      feedbackRating === 'dislike'
                        ? t.common.likeResultLockedTooltip
                        : t.common.likeResultTooltip
                    }
                    title={
                      feedbackRating === 'dislike'
                        ? t.common.likeResultLockedTooltip
                        : feedbackRating === 'like'
                          ? t.common.opsFeedbackAlreadyRated
                          : t.common.likeResultTooltip
                    }
                    className={
                      feedbackRating === 'like'
                        ? 'text-primary hover:text-primary/80'
                        : feedbackRating === 'dislike'
                          ? 'opacity-40'
                          : undefined
                    }
                    onClick={() => {
                      if (feedbackBusy || feedbackRating) return
                      onOpsFeedback('like')
                    }}
                  >
                    <ThumbsUpIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={
                      feedbackBusy || feedbackRating === 'like' || feedbackRating === 'dislike'
                    }
                    aria-label={
                      feedbackRating === 'like'
                        ? t.common.dislikeResultLockedTooltip
                        : t.common.dislikeResultTooltip
                    }
                    title={
                      feedbackRating === 'like'
                        ? t.common.dislikeResultLockedTooltip
                        : feedbackRating === 'dislike'
                          ? t.common.opsFeedbackAlreadyRated
                          : t.common.dislikeResultTooltip
                    }
                    className={
                      feedbackRating === 'dislike'
                        ? 'text-destructive hover:text-destructive'
                        : feedbackRating === 'like'
                          ? 'opacity-40'
                          : undefined
                    }
                    onClick={() => {
                      if (feedbackBusy || feedbackRating) return
                      onOpsFeedback('dislike')
                    }}
                  >
                    <ThumbsDownIcon aria-hidden="true" />
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.common.exportResultMarkdownTooltip}
                title={t.common.exportResultMarkdownTooltip}
                onClick={onExportResult}
              >
                <DownloadIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.common.exportFullMarkdownTooltip}
                title={t.common.exportFullMarkdownTooltip}
                onClick={onExportFull}
              >
                <FileTextIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.common.exportTraceJsonTooltip}
                title={t.common.exportTraceJsonTooltip}
                onClick={onExportTrace}
              >
                <FileJsonIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {fullOverlayTab && storageRef ? (
        <FullAgentRunOverlay
          tabId={storageRef.tabId}
          logId={storageRef.logId}
          runId={storageRef.runId}
          initialTab={fullOverlayTab}
          t={t}
          onClose={() => setFullOverlayTab(null)}
        />
      ) : null}
    </div>
  )
}
