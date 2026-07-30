import type { RefObject } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { ActionLogRow, AgentLogContent } from '@renderer/components/AgentLogContent'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import {
  formatLogTime,
  isConversationLog,
  logClassName,
  logRoleLabel
} from '@renderer/lib/agent-log'
import type { AgentLogEntry } from '@renderer/lib/terminal-tabs'

export function AgentLogList({
  logRef,
  entries,
  copiedLogId,
  thinking,
  thinkingMessage,
  t,
  onCopyEntry,
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace
}: {
  logRef: RefObject<HTMLDivElement | null>
  entries: AgentLogEntry[]
  copiedLogId?: number | null
  thinking?: boolean
  thinkingMessage?: string
  t: Dictionary
  onCopyEntry: (entry: AgentLogEntry) => void
  onCopyResult: (entry: AgentLogEntry) => void
  onExportResult: (entry: AgentLogEntry) => void
  onExportFull: (entry: AgentLogEntry) => void
  onExportTrace: (entry: AgentLogEntry) => void
}): React.JSX.Element {
  return (
    <div ref={logRef} className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-4 text-sm">
      {entries.map((entry, entryIndex) => (
        <div
          key={entry.id}
          data-agent-log-entry={entry.id}
          className={
            isConversationLog(entry.kind)
              ? `${logClassName(entry.kind)} min-w-0 ${entryIndex === 0 ? 'mt-4' : 'mt-2'}`
              : `min-w-0 ${entryIndex === 0 ? 'mt-4' : 'mt-2'}`
          }
        >
          {isConversationLog(entry.kind) ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium uppercase tracking-wide">
                    {logRoleLabel(entry.kind, t)}
                  </span>
                  <time dateTime={entry.createdAt}>{formatLogTime(entry.createdAt)}</time>
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
                t={t}
                copied={copiedLogId === entry.id}
                onCopyResult={() => onCopyResult(entry)}
                onExportResult={() => onExportResult(entry)}
                onExportFull={() => onExportFull(entry)}
                onExportTrace={() => onExportTrace(entry)}
              />
            </>
          ) : (
            <ActionLogRow entry={entry} t={t} />
          )}
        </div>
      ))}
      {thinking ? (
        <div className="mt-3 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
            {t.input.thinking}
          </div>
          <p className="mt-1 leading-relaxed">{thinkingMessage || t.input.thinkingAnalyzingRequest}</p>
        </div>
      ) : null}
    </div>
  )
}
