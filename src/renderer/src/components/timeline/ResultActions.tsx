import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { extractResultSuggestions } from '@renderer/lib/result-suggestions'
import {
  BookMarkedIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  Loader2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpsHistoryRating } from '../../../../shared/agent-types'

export function ResultActionBar({
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
          className="select-none"
          aria-label={copied ? t.common.copied : t.common.copyResultTooltip}
          title={copied ? t.common.copied : t.common.copyResultTooltip}
          onPointerDown={(event) => event.preventDefault()}
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

export function ResultSuggestionsPicker({
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
