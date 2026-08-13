import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  Loader2Icon,
  ServerIcon,
  ShieldPlusIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  BookMarkedIcon
} from 'lucide-react'

import {
  FullAgentRunOverlay,
  type FullAgentRunOverlayTab
} from '@renderer/components/FullAgentRunOverlay'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { QuotaErrorCard } from '@renderer/components/QuotaErrorCard'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { ParsedAgentRunDocument } from '@renderer/lib/agent-run-document'
import {
  shouldShowAgentRunResult,
  omitDuplicateTrailingMessage
} from '@renderer/lib/agent-run-document'
import { isClassifyingStatusMessage } from '@renderer/lib/agent-event-formatters'
import { formatLogTime, isConnectionStatusText } from '@renderer/lib/agent-log'
import { AGENT_RUN_STREAM_MAX_CHARS, clampAgentText } from '@renderer/lib/agent-text-limits'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import type { CommandRiskLevel, OpsHistoryRating } from '../../../shared/agent-types'
import {
  extractRiskVerb,
  isStaticallyReadonly,
  shouldShowWhitelistEntry
} from '../../../shared/command-guard'
import { parseBatchedToolOutput, type BatchedCommandPart } from '../../../shared/readonly-batch'
import { extractResultSuggestions } from '@renderer/lib/result-suggestions'
import { sortTimelineBySeq } from '../../../shared/connection-state'

/**
 * Cursor / Codex-style agent turn view:
 * thinking → compact tool calls → answer markdown, in one continuous stream.
 * No "action summary / action details" blocks.
 */
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
  thinkingCollapsedByDefault?: boolean
}): React.JSX.Element {
  const [fullOverlayTab, setFullOverlayTab] = useState<FullAgentRunOverlayTab | null>(null)
  const runFinished = typeof document.elapsedMs === 'number'
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
  const activity = resolveActivity(document, visibleSteps, t)
  const showActivity = Boolean(activity) && !runFinished && !loginMeta
  return (
    <div className="min-w-0 space-y-2.5">
      {timelineItems.length > 0 ? (
        <div className="min-w-0 space-y-2">
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
                  finished={loginFinished || hasConnectionFlowFinished(item.steps, t)}
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
              return <ToolCallRow key={step.id} step={step} t={t} hideCommand={hideCommand} />
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
        <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card/50">
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
              <div className="min-w-0 text-[15px] leading-relaxed text-foreground">
                <MarkdownContent
                  value={clampAgentText(document.resultMarkdown, AGENT_RUN_STREAM_MAX_CHARS)}
                  t={t}
                />
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
                <MarkdownContent
                  value={clampAgentText(document.errorMarkdown, AGENT_RUN_STREAM_MAX_CHARS)}
                  t={t}
                />
              </div>
            )
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/15 px-3 py-1.5">
            <span className="min-w-0 shrink-0 text-left text-[10px] text-muted-foreground">
              {typeof document.elapsedMs === 'number'
                ? `${t.input.elapsed}：${formatDuration(document.elapsedMs)}`
                : document.elapsedMarkdown
                  ? `${t.input.elapsed}：${document.elapsedMarkdown}`
                  : null}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={copied ? t.common.copied : t.common.copyResultTooltip}
                title={copied ? t.common.copied : t.common.copyResultTooltip}
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

const THOUGHT_PREVIEW_CHARS = 120

function ThoughtStepRow({
  step,
  t,
  collapsedByDefault
}: {
  step: Extract<AgentRunStep, { kind: 'thought' }>
  t: Dictionary
  collapsedByDefault: boolean
}): React.JSX.Element | null {
  const text = clampAgentText(step.text.trim(), AGENT_RUN_STREAM_MAX_CHARS)
  if (!text) return null
  const streaming = step.phase === 'streaming'
  const needsCollapse = collapsedByDefault || (!streaming && text.length > THOUGHT_PREVIEW_CHARS)

  if (needsCollapse) {
    return (
      <details className="group min-w-0" open={collapsedByDefault ? undefined : true}>
        <summary className="flex cursor-pointer select-none items-start gap-1.5 marker:content-none">
          {streaming ? (
            <Loader2Icon
              className="mt-0.5 size-3 shrink-0 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <ChevronRightIcon
              className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground italic">
            <span className="mr-1.5 not-italic text-muted-foreground/70">
              {streaming ? t.input.thinkingProcessStreaming : t.input.thinkingProcessCompleted}
            </span>
            <span className="group-open:hidden">
              {collapsedByDefault && streaming
                ? null
                : `${text.slice(0, THOUGHT_PREVIEW_CHARS)}${text.length > THOUGHT_PREVIEW_CHARS ? '…' : ''}`}
            </span>
            <span className="hidden whitespace-pre-wrap break-words group-open:inline">{text}</span>
          </span>
        </summary>
      </details>
    )
  }

  return (
    <div className="flex items-start gap-1.5 min-w-0">
      {streaming ? (
        <Loader2Icon
          className="mt-0.5 size-3 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      ) : (
        <span
          className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground italic whitespace-pre-wrap break-words">
        <span className="mr-1.5 not-italic text-muted-foreground/70">
          {streaming ? t.input.thinkingProcessStreaming : t.input.thinkingProcessCompleted}
        </span>
        {text}
      </div>
    </div>
  )
}

function MessageStepRow({
  step,
  t
}: {
  step: Extract<AgentRunStep, { kind: 'message' }>
  t: Dictionary
}): React.JSX.Element | null {
  const text = clampAgentText(step.text.trim(), AGENT_RUN_STREAM_MAX_CHARS)
  if (!text) return null
  const streaming = step.phase === 'streaming'
  return (
    <div className="min-w-0 text-[14px] leading-relaxed text-foreground/90">
      <MarkdownContent value={text} t={t} streaming={streaming} />
      {streaming ? (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/40 align-middle" />
      ) : null}
    </div>
  )
}

function UserSupplementStepRow({
  step,
  t
}: {
  step: Extract<AgentRunStep, { kind: 'user-supplement' }>
  t: Dictionary
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-semibold tracking-wide text-foreground/80">{t.roles.user}</span>
        <span className="rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t.input.contextSupplement}
        </span>
        <time dateTime={step.createdAt}>{formatLogTime(step.createdAt)}</time>
      </div>
      <pre className="select-text min-w-0 overflow-x-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {clampAgentText(step.text, AGENT_RUN_STREAM_MAX_CHARS)}
      </pre>
    </div>
  )
}

function ToolCallRow({
  step,
  t,
  hideCommand = false
}: {
  step: Extract<AgentRunStep, { kind: 'tool' }>
  t: Dictionary
  hideCommand?: boolean
}): React.JSX.Element {
  const running = step.phase === 'started'
  const command = step.command?.trim()
  const preview = hideCommand ? undefined : command || summarizeArgs(step.argsText)
  const observationRaw = step.resultText?.trim()
  const observation = observationRaw
    ? clampAgentText(observationRaw, AGENT_RUN_STREAM_MAX_CHARS)
    : undefined
  const batchParts = observation ? parseBatchedToolOutput(observation) : null
  const showObservation = Boolean(observation && observation !== command && !batchParts)
  const observationLong = Boolean(showObservation && observation && observation.length > 240)
  const isPtyCommand = step.name === 'bash' || step.name === 'terminal'
  const toolLabel = isPtyCommand ? t.input.toolCommandLabel : step.name
  const statusLabel = running
    ? t.input.toolRunning
    : step.interrupted
      ? t.input.toolInterrupted
      : step.timedOut
        ? t.input.toolTimedOut
        : step.isError
          ? t.input.toolFailed
          : t.input.toolFinished
  const warnFinish = Boolean(step.interrupted || step.timedOut)

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start gap-2 min-w-0">
        {running ? (
          <Loader2Icon
            className="mt-0.5 size-3 shrink-0 animate-spin text-primary"
            aria-hidden="true"
          />
        ) : warnFinish ? (
          <TriangleAlertIcon
            className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        ) : (
          <span
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
              step.isError ? 'bg-destructive' : 'bg-primary/70'
            }`}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium text-foreground/80">{toolLabel}</span>
            <span className="text-[11px] text-muted-foreground">{statusLabel}</span>
          </div>
          {batchParts ? (
            <BatchCommandGroupCard
              parts={batchParts}
              isError={Boolean(step.isError)}
              running={running}
              t={t}
            />
          ) : preview ? (
            <CommandBlock command={preview} t={t} tone="command" />
          ) : null}
        </div>
      </div>

      {showObservation && observation ? (
        observationLong ? (
          <details className="group ml-5 min-w-0">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronRightIcon
                className="size-3 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              <span className="truncate font-mono group-open:hidden">
                {observation.slice(0, 120)}
                {observation.length > 120 ? '…' : ''}
              </span>
              <span className="hidden group-open:inline">{t.input.toolFinished}</span>
            </summary>
            <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground/90">
              {observation}
            </pre>
          </details>
        ) : (
          <pre className="ml-5 max-h-56 overflow-auto rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground/90">
            {observation}
          </pre>
        )
      ) : null}
    </div>
  )
}

function BatchCommandGroupCard({
  parts,
  isError,
  running,
  t
}: {
  parts: BatchedCommandPart[]
  isError: boolean
  running: boolean
  t: Dictionary
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const previewCount = 2
  const visible = expanded ? parts : parts.slice(0, previewCount)
  const hiddenCount = Math.max(0, parts.length - previewCount)
  const statusIcon = running ? (
    <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
  ) : isError ? (
    <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
  ) : (
    <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
  )

  return (
    <div className="min-w-0 rounded-md border border-border/50">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground">
        {statusIcon}
        <span className="min-w-0 flex-1">
          {t.commandReview.batchGroupCollapsed.replace('{n}', String(parts.length))}
        </span>
      </div>
      <div className="space-y-2 border-t border-border/40 px-2 py-2">
        {visible.map((part) => (
          <BatchCommandSegment key={`${part.index}-${part.command}`} part={part} t={t} />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <>
                <ChevronUpIcon className="size-3.5" aria-hidden="true" />
                {t.commandReview.batchGroupHide}
              </>
            ) : (
              <>
                <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                {t.commandReview.batchGroupShowMore.replace('{n}', String(hiddenCount))}
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function BatchCommandSegment({
  part,
  t
}: {
  part: BatchedCommandPart
  t: Dictionary
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const segmentId = `batch-cmd-${part.index}`

  async function copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(part.output || part.command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable.
    }
  }

  function scrollToOutput(): void {
    document.getElementById(segmentId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div className="min-w-0 space-y-1 rounded-md border border-border/60 bg-muted/15 p-2">
      <div className="flex items-start gap-1.5">
        <CheckIcon className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden="true" />
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-mono text-[11px] text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={scrollToOutput}
          title={part.command}
        >
          <span className="line-clamp-2 whitespace-pre-wrap break-words">{part.command}</span>
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/50"
          title={t.commandReview.batchCopyOutput}
          aria-label={t.commandReview.batchCopyOutput}
          onClick={() => void copyOutput()}
        >
          <CopyIcon className="size-3" aria-hidden="true" />
        </button>
      </div>
      <pre
        id={segmentId}
        className="max-h-40 overflow-auto rounded-md border border-border/50 bg-muted/15 p-1.5 font-mono text-[10px] whitespace-pre-wrap break-words text-foreground/90"
      >
        {part.output || '(no output)'}
      </pre>
      {copied ? <span className="text-[10px] text-muted-foreground">{t.common.copied}</span> : null}
    </div>
  )
}

function isLowRiskAutoPassStep(
  step: AgentRunStep
): step is Extract<AgentRunStep, { kind: 'approval' }> {
  return step.kind === 'approval' && step.risk === 'low' && step.phase !== 'pending'
}

export type TimelineItem =
  | { kind: 'step'; step: AgentRunStep; index: number }
  | {
      kind: 'low-risk-group'
      id: string
      steps: Array<Extract<AgentRunStep, { kind: 'approval' }>>
    }
  | {
      kind: 'connection-flow'
      id: string
      steps: Array<Extract<AgentRunStep, { kind: 'status' }>>
      connectionName: string
    }

/** Connection/login bookkeeping steps shown as one compact flow instead of
 *  fragmented one-liners (e.g. matched → switched → login actions → done). */
function isConnectionFlowStatusStep(step: AgentRunStep, t: Dictionary): boolean {
  if (step.kind !== 'status') return false
  return isConnectionStatusText(step.title ?? '', t)
}

function isConnectionFlowStatusStepType(
  step: AgentRunStep
): step is Extract<AgentRunStep, { kind: 'status' }> {
  return step.kind === 'status'
}

/** A flow is finished when its "login completed" step is present (same source
 *  as the result card finalize event, independent of loginMeta presence). */
function hasConnectionFlowFinished(
  steps: Array<Extract<AgentRunStep, { kind: 'status' }>>,
  t: Dictionary
): boolean {
  const done = t.terminal.postLoginTaskStarting.trim()
  return steps.some((step) => (step.title ?? '').trim() === done)
}

export function groupTimelineSteps(steps: AgentRunStep[], t: Dictionary): TimelineItem[] {
  const items: TimelineItem[] = []
  // Collect every connection-flow status step in this run into ONE flow group,
  // regardless of whether unrelated rows (e.g. user supplements) appear between
  // them. The connection name is derived from the steps, never from a row title
  // fallback, so an interrupted login still renders as a single flow.
  const flowSteps: Array<Extract<AgentRunStep, { kind: 'status' }>> = []
  const flowStepIds = new Set<string>()
  for (const step of steps) {
    if (isConnectionFlowStatusStepType(step) && isConnectionFlowStatusStep(step, t)) {
      flowSteps.push(step)
      flowStepIds.add(step.id)
    }
  }
  const connectionName = resolveFlowConnectionName(flowSteps, t)

  let flowEmitted = false
  let index = 0
  while (index < steps.length) {
    const step = steps[index]
    if (flowStepIds.has(step.id)) {
      if (!flowEmitted && flowSteps.length > 0) {
        flowEmitted = true
        items.push({
          kind: 'connection-flow',
          id: 'connection-flow',
          steps: flowSteps,
          connectionName
        })
      }
      index += 1
      continue
    }
    if (isLowRiskAutoPassStep(step)) {
      let end = index + 1
      while (end < steps.length && isLowRiskAutoPassStep(steps[end])) end += 1
      if (end - index >= 2) {
        items.push({
          kind: 'low-risk-group',
          id: `low-risk-group-${step.id}`,
          steps: steps.slice(index, end) as Array<Extract<AgentRunStep, { kind: 'approval' }>>
        })
        index = end
        continue
      }
    }
    items.push({ kind: 'step', step, index })
    index += 1
  }

  return items
}

/** Extract the connection identity from a flow status step (switched/matched). */
function resolveConnectionFlowKey(
  step: Extract<AgentRunStep, { kind: 'status' }>,
  t: Dictionary
): string {
  const title = step.title ?? ''
  const switched = t.terminal.switchedToConnection.split('{name}')[0]
  if (switched && title.startsWith(switched)) {
    return title.slice(switched.length).trim()
  }
  const matched = t.terminal.connectionMatched
  if (matched && title.startsWith(matched)) {
    const firstLine = step.detail?.split('\n')[0]?.trim()
    if (firstLine) return firstLine
  }
  return ''
}

function resolveFlowConnectionName(
  steps: Array<Extract<AgentRunStep, { kind: 'status' }>>,
  t: Dictionary
): string {
  for (const step of steps) {
    const key = resolveConnectionFlowKey(step, t)
    if (key) return key
  }
  return ''
}

function CollapsedLowRiskGroup({
  steps,
  t
}: {
  steps: Array<Extract<AgentRunStep, { kind: 'approval' }>>
  t: Dictionary
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const maxMs = Math.max(
    0,
    ...steps.map((step) => (typeof step.elapsedMs === 'number' ? Math.round(step.elapsedMs) : 0))
  )
  const label = t.commandReview.lowRiskGroupCollapsed
    .replace('{n}', String(steps.length))
    .replace('{ms}', String(maxMs))

  return (
    <div className="min-w-0 rounded-lg border border-border/50">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => setExpanded((value) => !value)}
      >
        <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{label}</span>
        {expanded ? (
          <ChevronUpIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {expanded ? (
        <div className="space-y-1.5 border-t border-border/40 px-2 py-2">
          {steps.map((step) => (
            <ApprovalStepCard key={step.id} step={step} t={t} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ConnectionFlowGroup({
  steps,
  t,
  connectionName,
  finished = false,
  failed = false
}: {
  steps: Array<Extract<AgentRunStep, { kind: 'status' }>>
  t: Dictionary
  connectionName: string
  finished?: boolean
  failed?: boolean
}): React.JSX.Element {
  // Expand by default so every login action is visible in the transcript; the
  // user can collapse/expand at will and their choice is preserved.
  const [expanded, setExpanded] = useState(true)
  const label = connectionName
    ? t.terminal.connectionFlowLabel.replace('{name}', connectionName)
    : t.terminal.connectionFlowFallback
  const stepCount = t.terminal.connectionFlowStepCount.replace('{n}', String(steps.length))
  const statusTone = failed
    ? 'text-destructive'
    : finished
      ? 'text-primary'
      : 'text-muted-foreground'
  const statusLabel = failed
    ? t.terminal.loginFailed
    : finished
      ? t.terminal.loginSuccess
      : t.terminal.loginInProgress

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border bg-card/40 ${
        failed ? 'border-destructive/30' : 'border-border/50'
      }`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={expanded}
        title={expanded ? t.terminal.connectionFlowCollapse : t.terminal.connectionFlowExpand}
        onClick={() => setExpanded((value) => !value)}
      >
        <ServerIcon className={`size-3.5 shrink-0 ${statusTone}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">{label}</span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusTone} border-current/30`}
        >
          {!finished && !failed ? (
            <Loader2Icon className="mr-1 inline size-2.5 animate-spin" aria-hidden="true" />
          ) : null}
          {statusLabel}
        </span>
        <span className="shrink-0 text-muted-foreground/70">{stepCount}</span>
        {expanded ? (
          <ChevronUpIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {expanded ? (
        <div className="space-y-1 border-t border-border/40 px-2.5 py-2">
          {steps.map((step, stepIndex) => {
            const isLast = step.id === steps[steps.length - 1]?.id
            const createdAt = (step as { createdAt?: string }).createdAt
            return (
              <div key={step.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                  {!finished && isLast ? (
                    <Loader2Icon className="size-3 animate-spin text-primary" aria-hidden="true" />
                  ) : failed && isLast ? (
                    <TriangleAlertIcon className="size-3 text-destructive" aria-hidden="true" />
                  ) : (
                    <span
                      className={`size-1 rounded-full ${
                        finished ? 'bg-primary/70' : 'bg-muted-foreground/40'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-muted-foreground">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                      {stepIndex + 1}
                    </span>
                    <span className="min-w-0 break-words whitespace-pre-wrap">{step.title}</span>
                  </div>
                  {createdAt ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground/50">
                      {formatLogTime(createdAt)}
                    </div>
                  ) : null}
                  {step.detail ? (
                    <div className="mt-0.5 break-words whitespace-pre-wrap text-muted-foreground/70">
                      {step.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function LoginResultCard({
  document,
  t
}: {
  document: ParsedAgentRunDocument
  t: Dictionary
}): React.JSX.Element {
  const meta = document.loginMeta
  const failed = Boolean(document.errorMarkdown?.trim())
  const elapsedMs = typeof document.elapsedMs === 'number' ? document.elapsedMs : undefined
  const address = [meta?.host ?? '', meta?.port ? `:${meta.port}` : ''].join('')
  // Count the typed login-action steps actually rendered in the flow so the
  // result card always agrees with the flow (single source: document.steps).
  const actionPrefix = `${t.terminal.connectionAction} `
  const actionStepCount = document.steps.filter(
    (step) =>
      step.kind === 'status' &&
      typeof step.title === 'string' &&
      step.title.trim().startsWith(actionPrefix)
  ).length
  const rowEntries: Array<[string, string]> = [
    [t.terminal.loginConnectionName, meta?.connectionName ?? ''],
    [t.terminal.loginConnectionAddress, address],
    [t.terminal.loginUser, meta?.user ?? ''],
    [
      t.terminal.loginActions,
      failed
        ? t.terminal.loginFailed
        : t.terminal.loginActionsDone.replace(
            '{n}',
            String(actionStepCount || meta?.actionCount || 0)
          )
    ]
  ]
  const rows: Array<[string, string]> = []
  for (const [key, value] of rowEntries) {
    if (value) rows.push([key, value])
  }

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border ${
        failed ? 'border-destructive/30 bg-destructive/[0.04]' : 'border-border/70 bg-card/50'
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b px-3 py-2 ${
          failed ? 'border-destructive/20 bg-destructive/[0.06]' : 'border-border/60 bg-muted/20'
        }`}
      >
        {failed ? (
          <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span
          className={`text-xs font-semibold tracking-wide ${
            failed ? 'text-destructive' : 'text-foreground/85'
          }`}
        >
          {failed ? t.terminal.loginFailed : t.terminal.loginSuccess}
        </span>
        {meta?.connectionName ? (
          <span className="ml-auto shrink-0 rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {meta.connectionName}
          </span>
        ) : null}
        {typeof elapsedMs === 'number' ? (
          <span className="shrink-0 font-mono tabular-nums text-[10px] text-muted-foreground">
            {t.terminal.loginEndToEndElapsed} {formatDuration(elapsedMs)}
          </span>
        ) : null}
      </div>
      <div className="px-3 py-2.5">
        {rows.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {rows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground/80">{key}</dt>
                <dd className="break-all font-mono text-[11px] tabular-nums text-foreground/90">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {failed && document.errorMarkdown?.trim() ? (
          <div className="mt-2 break-words rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            {document.errorMarkdown.trim()}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ResultActionBar({
  t,
  copied,
  feedbackRating,
  feedbackBusy,
  savingSop,
  onCopyResult,
  onOpsFeedback,
  onSaveAsSop,
  onExportResult,
  onExportFull,
  onExportTrace
}: {
  t: Dictionary
  copied: boolean
  feedbackRating?: OpsHistoryRating | null
  feedbackBusy?: boolean
  savingSop?: boolean
  onCopyResult?: () => void
  onOpsFeedback?: (rating: 'like' | 'dislike') => void
  onSaveAsSop?: () => void
  onExportResult?: () => void
  onExportFull?: () => void
  onExportTrace?: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {onCopyResult ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? t.common.copied : t.common.copyResultTooltip}
          title={copied ? t.common.copied : t.common.copyResultTooltip}
          onClick={onCopyResult}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      ) : null}
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
            disabled={feedbackBusy || feedbackRating === 'like' || feedbackRating === 'dislike'}
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
            disabled={feedbackBusy || feedbackRating === 'like' || feedbackRating === 'dislike'}
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
      {onExportResult ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t.common.exportResultMarkdownTooltip}
          title={t.common.exportResultMarkdownTooltip}
          onClick={onExportResult}
        >
          <FileTextIcon aria-hidden="true" />
        </Button>
      ) : null}
      {onExportFull ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t.common.exportFullMarkdownTooltip}
          title={t.common.exportFullMarkdownTooltip}
          onClick={onExportFull}
        >
          <DownloadIcon aria-hidden="true" />
        </Button>
      ) : null}
      {onExportTrace ? (
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
      ) : null}
    </div>
  )
}

function ApprovalStepCard({
  step,
  t,
  onResolve,
  onAddToWhitelist
}: {
  step: Extract<AgentRunStep, { kind: 'approval' }>
  t: Dictionary
  onResolve?: (requestId: string, approved: boolean, note?: string) => void
  onAddToWhitelist?: (command: string) => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  const [whitelistSuggestionDismissed, setWhitelistSuggestionDismissed] = useState(false)
  const [whitelistAdded, setWhitelistAdded] = useState(false)
  const pending = step.phase === 'pending'
  const risk = step.risk ?? 'medium'
  const canWhitelist = Boolean(step.command.trim() && onAddToWhitelist)
  const isLowAutoPass = risk === 'low' && !pending
  const isTimeoutPending = pending && step.source === 'timeout-fallback'
  const isHighPending = pending && risk === 'high'
  const showWhitelistEntry =
    canWhitelist &&
    shouldShowWhitelistEntry({
      phase: step.phase,
      risk,
      alreadyAdded: whitelistAdded
    }) &&
    !whitelistSuggestionDismissed
  const showWhitelistAdded =
    canWhitelist &&
    risk === 'high' &&
    step.phase === 'approved' &&
    whitelistAdded &&
    !whitelistSuggestionDismissed

  if (isLowAutoPass) {
    const elapsed =
      typeof step.elapsedMs === 'number' ? Math.max(0, Math.round(step.elapsedMs)) : undefined
    return (
      <div className="min-w-0 rounded-lg border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
          <span>
            {elapsed === undefined
              ? t.commandReview.lowRiskAutoPass
              : t.commandReview.lowRiskAutoPassWithMs.replace('{ms}', String(elapsed))}
          </span>
        </span>
      </div>
    )
  }

  const statusLabel =
    step.phase === 'pending'
      ? t.input.approvalPending
      : step.phase === 'approved'
        ? step.requestId
          ? t.input.approvalAllowed
          : t.input.autoApprovedShort
        : t.input.approvalDenied

  const riskVerb = extractRiskVerb(step.command)
  const humanSummary =
    step.auditSummary?.trim() ||
    (isStaticallyReadonly(step.command)
      ? t.commandReview.readOnlyHuman.replace('{verb}', riskVerb)
      : t.commandReview.highRiskHuman.replace('{verb}', riskVerb))
  const riskDetail = (
    <>
      {step.riskPoints && step.riskPoints.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {step.riskPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {step.impactAnalysis ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">{t.commandReview.impactAnalysis}: </span>
          {step.impactAnalysis}
        </p>
      ) : null}
      {step.recommendation ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">{t.commandReview.recommendation}: </span>
          {step.recommendation}
        </p>
      ) : null}
    </>
  )

  return (
    <div
      className={
        pending
          ? 'min-w-0 rounded-xl border border-amber-500/35 bg-amber-500/5'
          : 'min-w-0 rounded-xl border border-border/60'
      }
    >
      {showWhitelistEntry ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-[11px]">
          <span className="text-foreground/90">{t.commandReview.whitelistSuggest}</span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                onAddToWhitelist?.(step.command)
                setWhitelistAdded(true)
              }}
            >
              {t.commandReview.whitelistSuggestAdd}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setWhitelistSuggestionDismissed(true)}
            >
              {t.commandReview.whitelistSuggestIgnore}
            </Button>
          </div>
        </div>
      ) : null}

      {showWhitelistAdded ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-[11px]">
          <span className="text-muted-foreground">{t.commandReview.addedToWhitelist}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled
          >
            <ShieldPlusIcon className="size-3.5" aria-hidden="true" />
            {t.commandReview.addedToWhitelist}
          </Button>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
            <TriangleAlertIcon className="size-3.5 text-amber-500" aria-hidden="true" />
            <span>{t.commandReview.title}</span>
            <Badge variant={riskBadgeVariant(risk)}>{riskLabel(risk, t)}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[10px] text-muted-foreground">{statusLabel}</span>
        </div>
      </div>

      <div className="space-y-2.5 border-t border-border/40 px-3 py-2.5 text-[11px]">
        <CommandBlock command={step.command} t={t} tone="audit" />

        {isTimeoutPending ? (
          <p className="text-foreground/90">{t.commandReview.timeoutManualConfirm}</p>
        ) : isHighPending || (risk === 'high' && !pending) ? (
          <>
            {step.purposePhase === 'loading' ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t.commandReview.purposeLabel}:{' '}
                </span>
                {t.commandReview.purposeGenerating}
              </p>
            ) : null}
            {step.purposePhase === 'ready' && step.purpose?.trim() ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t.commandReview.purposeLabel}:{' '}
                </span>
                {step.purpose.trim()}
              </p>
            ) : null}
            <p className="text-foreground/90">{highlightRiskVerb(humanSummary, riskVerb)}</p>
            {riskDetail}
          </>
        ) : (
          <>
            {step.auditSummary ? <p className="text-foreground/90">{step.auditSummary}</p> : null}
            {step.operationReason ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t.commandReview.operationReason}:{' '}
                </span>
                {step.operationReason}
              </p>
            ) : null}
            {riskDetail}
          </>
        )}

        {pending && onResolve ? (
          <>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t.input.approvalNotePlaceholder}
              className="min-h-14 resize-y text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => onResolve(step.requestId, true, note.trim() || undefined)}
              >
                {t.commandReview.approve}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onResolve(step.requestId, false, note.trim() || undefined)}
              >
                {t.commandReview.reject}
              </Button>
            </div>
          </>
        ) : null}

        {!pending && step.note?.trim() ? (
          <p className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-foreground/90">
            {t.input.yourApprovalNote.replace('{note}', step.note.trim())}
          </p>
        ) : null}

        {!pending && !step.note?.trim() && step.rejectionReason ? (
          <p className="text-muted-foreground">{step.rejectionReason}</p>
        ) : null}
      </div>
    </div>
  )
}

function ResultSuggestionsPicker({
  resultMarkdown,
  t,
  onInject
}: {
  resultMarkdown: string
  t: Dictionary
  onInject: (texts: string[]) => void
}): React.JSX.Element | null {
  const suggestions = useMemo(() => extractResultSuggestions(resultMarkdown), [resultMarkdown])
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [status, setStatus] = useState<string | null>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  const selectedCount = suggestions.reduce(
    (count, _, index) => count + (selected[index] ? 1 : 0),
    0
  )
  const allSelected = suggestions.length > 0 && selectedCount === suggestions.length
  const someSelected = selectedCount > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  if (suggestions.length === 0) return null

  const selectedTexts = suggestions.filter((_, index) => selected[index])

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
      <label className="flex items-center gap-2 text-[11px] font-medium text-foreground/80">
        <input
          ref={selectAllRef}
          type="checkbox"
          className="size-3.5"
          checked={allSelected}
          aria-label={t.input.selectAllSuggestions}
          onChange={() => {
            if (allSelected) {
              setSelected({})
              return
            }
            const next: Record<number, boolean> = {}
            for (let index = 0; index < suggestions.length; index += 1) next[index] = true
            setSelected(next)
          }}
        />
        <span>{t.input.injectSelectedSuggestions}</span>
        <span className="font-normal text-muted-foreground">
          ({selectedCount}/{suggestions.length})
        </span>
      </label>
      <ul className="space-y-1.5">
        {suggestions.map((item, index) => (
          <li key={`${index}-${item.slice(0, 24)}`} className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(selected[index])}
              onChange={(event) =>
                setSelected((current) => ({ ...current, [index]: event.target.checked }))
              }
            />
            <span className="min-w-0 text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status ? (
          <span className="mr-auto text-[10px] text-muted-foreground">{status}</span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={selectedTexts.length === 0}
          onClick={() => {
            onInject(selectedTexts)
            setStatus(t.input.injectedSuggestionsCount.replace('{n}', String(selectedTexts.length)))
          }}
        >
          {t.input.injectSelectedSuggestions}
        </Button>
      </div>
    </div>
  )
}

function highlightRiskVerb(summary: string, verb: string): React.ReactNode {
  if (!verb) return summary
  const markers = [`（${verb}）`, `(${verb})`]
  for (const marker of markers) {
    const index = summary.indexOf(marker)
    if (index < 0) continue
    return (
      <>
        {summary.slice(0, index + 1)}
        <strong className="font-semibold text-amber-700 dark:text-amber-400">{verb}</strong>
        {summary.slice(index + marker.length - 1)}
      </>
    )
  }
  return summary
}

function CommandBlock({
  command,
  t,
  tone = 'command'
}: {
  command: string
  t: Dictionary
  tone?: 'command' | 'audit'
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const lineCount = command.split('\n').length
  const needsFold = lineCount > 2 || command.length > 120

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  }

  const toneClass =
    tone === 'audit'
      ? 'border-border/50 bg-muted/25 text-foreground'
      : 'border-border/60 bg-muted/20 text-foreground/90'

  return (
    <div className={`relative min-w-0 rounded border ${toneClass}`}>
      <button
        type="button"
        className="block w-full cursor-pointer rounded text-left"
        title={t.input.copyCommand}
        aria-label={t.input.copyCommand}
        onClick={() => void copyCommand()}
      >
        <pre
          className={`overflow-hidden p-2 pr-16 font-mono text-[11px] whitespace-pre-wrap break-words ${
            needsFold && !expanded ? 'line-clamp-2' : ''
          }`}
        >
          {command}
        </pre>
      </button>
      <div className="absolute top-1 right-1 flex items-center gap-0.5">
        {needsFold ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            aria-label={expanded ? t.input.collapseCommand : t.input.expandCommand}
            title={expanded ? t.input.collapseCommand : t.input.expandCommand}
            onClick={(event) => {
              event.stopPropagation()
              setExpanded((value) => !value)
            }}
          >
            {expanded ? (
              <ChevronUpIcon className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          aria-label={copied ? t.common.copied : t.input.copyCommand}
          title={copied ? t.common.copied : t.input.copyCommand}
          onClick={(event) => {
            event.stopPropagation()
            void copyCommand()
          }}
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  )
}

/** Drop consecutive identical bash/terminal rows that survived event merging. */
function coalesceVisiblePtyToolSteps(steps: AgentRunStep[]): AgentRunStep[] {
  const next: AgentRunStep[] = []
  for (const step of steps) {
    const prev = next[next.length - 1]
    if (
      step.kind === 'tool' &&
      prev?.kind === 'tool' &&
      (step.name === 'bash' || step.name === 'terminal') &&
      (prev.name === 'bash' || prev.name === 'terminal')
    ) {
      const left = (prev.command || prev.argsText || '').trim()
      const right = (step.command || step.argsText || '').trim()
      if (left && right && left === right) {
        const merged: Extract<AgentRunStep, { kind: 'tool' }> = {
          ...prev,
          name: 'bash',
          phase: step.phase === 'finished' || prev.phase === 'finished' ? 'finished' : prev.phase,
          command: prev.command || step.command,
          resultText: prev.resultText || step.resultText,
          isError: Boolean(prev.isError) || Boolean(step.isError),
          toolCallId: prev.toolCallId || step.toolCallId,
          argsText: undefined
        }
        next[next.length - 1] = merged
        continue
      }
    }
    next.push(step)
  }
  return next
}

function isNoiseStatusStep(step: AgentRunStep, t: Dictionary, hasApprovalStep = false): boolean {
  if (step.kind !== 'status') return false
  const title = step.title.trim()
  if (
    /^Agent started\.?$/i.test(title) ||
    /^Thinking…$/i.test(title) ||
    /^Thinking\.\.\.$/i.test(title) ||
    title === 'Agent finished.' ||
    title === t.input.startedRun
  ) {
    return true
  }
  if (hasApprovalStep && isClassifyingStatusMessage(title, t)) {
    return true
  }
  if (hasApprovalStep && step.detail && isClassifyingStatusMessage(step.detail, t)) {
    return true
  }
  if (title === t.commandReview.title || title.startsWith(`${t.commandReview.title}:`)) {
    return true
  }
  if (
    title === t.commandReview.readOnlyAllowed ||
    title === t.commandReview.whitelisted ||
    title === t.commandReview.autoApproved
  ) {
    return true
  }
  if (step.detail) {
    const detail = step.detail.trim()
    if (
      detail === t.commandReview.readOnlyAllowed ||
      detail === t.commandReview.whitelisted ||
      detail === t.input.toolTerminalHint ||
      detail.startsWith(t.commandReview.title)
    ) {
      return true
    }
  }
  return false
}

function summarizeArgs(argsText: string | undefined): string | undefined {
  if (!argsText?.trim()) return undefined
  const trimmed = argsText.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 77)}…`
}

function riskBadgeVariant(
  risk: CommandRiskLevel
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (risk === 'high') return 'destructive'
  if (risk === 'medium') return 'secondary'
  return 'outline'
}

function riskLabel(risk: CommandRiskLevel, t: Dictionary): string {
  if (risk === 'high') return t.commandReview.highRisk
  if (risk === 'medium') return t.commandReview.mediumRisk
  return t.commandReview.lowRisk
}

function resolveActivity(
  document: ParsedAgentRunDocument,
  steps: AgentRunStep[],
  t: Dictionary
): string | undefined {
  if (typeof document.elapsedMs === 'number') return undefined
  const pendingApproval = [...steps]
    .reverse()
    .find((step) => step.kind === 'approval' && step.phase === 'pending')
  if (pendingApproval) return t.input.activityAwaitingApproval
  const openThought = [...steps]
    .reverse()
    .find((step) => step.kind === 'thought' && step.phase === 'streaming')
  if (openThought) return t.input.activityThinking
  const openMessage = [...steps]
    .reverse()
    .find((step) => step.kind === 'message' && step.phase === 'streaming')
  if (openMessage) return t.input.activityWriting
  const openTool = [...steps]
    .reverse()
    .find((step) => step.kind === 'tool' && step.phase === 'started')
  if (openTool && openTool.kind === 'tool') {
    return t.input.activityRunningTool.replace('{tool}', openTool.name)
  }
  if (document.thinkingText?.trim()) return t.input.activityThinking
  return t.input.activityThinking
}

function formatDuration(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`
  const seconds = elapsedMs / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return `${minutes}m ${rem}s`
}
