import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  Loader2Icon,
  Maximize2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  XIcon
} from 'lucide-react'

import { buildMarkdownHeadingId, MarkdownContent } from '@renderer/components/MarkdownContent'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { ParsedAgentRunDocument } from '@renderer/lib/agent-run-document'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import type { CommandRiskLevel, OpsHistoryRating } from '../../../shared/agent-types'

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
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace,
  onOpsFeedback,
  onResolveApproval
}: {
  document: ParsedAgentRunDocument
  t: Dictionary
  copied: boolean
  feedbackRating?: OpsHistoryRating | null
  feedbackBusy?: boolean
  onCopyResult?: () => void
  onExportResult?: () => void
  onExportFull?: () => void
  onExportTrace?: () => void
  onOpsFeedback?: (rating: OpsHistoryRating) => void
  onResolveApproval?: (requestId: string, approved: boolean, note?: string) => void
}): React.JSX.Element {
  const [resultExpanded, setResultExpanded] = useState(false)
  const hasResult = Boolean(document.resultMarkdown?.trim() || document.errorMarkdown?.trim())
  const resultPreviewMarkdown = document.resultMarkdown || document.errorMarkdown
  const headingIdPrefix = useMemo(() => `agent-result-${crypto.randomUUID()}`, [])
  const resultHeadings = useMemo(
    () => extractMarkdownHeadings(resultPreviewMarkdown, headingIdPrefix),
    [headingIdPrefix, resultPreviewMarkdown]
  )
  const runFinished = typeof document.elapsedMs === 'number'
  const streamingResult = Boolean(document.resultMarkdown?.trim()) && !runFinished
  const visibleSteps = document.steps.filter((step) => !isNoiseStatusStep(step))
  const activity = resolveActivity(document, visibleSteps, t)
  const showActivity =
    Boolean(activity) &&
    !runFinished &&
    (!hasResult || activity === t.input.activityAwaitingApproval)

  return (
    <div className="min-w-0 space-y-2.5">
      {showActivity ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          <span>{activity}</span>
        </div>
      ) : null}

      {document.thinkingText?.trim() ? (
        <ThinkingBlock
          text={document.thinkingText}
          streaming={!hasResult && !document.errorMarkdown && !runFinished}
          t={t}
        />
      ) : null}

      {visibleSteps.length > 0 ? (
        <div className="space-y-1.5">
          {visibleSteps.map((step) => {
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
            if (step.kind === 'tool') {
              return <ToolCallRow key={step.id} step={step} t={t} />
            }
            if (step.kind === 'approval') {
              return (
                <ApprovalStepCard key={step.id} step={step} t={t} onResolve={onResolveApproval} />
              )
            }
            return null
          })}
        </div>
      ) : null}

      {hasResult ? (
        <div className="min-w-0 space-y-2">
          {document.resultMarkdown?.trim() ? (
            <div className="min-w-0 text-sm leading-relaxed text-foreground">
              <MarkdownContent value={document.resultMarkdown} t={t} />
              {streamingResult ? (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/50 align-middle" />
              ) : null}
            </div>
          ) : null}
          {document.errorMarkdown?.trim() ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <MarkdownContent value={document.errorMarkdown} t={t} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1 pt-0.5">
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
                      ? 'text-emerald-400 hover:text-emerald-300'
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
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t.common.enlarge}
              title={t.common.enlarge}
              onClick={() => setResultExpanded(true)}
            >
              <Maximize2Icon aria-hidden="true" />
            </Button>
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
            {typeof document.elapsedMs === 'number' || document.elapsedMarkdown ? (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {typeof document.elapsedMs === 'number'
                  ? formatDuration(document.elapsedMs)
                  : document.elapsedMarkdown}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {resultExpanded && resultPreviewMarkdown ? (
        <ResultFullscreenPreview
          value={resultPreviewMarkdown}
          headings={resultHeadings}
          headingIdPrefix={headingIdPrefix}
          title={document.errorMarkdown ? t.input.error : t.input.result}
          t={t}
          onClose={() => setResultExpanded(false)}
        />
      ) : null}
    </div>
  )
}

function ThinkingBlock({
  text,
  streaming,
  t
}: {
  text: string
  streaming: boolean
  t: Dictionary
}): React.JSX.Element {
  return (
    <details className="group min-w-0" open={streaming}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground marker:content-none">
        <ChevronRightIcon
          className="size-3 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {streaming ? <Loader2Icon className="size-3 animate-spin" aria-hidden="true" /> : null}
        <span>{streaming ? t.input.thinkingProcessStreaming : t.input.thinkingProcessCompleted}</span>
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto border-l border-border/60 pl-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground/90">
        {text}
      </pre>
    </details>
  )
}

function ToolCallRow({
  step,
  t
}: {
  step: Extract<AgentRunStep, { kind: 'tool' }>
  t: Dictionary
}): React.JSX.Element {
  const running = step.phase === 'started'
  const preview = step.command?.trim() || summarizeArgs(step.argsText)
  const isBash = step.name === 'bash' || step.name === 'terminal' || Boolean(step.command)
  const isFileTool = step.name === 'read' || step.name === 'write' || step.name === 'edit'

  return (
    <details
      className="group min-w-0 rounded-md border border-transparent hover:border-border/50"
      open={running || Boolean(step.isError)}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-1 py-1 marker:content-none">
        <ChevronRightIcon
          className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {running ? (
          <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              step.isError ? 'bg-destructive' : 'bg-emerald-500/80'
            }`}
            aria-hidden="true"
          />
        )}
        <span className="shrink-0 text-xs font-medium text-foreground">{step.name}</span>
        {preview ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {preview}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {running ? t.input.toolRunning : step.isError ? t.input.toolFailed : t.input.toolFinished}
          </span>
        )}
      </summary>
      <div className="ml-5 space-y-2 border-l border-border/50 py-1.5 pl-3 text-[11px]">
        {isBash ? (
          <div className="text-[10px] text-muted-foreground">{t.input.toolTerminalHint}</div>
        ) : null}
        {isFileTool ? (
          <div className="text-[10px] text-muted-foreground">{t.input.toolWorkspaceHint}</div>
        ) : null}
        {step.command ? (
          <pre className="overflow-auto rounded bg-muted/25 p-2 font-mono whitespace-pre-wrap break-words">
            {step.command}
          </pre>
        ) : step.argsText ? (
          <pre className="overflow-auto rounded bg-muted/25 p-2 font-mono whitespace-pre-wrap break-words">
            {step.argsText}
          </pre>
        ) : null}
        {step.resultText ? (
          <pre className="max-h-56 overflow-auto rounded bg-muted/25 p-2 font-mono whitespace-pre-wrap break-words text-muted-foreground">
            {step.resultText}
          </pre>
        ) : null}
      </div>
    </details>
  )
}

function ApprovalStepCard({
  step,
  t,
  onResolve
}: {
  step: Extract<AgentRunStep, { kind: 'approval' }>
  t: Dictionary
  onResolve?: (requestId: string, approved: boolean, note?: string) => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  const pending = step.phase === 'pending'
  const risk = step.risk ?? 'medium'

  return (
    <div
      className={
        pending
          ? 'min-w-0 rounded-md border border-amber-500/35 bg-amber-500/5'
          : 'min-w-0 rounded-md border border-border/60'
      }
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
            <TriangleAlertIcon className="size-3.5 text-amber-500" aria-hidden="true" />
            <span>{t.commandReview.title}</span>
            <Badge variant={riskBadgeVariant(risk)}>{riskLabel(risk, t)}</Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t.commandReview.description}</p>
        </div>
        <div className="shrink-0 text-[10px] text-muted-foreground">
          {step.phase === 'pending'
            ? t.input.approvalPending
            : step.phase === 'approved'
              ? t.input.approvalAllowed
              : t.input.approvalDenied}
        </div>
      </div>

      <div className="space-y-2.5 border-t border-border/40 px-3 py-2.5 text-[11px]">
        <pre className="overflow-auto rounded bg-muted/25 p-2 font-mono whitespace-pre-wrap break-words">
          {step.command}
        </pre>
        {step.auditSummary ? <p className="text-foreground/90">{step.auditSummary}</p> : null}
        {step.operationReason ? (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground/80">{t.commandReview.operationReason}: </span>
            {step.operationReason}
          </p>
        ) : null}
        {step.riskPoints && step.riskPoints.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {step.riskPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        ) : null}
        {step.impactAnalysis ? <p className="text-muted-foreground">{step.impactAnalysis}</p> : null}
        {step.recommendation ? (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground/80">{t.commandReview.recommendation}: </span>
            {step.recommendation}
          </p>
        ) : null}

        {pending && onResolve ? (
          <>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t.commandReview.decisionNotePlaceholder}
              className="min-h-14 resize-y text-xs"
            />
            <div className="flex flex-wrap gap-2">
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
                variant="outline"
                onClick={() => onResolve(step.requestId, false, note.trim() || undefined)}
              >
                {t.commandReview.reject}
              </Button>
            </div>
          </>
        ) : null}

        {!pending && (step.note || step.rejectionReason) ? (
          <p className="text-muted-foreground">{step.note || step.rejectionReason}</p>
        ) : null}
      </div>
    </div>
  )
}

function isNoiseStatusStep(step: AgentRunStep): boolean {
  if (step.kind !== 'status') return false
  const title = step.title.trim()
  return (
    /^Agent started\.?$/i.test(title) ||
    /^Thinking…$/i.test(title) ||
    /^Thinking\.\.\.$/i.test(title) ||
    title === 'Agent finished.'
  )
}

function summarizeArgs(argsText: string | undefined): string | undefined {
  if (!argsText?.trim()) return undefined
  const trimmed = argsText.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 77)}…`
}

function riskBadgeVariant(risk: CommandRiskLevel): 'default' | 'secondary' | 'destructive' | 'outline' {
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
  const openTool = [...steps].reverse().find((step) => step.kind === 'tool' && step.phase === 'started')
  if (openTool && openTool.kind === 'tool') {
    return t.input.activityRunningTool.replace('{tool}', openTool.name)
  }
  if (document.resultMarkdown?.trim()) return t.input.activityWriting
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

interface MarkdownHeading {
  id: string
  level: number
  text: string
}

function ResultFullscreenPreview({
  value,
  headings,
  headingIdPrefix,
  title,
  t,
  onClose
}: {
  value: string
  headings: MarkdownHeading[]
  headingIdPrefix: string
  title: string
  t: Dictionary
  onClose: () => void
}): React.JSX.Element {
  return createPortal(
    <div
      className="app-fullscreen-overlay fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
        <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t.common.close}
          title={t.common.close}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
        <nav className="min-h-0 overflow-auto border-r bg-muted/15 p-3" aria-label={t.common.navigation}>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t.common.navigation}</div>
          {headings.length === 0 ? (
            <div className="rounded-md border bg-background/60 p-2 text-xs text-muted-foreground">
              {title}
            </div>
          ) : (
            <div className="space-y-1">
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className="block truncate rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                  style={{ paddingLeft: `${8 + Math.max(0, heading.level - 1) * 10}px` }}
                >
                  {heading.text}
                </a>
              ))}
            </div>
          )}
        </nav>
        <div className="min-h-0 overflow-auto p-5">
          <div className="mx-auto max-w-5xl rounded-md border bg-card/80 p-5">
            <MarkdownContent value={value} t={t} headingIdPrefix={headingIdPrefix} />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function extractMarkdownHeadings(value: string, prefix: string): MarkdownHeading[] {
  let index = 0
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^(#{1,4})\s+(.+)$/)
      if (!match) return []
      const text = stripInlineMarkdown(match[2]).trim()
      const heading: MarkdownHeading = {
        id: buildMarkdownHeadingId(prefix, text, index),
        level: match[1].length,
        text
      }
      index += 1
      return [heading]
    })
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[<#>*_~]/g, '')
}
