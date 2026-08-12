import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2Icon, XIcon } from 'lucide-react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import {
  type ParsedAgentRunDocument,
  safeParseAgentRunDocument
} from '@renderer/lib/agent-run-document'
import {
  AGENT_RESULT_CHUNK_CHARS,
  AGENT_STEP_PAGE_SIZE,
  chunkTextByChars,
  pageSteps
} from '@renderer/lib/agent-run-paging'
import { buildMarkdownHeadingId } from '@renderer/lib/markdown-heading'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'

export type FullAgentRunOverlayTab = 'steps' | 'result'

export function FullAgentRunOverlay({
  tabId,
  logId,
  runId,
  initialTab,
  t,
  onClose
}: {
  tabId: string
  logId: number
  runId?: string
  initialTab: FullAgentRunOverlayTab
  t: Dictionary
  onClose: () => void
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<FullAgentRunOverlayTab>(initialTab)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewOnlyHint, setPreviewOnlyHint] = useState(false)
  const [fullDocument, setFullDocument] = useState<ParsedAgentRunDocument | null>(null)
  const [resultFallback, setResultFallback] = useState('')
  const [stepLimit, setStepLimit] = useState(AGENT_STEP_PAGE_SIZE)
  const [resultChunkCount, setResultChunkCount] = useState(1)
  const stepsScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const row = await window.api.storage.getAgentLog({ tabId, logId })
        if (cancelled) return
        const parsed = row?.text ? safeParseAgentRunDocument(row.text, t) : null
        if (parsed) {
          setFullDocument(parsed)
          if (
            !parsed.steps.length &&
            !parsed.resultMarkdown?.trim() &&
            !parsed.errorMarkdown?.trim()
          ) {
            setPreviewOnlyHint(true)
          }
        } else {
          setPreviewOnlyHint(true)
        }

        const needsResultFallback =
          !parsed?.resultMarkdown?.trim() &&
          !parsed?.errorMarkdown?.trim() &&
          Boolean(runId?.trim())
        if (needsResultFallback && runId?.trim()) {
          const run = await window.api.storage.getAgentRun(runId.trim())
          if (cancelled) return
          if (run?.output?.trim()) {
            setResultFallback(run.output.trim())
          } else if (!parsed) {
            setError(t.input.fullRunLoadFailed)
          }
        } else if (!parsed) {
          setError(t.input.fullRunLoadFailed)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[crescent] FullAgentRunOverlay load failed', err)
          setError(t.input.fullRunLoadFailed)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [logId, runId, t, tabId])

  const resultMarkdown =
    fullDocument?.resultMarkdown?.trim() || fullDocument?.errorMarkdown?.trim() || resultFallback
  const resultChunks = useMemo(
    () => chunkTextByChars(resultMarkdown, AGENT_RESULT_CHUNK_CHARS),
    [resultMarkdown]
  )
  const visibleResult = resultChunks.slice(0, resultChunkCount).join('')
  const hasMoreResult = resultChunkCount < resultChunks.length

  const allSteps = fullDocument?.steps ?? []
  const visibleSteps = pageSteps(allSteps, 0, stepLimit)
  const hasMoreSteps = stepLimit < allSteps.length

  function handleStepsScroll(event: React.UIEvent<HTMLDivElement>): void {
    if (activeTab !== 'steps' || !hasMoreSteps) return
    const el = event.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      setStepLimit((current) => current + AGENT_STEP_PAGE_SIZE)
    }
  }

  useEffect(() => {
    if (activeTab !== 'steps' || loading || !hasMoreSteps) return
    const el = stepsScrollRef.current
    // Keep auto-loading when the list does not overflow yet, so short lists
    // also fill without requiring a scrollbar.
    if (el && el.scrollHeight <= el.clientHeight + 160) {
      setStepLimit((current) => current + AGENT_STEP_PAGE_SIZE)
    }
  }, [activeTab, hasMoreSteps, loading, stepLimit])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const headingIdPrefix = useMemo(() => `full-run-${logId}-`, [])
  const headings = useMemo(
    () => extractMarkdownHeadings(visibleResult, headingIdPrefix),
    [headingIdPrefix, visibleResult]
  )

  return createPortal(
    <div
      className="app-fullscreen-overlay fixed inset-0 z-50 flex flex-col overscroll-contain bg-background/98 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={t.input.fullRunTitle}
      data-testid="full-agent-run-overlay"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 truncate text-sm font-semibold">{t.input.fullRunTitle}</div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'steps' ? 'secondary' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setActiveTab('steps')}
            >
              {t.input.fullRunStepsTab}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'result' ? 'secondary' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setActiveTab('result')}
            >
              {t.input.fullRunResultTab}
            </Button>
          </div>
        </div>
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

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          <span>{t.input.fullRunLoading}</span>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div
          ref={stepsScrollRef}
          onScroll={handleStepsScroll}
          className="min-h-0 flex-1 overflow-auto p-5"
        >
          {previewOnlyHint ? (
            <div className="mx-auto mb-3 max-w-5xl rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              {t.input.fullRunPreviewOnly}
            </div>
          ) : null}

          {activeTab === 'steps' ? (
            <div className="mx-auto max-w-5xl space-y-3">
              {allSteps.length === 0 ? (
                <div className="rounded-md border bg-card/80 p-5 text-sm text-muted-foreground">
                  {t.input.fullRunNoSteps}
                </div>
              ) : (
                <>
                  <div className="min-w-0 space-y-2 rounded-xl border bg-card/80 p-4">
                    {visibleSteps.map((step) => (
                      <FullRunStepRow key={step.id} step={step} t={t} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <nav
                className="hidden min-h-0 overflow-auto rounded-md border bg-muted/15 p-3 lg:block"
                aria-label={t.common.navigation}
              >
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  {t.common.navigation}
                </div>
                {headings.length === 0 ? (
                  <div className="rounded-md border bg-background/60 p-2 text-xs text-muted-foreground">
                    {t.input.fullRunResultTab}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {headings.map((heading) => (
                      <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        className="block truncate rounded-md px-2 py-1.5 text-xs text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        style={{ paddingLeft: `${8 + Math.max(0, heading.level - 1) * 10}px` }}
                      >
                        {heading.text}
                      </a>
                    ))}
                  </div>
                )}
              </nav>
              <div className="min-w-0 space-y-3 rounded-xl border bg-card/80 p-5">
                {resultMarkdown ? (
                  <>
                    <MarkdownContent
                      value={visibleResult}
                      t={t}
                      headingIdPrefix={headingIdPrefix}
                    />
                    {hasMoreResult ? (
                      <div className="flex justify-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setResultChunkCount((current) => current + 1)}
                        >
                          {t.input.fullRunLoadMoreResult}
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">{t.input.fullRunNoResult}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}

function FullRunStepRow({ step, t }: { step: AgentRunStep; t: Dictionary }): React.JSX.Element {
  if (step.kind === 'thought') {
    return (
      <div className="text-[12px] leading-relaxed text-muted-foreground italic whitespace-pre-wrap break-words">
        <span className="mr-1.5 not-italic text-muted-foreground/70">
          {t.input.thinkingProcessCompleted}
        </span>
        {step.text}
      </div>
    )
  }
  if (step.kind === 'message') {
    return (
      <div className="min-w-0 text-[14px] leading-relaxed text-foreground/90">
        <MarkdownContent value={step.text} t={t} />
      </div>
    )
  }
  if (step.kind === 'tool') {
    return (
      <div className="min-w-0 space-y-1 rounded-lg border border-border/60 bg-muted/15 px-2.5 py-2 text-[12px]">
        <div className="font-medium text-foreground/85">{step.name}</div>
        {step.command ? (
          <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
            {step.command}
          </pre>
        ) : null}
        {step.resultText ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {step.resultText}
          </pre>
        ) : null}
      </div>
    )
  }
  if (step.kind === 'status') {
    return (
      <div className="text-[11px] text-muted-foreground/80" title={step.detail}>
        {step.title}
      </div>
    )
  }
  if (step.kind === 'user-supplement') {
    return (
      <pre className="whitespace-pre-wrap break-words rounded border bg-primary/5 px-2 py-1.5 text-sm">
        {step.text}
      </pre>
    )
  }
  if (step.kind === 'approval') {
    return (
      <div className="rounded border px-2 py-1.5 text-xs text-muted-foreground">{step.command}</div>
    )
  }
  return <div className="text-xs text-muted-foreground">—</div>
}

interface MarkdownHeading {
  id: string
  level: number
  text: string
}

function extractMarkdownHeadings(value: string, prefix: string): MarkdownHeading[] {
  let index = 0
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^(#{1,4})\s+(.+)$/)
      if (!match) return []
      const level = match[1].length
      const text = match[2].trim()
      if (!text) return []
      const id = buildMarkdownHeadingId(prefix, text, index)
      index += 1
      return [{ id, level, text }]
    })
}
