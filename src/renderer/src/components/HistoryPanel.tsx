import { FileTextIcon, Loader2Icon, PencilIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import type { Dictionary } from '@renderer/i18n'
import { formatHistoryTime } from '@renderer/lib/agent-log'
import type { StoredSessionHistoryItem } from '../../../shared/agent-types'

export interface HistoryPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  loading: boolean
  items: StoredSessionHistoryItem[]
  titleEditingId: string | null
  titleDraft: string
  titleSavingId: string | null
  savingWikiTabId: string | null
  onTitleDraftChange: (value: string) => void
  onRefresh: () => void
  onOpenSession: (item: StoredSessionHistoryItem) => void
  onStartRename: (item: StoredSessionHistoryItem) => void
  onCancelRename: () => void
  onSaveTitle: (item: StoredSessionHistoryItem) => void
  onSaveToWiki: (item: StoredSessionHistoryItem) => void
  onDeleteSession: (item: StoredSessionHistoryItem) => void
}

export function summarizeHistoryMessage(value: string): string {
  const compact = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (compact.length <= 120) return compact
  return `${compact.slice(0, 120)}…`
}

export function HistoryPanel({
  open,
  onOpenChange,
  t,
  loading,
  items,
  titleEditingId,
  titleDraft,
  titleSavingId,
  savingWikiTabId,
  onTitleDraftChange,
  onRefresh,
  onOpenSession,
  onStartRename,
  onCancelRename,
  onSaveTitle,
  onSaveToWiki,
  onDeleteSession
}: HistoryPanelProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[560px] sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{t.history.title}</SheetTitle>
          <SheetDescription>{t.history.description}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-list min-h-0 flex-1 space-y-2 overflow-auto px-4">
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              {t.history.loading}
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {t.history.empty}
            </div>
          )}
          {!loading &&
            items.map((item) => {
              const editing = titleEditingId === item.tabId

              return (
                <div
                  key={item.tabId}
                  className="rounded-lg border border-border/70 bg-card/70 p-3 text-sm transition-[border-color,background-color] hover:border-border hover:bg-muted/25"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      {editing ? (
                        <div className="space-y-2">
                          <Input
                            value={titleDraft}
                            onChange={(event) => onTitleDraftChange(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void onSaveTitle(item)
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                onCancelRename()
                              }
                            }}
                            aria-label={t.history.renameTitle}
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={onCancelRename}
                            >
                              {t.common.cancel}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!titleDraft.trim() || titleSavingId === item.tabId}
                              onClick={() => void onSaveTitle(item)}
                            >
                              {titleSavingId === item.tabId && (
                                <Loader2Icon className="animate-spin" data-icon="inline-start" />
                              )}
                              {t.common.save}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="block w-full min-w-0 overflow-hidden text-left"
                          onClick={() => void onOpenSession(item)}
                          title={item.title}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {item.title}
                            </span>
                            {item.isSsh && (
                              <Badge variant="secondary" className="shrink-0">
                                SSH
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            <time
                              className="shrink-0"
                              dateTime={item.lastMessageAt ?? item.updatedAt}
                            >
                              {formatHistoryTime(item.lastMessageAt ?? item.updatedAt)}
                            </time>
                            {item.connectionName && (
                              <span className="min-w-0 truncate">· {item.connectionName}</span>
                            )}
                            <span className="shrink-0">
                              · {item.runCount} {t.history.runs}
                            </span>
                          </div>
                          {(item.summary || item.lastMessage) && (
                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                              {item.summary ?? summarizeHistoryMessage(item.lastMessage ?? '')}
                            </p>
                          )}
                        </button>
                      )}
                    </div>
                    {!editing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t.history.renameTitle}: ${item.title}`}
                          title={`${t.history.renameTitle}: ${item.title}`}
                          onClick={() => onStartRename(item)}
                        >
                          <PencilIcon aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t.wiki.saveFromHistory}: ${item.title}`}
                          title={`${t.wiki.saveFromHistory}: ${item.title}`}
                          disabled={savingWikiTabId === item.tabId}
                          onClick={() => void onSaveToWiki(item)}
                        >
                          {savingWikiTabId === item.tabId ? (
                            <Loader2Icon className="animate-spin" aria-hidden="true" />
                          ) : (
                            <FileTextIcon aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t.common.delete}: ${item.title}`}
                          title={`${t.common.delete}: ${item.title}`}
                          onClick={() => void onDeleteSession(item)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => void onRefresh()}
            disabled={loading}
          >
            {loading && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {t.history.refresh}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
