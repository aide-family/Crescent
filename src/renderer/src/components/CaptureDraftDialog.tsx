import { useEffect, useRef, useState, type JSX } from 'react'
import { Loader2Icon, SparklesIcon } from 'lucide-react'

import { ImeSafeInput, ImeSafeTextarea } from '@renderer/components/ImeSafeFields'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { SkillMarkdownPreview } from '@renderer/components/SkillMarkdownPreview'
import { SkillManageStatus } from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import type { Dictionary } from '@renderer/i18n'
import {
  resolveCaptureDraftParentSync,
  type CaptureDraftFields
} from '@renderer/lib/capture-draft-ui'
import type { CaptureKind } from '../../../shared/agent-types'

export interface CaptureDraftDialogProps {
  open: boolean
  kind: CaptureKind
  t: Dictionary
  title: string
  content: string
  skillName: string
  notes: string
  overwrite: boolean
  generating: boolean
  refining: boolean
  committing: boolean
  error: string | null
  conflict: boolean
  onOpenChange: (open: boolean) => void
  onFlush: (fields: CaptureDraftFields) => void
  onOverwriteChange: (value: boolean) => void
  onRefine: (fields: CaptureDraftFields) => void
  onCommit: (fields: CaptureDraftFields) => void
}

export function CaptureDraftDialog({
  open,
  kind,
  t,
  title,
  content,
  skillName,
  notes,
  overwrite,
  generating,
  refining,
  committing,
  error,
  conflict,
  onOpenChange,
  onFlush,
  onOverwriteChange,
  onRefine,
  onCommit
}: CaptureDraftDialogProps): JSX.Element {
  const busy = generating || refining || committing
  const [localTitle, setLocalTitle] = useState(title)
  const [localContent, setLocalContent] = useState(content)
  const [localSkillName, setLocalSkillName] = useState(skillName)
  const [localNotes, setLocalNotes] = useState(notes)
  const fieldsRef = useRef<CaptureDraftFields>({ title, content, skillName, notes })
  const wasOpenRef = useRef(false)
  const wasBusyRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const canCommit = Boolean(localContent.trim()) && !busy

  function writeFields(next: CaptureDraftFields): void {
    fieldsRef.current = next
    setLocalTitle(next.title)
    setLocalContent(next.content)
    setLocalSkillName(next.skillName)
    setLocalNotes(next.notes)
  }

  function patchFields(patch: Partial<CaptureDraftFields>): void {
    const next = { ...fieldsRef.current, ...patch }
    fieldsRef.current = next
    if (patch.title != null) setLocalTitle(patch.title)
    if (patch.content != null) setLocalContent(patch.content)
    if (patch.skillName != null) setLocalSkillName(patch.skillName)
    if (patch.notes != null) setLocalNotes(patch.notes)
  }

  useEffect(() => {
    const generatingBusy = generating || refining
    const mode = resolveCaptureDraftParentSync({
      open,
      wasOpen: wasOpenRef.current,
      busy: generatingBusy,
      wasBusy: wasBusyRef.current
    })
    wasOpenRef.current = open
    wasBusyRef.current = generatingBusy
    if (mode === 'full') {
      writeFields({ title, content, skillName, notes })
    } else if (mode === 'generated') {
      writeFields({
        title,
        content,
        skillName,
        notes: fieldsRef.current.notes
      })
    }
  }, [open, generating, refining, title, content, skillName, notes])

  function currentFields(): CaptureDraftFields {
    return fieldsRef.current
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onFlush(currentFields())
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="h-[min(85vh,900px)] w-[80vw] max-w-[80vw] gap-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>
              {kind === 'skill' ? t.capture.titleSkill : t.capture.titleSop}
            </DialogTitle>
            <Badge variant="outline">{kind === 'skill' ? t.input.tagSkill : t.input.tagSop}</Badge>
          </div>
          <DialogDescription>{t.capture.description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-2">
          <div className="grid shrink-0 gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t.capture.titleLabel}
              <ImeSafeInput
                ref={titleInputRef}
                value={localTitle}
                onValueChange={(value) => patchFields({ title: value })}
                onBlur={() => onFlush(currentFields())}
                disabled={generating}
              />
            </label>
            {kind === 'skill' ? (
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t.capture.skillNameLabel}
                <ImeSafeInput
                  value={localSkillName}
                  onValueChange={(value) => patchFields({ skillName: value })}
                  onBlur={() => onFlush(currentFields())}
                  disabled={generating}
                />
              </label>
            ) : null}
          </div>

          {generating && !localContent ? (
            <div className="app-empty-state flex items-center gap-2">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              {t.capture.generating}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <label className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1 text-xs text-muted-foreground">
                {t.capture.edit}
                <ImeSafeTextarea
                  className="h-full min-h-0 resize-none font-mono text-xs [field-sizing:fixed]"
                  value={localContent}
                  onValueChange={(value) => patchFields({ content: value })}
                  onBlur={() => onFlush(currentFields())}
                  disabled={generating}
                />
              </label>
              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1 text-xs text-muted-foreground">
                {t.capture.preview}
                <div className="min-h-0 overflow-auto border-l-2 border-primary pl-3">
                  {kind === 'skill' ? (
                    <SkillMarkdownPreview
                      content={localContent}
                      t={t}
                      headingIdPrefix="capture-draft"
                      fallbackName={localSkillName}
                    />
                  ) : (
                    <MarkdownContent value={localContent} t={t} headingIdPrefix="capture-draft" />
                  )}
                </div>
              </div>
            </div>
          )}

          <label className="grid shrink-0 gap-1 text-xs text-muted-foreground">
            {t.capture.refine}
            <ImeSafeInput
              value={localNotes}
              onValueChange={(value) => patchFields({ notes: value })}
              onBlur={() => onFlush(currentFields())}
              placeholder={t.capture.notesPlaceholder}
              disabled={busy}
            />
          </label>

          {conflict ? (
            <label className="flex items-center gap-2 text-xs text-amber-500">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(event) => onOverwriteChange(event.target.checked)}
              />
              {t.capture.overwrite}
            </label>
          ) : null}

          <SkillManageStatus message={error ? { type: 'error', text: error } : null} />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onFlush(currentFields())
              onOpenChange(false)
            }}
            disabled={committing}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onRefine(currentFields())}
            disabled={!localContent.trim() || busy}
          >
            {refining ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <SparklesIcon data-icon="inline-start" />
            )}
            {refining ? t.capture.refining : t.capture.refine}
          </Button>
          <Button
            type="button"
            onClick={() => onCommit(currentFields())}
            disabled={!canCommit || (conflict && !overwrite)}
          >
            {committing && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {committing ? t.capture.committing : t.capture.commit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
