import { AgentRunMarkdownContent } from '@renderer/components/AgentRunMarkdownContent'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import type { Dictionary } from '@renderer/i18n'
import {
  actionLogClassName,
  formatLogTime,
  logRoleLabel,
  summarizeBehaviorLog
} from '@renderer/lib/agent-log'
import { parseAgentRunMarkdown } from '@renderer/lib/agent-run-markdown'
import type { AgentLogEntry } from '@renderer/lib/terminal-tabs'

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
      className={`group rounded-md border text-xs shadow-xs ${actionLogClassName(entry.kind)}`}
    >
      <summary className="grid cursor-pointer select-none grid-cols-[5.5rem_4.75rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 marker:text-muted-foreground">
        <span className="truncate font-medium uppercase tracking-wide">
          {logRoleLabel(entry.kind, t)}
        </span>
        <time className="text-muted-foreground" dateTime={entry.createdAt}>
          {formatLogTime(entry.createdAt)}
        </time>
        <span className="truncate text-foreground/90">{summary}</span>
      </summary>
      <pre className="select-text max-h-72 min-w-0 overflow-auto border-t bg-background/80 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
        {entry.text}
      </pre>
    </details>
  )
}

export function AgentLogContent({
  entry,
  t,
  copied,
  onCopyResult,
  onExportResult,
  onExportFull
}: {
  entry: AgentLogEntry
  t: Dictionary
  copied?: boolean
  onCopyResult?: () => void
  onExportResult?: () => void
  onExportFull?: () => void
}): React.JSX.Element {
  if (isConversationLog(entry.kind)) {
    if (entry.kind === 'user') {
      return (
        <pre className="select-text min-w-0 overflow-x-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {entry.text}
        </pre>
      )
    }

    const parsedRun = entry.kind === 'assistant' ? parseAgentRunMarkdown(entry.text, t) : null
    if (parsedRun) {
      return (
        <AgentRunMarkdownContent
          parsed={parsedRun}
          t={t}
          copied={Boolean(copied)}
          onCopyResult={onCopyResult}
          onExportResult={onExportResult}
          onExportFull={onExportFull}
        />
      )
    }

    return <MarkdownContent value={entry.text} t={t} />
  }

  const summary = summarizeBehaviorLog(entry.text, entry.kind, t)

  return (
    <details className="group rounded-md border bg-card/80 shadow-xs">
      <summary className="sticky top-0 z-10 cursor-pointer border-b bg-card/95 px-3 py-2 text-sm font-medium backdrop-blur marker:text-muted-foreground">
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
