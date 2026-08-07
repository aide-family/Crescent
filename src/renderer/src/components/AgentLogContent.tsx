import { AgentRunTimeline } from '@renderer/components/AgentRunTimeline'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import type { Dictionary } from '@renderer/i18n'
import {
  actionLogClassName,
  formatLogTime,
  logRoleLabel,
  summarizeBehaviorLog
} from '@renderer/lib/agent-log'
import { agentRunViewToDocument, parseAgentRunDocument } from '@renderer/lib/agent-run-document'
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
  onInjectSuggestions
}: {
  entry: AgentLogEntry
  liveRun?: AgentRunViewState | null
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
}): React.JSX.Element {
  if (isConversationLog(entry.kind)) {
    if (entry.kind === 'user') {
      return (
        <pre className="select-text min-w-0 overflow-x-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {entry.text}
        </pre>
      )
    }

    const parsedRun =
      entry.kind === 'assistant'
        ? liveRun
          ? agentRunViewToDocument(liveRun)
          : parseAgentRunDocument(entry.text, t)
        : null
    if (parsedRun) {
      return (
        <AgentRunTimeline
          document={parsedRun}
          t={t}
          copied={Boolean(copied)}
          feedbackRating={feedbackRating}
          feedbackBusy={feedbackBusy}
          onCopyResult={onCopyResult}
          onExportResult={onExportResult}
          onExportFull={onExportFull}
          onExportTrace={onExportTrace}
          onOpsFeedback={onOpsFeedback}
          onResolveApproval={onResolveApproval}
          onAddCommandToWhitelist={onAddCommandToWhitelist}
          onInjectSuggestions={onInjectSuggestions}
        />
      )
    }

    return <MarkdownContent value={entry.text} t={t} />
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
