import { useEffect, useState } from 'react'
import {
  Loader2Icon,
  PencilIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { OpsHistoryRating, OpsHistoryRecord } from '../../../shared/agent-types'
import { resolveOpsConnectionId } from '../../../shared/local-connection'

interface ConnectionOpsFeedbackPanelProps {
  connectionId: string
  t: Dictionary
}

interface OpsFeedbackDraft {
  rating: OpsHistoryRating
  userGoal: string
  pathSummary: string
  lesson: string
}

export function ConnectionOpsFeedbackPanel({
  connectionId,
  t
}: ConnectionOpsFeedbackPanelProps): React.JSX.Element | null {
  const resolvedConnectionId = resolveOpsConnectionId(connectionId)
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<OpsHistoryRecord[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<OpsFeedbackDraft | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = await window.api.storage.listOpsFeedback({
          connectionId: resolvedConnectionId,
          limit: 100
        })
        if (!cancelled) setRecords(next)
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t.connections.opsFeedbackLoadFailed)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [resolvedConnectionId, t.connections.opsFeedbackLoadFailed])

  function startEdit(record: OpsHistoryRecord): void {
    setEditingId(record.id)
    setDraft({
      rating: record.rating,
      userGoal: record.userGoal,
      pathSummary: record.pathSummary,
      lesson: record.lesson
    })
  }

  function cancelEdit(): void {
    setEditingId(null)
    setDraft(null)
  }

  async function saveEdit(record: OpsHistoryRecord): Promise<void> {
    if (!draft) return
    const userGoal = draft.userGoal.trim()
    const pathSummary = draft.pathSummary.trim()
    if (!userGoal || !pathSummary) {
      toast.error(t.connections.opsFeedbackInvalid)
      return
    }

    setSavingId(record.id)
    try {
      const result = await window.api.storage.updateOpsFeedback({
        id: record.id,
        rating: draft.rating,
        userGoal,
        pathSummary,
        lesson: draft.lesson.trim()
      })
      if (!result.ok || !result.record) {
        toast.error(result.error || t.connections.opsFeedbackSaveFailed)
        return
      }
      setRecords((current) =>
        current.map((item) => (item.id === record.id ? result.record! : item))
      )
      cancelEdit()
      toast.success(t.connections.opsFeedbackSaveSucceeded)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.connections.opsFeedbackSaveFailed)
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRecord(record: OpsHistoryRecord): Promise<void> {
    if (!window.confirm(t.connections.opsFeedbackDeleteConfirm)) return

    setDeletingId(record.id)
    try {
      const result = await window.api.storage.deleteOpsFeedback(record.id)
      if (!result.ok) {
        toast.error(t.connections.opsFeedbackDeleteFailed)
        return
      }
      setRecords((current) => current.filter((item) => item.id !== record.id))
      if (editingId === record.id) cancelEdit()
      toast.success(t.connections.opsFeedbackDeleteSucceeded)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.connections.opsFeedbackDeleteFailed)
    } finally {
      setDeletingId(null)
    }
  }

  if (!connectionId.trim()) return null

  return (
    <div className="mt-6 space-y-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">{t.connections.opsFeedbackTitle}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t.connections.opsFeedbackDescription}
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-md border p-3 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          {t.connections.opsFeedbackLoading}
        </div>
      )}

      {!loading && records.length === 0 && (
        <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          {t.connections.opsFeedbackEmpty}
        </div>
      )}

      {!loading &&
        records.map((record) => {
          const editing = editingId === record.id
          const busy = savingId === record.id || deletingId === record.id

          return (
            <div key={record.id} className="rounded-md border bg-card p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {editing && draft ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={draft.rating === 'like' ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={() =>
                            setDraft((current) => current && { ...current, rating: 'like' })
                          }
                        >
                          <ThumbsUpIcon data-icon="inline-start" />
                          {t.common.likeResult}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draft.rating === 'dislike' ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={() =>
                            setDraft((current) => current && { ...current, rating: 'dislike' })
                          }
                        >
                          <ThumbsDownIcon data-icon="inline-start" />
                          {t.common.dislikeResult}
                        </Button>
                      </div>
                      <Field>
                        <FieldLabel>{t.connections.opsFeedbackUserGoal}</FieldLabel>
                        <Input
                          value={draft.userGoal}
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((current) =>
                              current ? { ...current, userGoal: event.target.value } : current
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>{t.connections.opsFeedbackPathSummary}</FieldLabel>
                        <Textarea
                          className="min-h-20 resize-y text-xs"
                          value={draft.pathSummary}
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((current) =>
                              current ? { ...current, pathSummary: event.target.value } : current
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>{t.connections.opsFeedbackLesson}</FieldLabel>
                        <Textarea
                          className="min-h-16 resize-y text-xs"
                          value={draft.lesson}
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((current) =>
                              current ? { ...current, lesson: event.target.value } : current
                            )
                          }
                        />
                      </Field>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={cancelEdit}
                        >
                          <XIcon data-icon="inline-start" />
                          {t.common.cancel}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => void saveEdit(record)}
                        >
                          {savingId === record.id ? (
                            <Loader2Icon className="animate-spin" data-icon="inline-start" />
                          ) : null}
                          {t.common.save}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={record.rating === 'like' ? 'default' : 'destructive'}>
                          {record.rating === 'like' ? t.common.likeResult : t.common.dislikeResult}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {formatUpdatedAt(record.updatedAt)}
                        </span>
                      </div>
                      <p className="break-words text-sm font-medium leading-snug">
                        {record.userGoal}
                      </p>
                      <p className="break-words text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {t.connections.opsFeedbackPathSummary}:{' '}
                        </span>
                        {record.pathSummary}
                      </p>
                      {record.lesson.trim() ? (
                        <p className="break-words text-muted-foreground">
                          <span className="font-medium text-foreground/80">
                            {t.connections.opsFeedbackLesson}:{' '}
                          </span>
                          {record.lesson}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                {!editing && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.common.edit}
                      title={t.common.edit}
                      disabled={busy}
                      onClick={() => startEdit(record)}
                    >
                      <PencilIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-xs"
                      aria-label={t.common.delete}
                      title={t.common.delete}
                      disabled={busy}
                      onClick={() => void deleteRecord(record)}
                    >
                      {deletingId === record.id ? (
                        <Loader2Icon className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2Icon aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
    </div>
  )
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
