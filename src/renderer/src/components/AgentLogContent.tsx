import { AgentRunTimeline } from '@renderer/components/AgentRunTimeline'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import type { Dictionary } from '@renderer/i18n'
import {
  actionLogClassName,
  formatLogTime,
  logRoleLabel,
  summarizeBehaviorLog
} from '@renderer/lib/agent-log'
import {
  agentRunViewToDocument,
  isAgentRunDocumentParseStub,
  looksLikeAgentRunDocument,
  safeParseAgentRunDocument
} from '@renderer/lib/agent-run-document'
import { AGENT_RUN_STREAM_MAX_CHARS, clampAgentText } from '@renderer/lib/agent-text-limits'
import type { AgentLogEntry, AgentRunViewState } from '@renderer/lib/terminal-tabs'

export function ActionLogRow({
  entry,
  t
}: {
  entry: AgentLogEntry
  t: Dictionary
}): React.JSX.Element {
  const summary = summarizeBehaviorLog(entry.text, entry.kind, t)

  return (
    <details
      className={`group rounded-md border text-[11px] text-muted-foreground shadow-none ${actionLogClassName(entry.kind)}`}
    >
      <summary className="grid cursor-pointer select-none grid-cols-[4.5rem_4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-1 marker:text-muted-foreground/70">
        <span className="truncate font-medium tracking-wide text-muted-foreground">
          {logRoleLabel(entry.kind, t)}
        </span>
        <time className="text-muted-foreground/80" dateTime={entry.createdAt}>
          {formatLogTime(entry.createdAt)}
        </time>
        <span className="truncate text-muted-foreground">{summary}</span>
      </summary>
      <pre className="select-text max-h-56 min-w-0 overflow-auto border-t border-border/50 bg-background/60 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
        {entry.text}
      </pre>
    </details>
  )
}

export function AgentLogContent({
  entry,
  liveRun,
  tabId,
  t,
  copied,
  feedbackRating,
  feedbackBusy,
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace,
  onOpsFeedback,
  onResolveApproval,
  onAddCommandToWhitelist,
  onInjectSuggestions,
  onOpenModelSettings,
  onSaveAsSop
}: {
  entry: AgentLogEntry
  liveRun?: AgentRunViewState | null
  tabId?: string
  t: Dictionary
  copied?: boolean
  feedbackRating?: 'like' | 'dislike' | null
  feedbackBusy?: boolean
  onCopyResult?: () => void
  onExportResult?: () => void
  onExportFull?: () => void
  onExportTrace?: () => void
  onOpsFeedback?: (rating: 'like' | 'dislike') => void
  onResolveApproval?: (requestId: string, approved: boolean, note?: string) => void
  onAddCommandToWhitelist?: (command: string) => void
  onInjectSuggestions?: (texts: string[]) => void
  onOpenModelSettings?: () => void
  onSaveAsSop?: () => void
}): React.JSX.Element {
  if (isConversationLog(entry.kind)) {
    if (entry.kind === 'user') {
      return (
        <pre className="select-text min-w-0 overflow-x-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {clampAgentText(entry.text)}
        </pre>
      )
    }

    // Prefer liveRun while streaming — do not re-parse a potentially huge entry.text snapshot.
    // Isolate parse failures to this entry only; never throw into the chat tree / new-turn path.
    let parsedRun: ReturnType<typeof safeParseAgentRunDocument> = null
    let showParseStub = false
    if (entry.kind === 'assistant') {
      try {
        if (liveRun) {
          parsedRun = agentRunViewToDocument(liveRun)
        } else if (isAgentRunDocumentParseStub(entry.text)) {
          showParseStub = true
        } else {
          parsedRun = safeParseAgentRunDocument(entry.text, t)
          if (!parsedRun && looksLikeAgentRunDocument(entry.text)) {
            showParseStub = true
          }
        }
      } catch (error) {
        console.warn('[crescent] AgentLogContent parse isolated; showing stub', error)
        parsedRun = null
        showParseStub = true
      }
    }

    if (parsedRun) {
      return (
        <AgentRunTimeline
          document={parsedRun}
          t={t}
          copied={Boolean(copied)}
          feedbackRating={feedbackRating}
          feedbackBusy={feedbackBusy}
          storageRef={
            tabId
              ? {
                  tabId,
                  logId: entry.id,
                  runId: liveRun?.runId
                }
              : undefined
          }
          onCopyResult={onCopyResult}
          onExportResult={onExportResult}
          onExportFull={onExportFull}
          onExportTrace={onExportTrace}
          onOpsFeedback={onOpsFeedback}
          onResolveApproval={onResolveApproval}
          onAddCommandToWhitelist={onAddCommandToWhitelist}
          onInjectSuggestions={onInjectSuggestions}
          onOpenModelSettings={onOpenModelSettings}
          onSaveAsSop={onSaveAsSop}
        />
      )
    }

    if (!liveRun && entry.kind === 'assistant' && showParseStub) {
      return (
        <div
          className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="agent-run-document-stub"
        >
          {t.input.runDocumentCorrupt}
        </div>
      )
    }

    return (
      <MarkdownContent
        value={clampAgentText(entry.text, AGENT_RUN_STREAM_MAX_CHARS)}
        t={t}
      />
    )
  }

  const summary = summarizeBehaviorLog(entry.text, entry.kind, t)

  return (
    <details className="group rounded-md border bg-card shadow-xs">
      <summary className="app-sticky-section cursor-pointer border-b bg-card px-3 py-2 text-sm font-medium marker:text-muted-foreground">
        {summary}
      </summary>
      <pre className="select-text max-h-80 min-w-0 overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
        {entry.text}
      </pre>
    </details>
  )
}

function isConversationLog(kind: AgentLogEntry['kind']): boolean {
  return kind === 'user' || kind === 'assistant' || kind === 'error'
}
