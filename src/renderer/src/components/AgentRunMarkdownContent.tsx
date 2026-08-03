import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  Maximize2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon
} from 'lucide-react'

import { buildMarkdownHeadingId, MarkdownContent } from '@renderer/components/MarkdownContent'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { ParsedAgentRunMarkdown } from '@renderer/lib/agent-run-markdown'
import type { OpsHistoryRating } from '../../../shared/agent-types'

export function AgentRunMarkdownContent({
  parsed,
  t,
  copied,
  feedbackRating,
  feedbackBusy,
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace,
  onOpsFeedback
}: {
  parsed: ParsedAgentRunMarkdown
  t: Dictionary
  copied: boolean
  feedbackRating?: OpsHistoryRating | null
  feedbackBusy?: boolean
  onCopyResult?: () => void
  onExportResult?: () => void
  onExportFull?: () => void
  onExportTrace?: () => void
  onOpsFeedback?: (rating: OpsHistoryRating) => void
}): React.JSX.Element {
  const [resultExpanded, setResultExpanded] = useState(false)
  const hasResult = Boolean(parsed.resultMarkdown || parsed.errorMarkdown)
  const resultPreviewMarkdown = parsed.resultMarkdown || parsed.errorMarkdown
  const headingIdPrefix = useMemo(() => `agent-result-${crypto.randomUUID()}`, [])
  const resultHeadings = useMemo(
    () => extractMarkdownHeadings(resultPreviewMarkdown, headingIdPrefix),
    [headingIdPrefix, resultPreviewMarkdown]
  )

  return (
    <div className="min-w-0 space-y-3">
      {hasResult && (
        <section className="app-sticky-scope min-w-0 rounded-md border bg-card shadow-sm">
          <div className="app-sticky-section flex min-w-0 items-center justify-between gap-3 rounded-t-md border-b bg-card px-3 py-2">
            <div className="min-w-0 text-xs font-semibold text-foreground">
              {parsed.errorMarkdown ? t.input.error : t.input.result}
            </div>
            <div className="flex shrink-0 items-center gap-1">
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
            </div>
          </div>
          <div className="min-w-0 p-3">
            {parsed.resultMarkdown && <MarkdownContent value={parsed.resultMarkdown} t={t} />}
            {parsed.errorMarkdown && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                <MarkdownContent value={parsed.errorMarkdown} t={t} />
              </div>
            )}
          </div>
        </section>
      )}

      {parsed.actionsMarkdown && (
        <details
          className="app-sticky-scope group min-w-0 rounded-md border bg-muted/10 shadow-xs"
          open={hasResult ? undefined : true}
        >
          <summary className="app-sticky-section flex cursor-pointer select-none items-center justify-between gap-3 rounded-t-md border-b bg-card px-3 py-2 text-xs font-medium text-muted-foreground marker:content-none">
            <span>{hasResult ? t.input.actionSummaryCompleted : t.input.actionSummary}</span>
            <ChevronDownIcon
              className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="min-w-0 space-y-3 p-3">
            <MarkdownContent value={parsed.actionsMarkdown} t={t} />
            {parsed.elapsedMarkdown && (
              <div className="border-t pt-3 text-xs text-muted-foreground">
                <MarkdownContent value={parsed.elapsedMarkdown} t={t} />
              </div>
            )}
          </div>
        </details>
      )}
      {resultExpanded && resultPreviewMarkdown && (
        <ResultFullscreenPreview
          value={resultPreviewMarkdown}
          headings={resultHeadings}
          headingIdPrefix={headingIdPrefix}
          title={parsed.errorMarkdown ? t.input.error : t.input.result}
          t={t}
          onClose={() => setResultExpanded(false)}
        />
      )}
    </div>
  )
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
        <nav
          className="min-h-0 overflow-auto border-r bg-muted/15 p-3"
          aria-label={t.common.navigation}
        >
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t.common.navigation}
          </div>
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
