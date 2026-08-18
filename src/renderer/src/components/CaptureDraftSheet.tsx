import { Loader2Icon, SparklesIcon } from 'lucide-react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { SkillManageStatus } from '@renderer/components/StatusIndicators'
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
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { CaptureKind } from '../../../shared/agent-types'

export interface CaptureDraftSheetProps {
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
  onTitleChange: (value: string) => void
  onContentChange: (value: string) => void
  onSkillNameChange: (value: string) => void
  onNotesChange: (value: string) => void
  onOverwriteChange: (value: boolean) => void
  onRefine: () => void
  onCommit: () => void
}

export function CaptureDraftSheet({
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
  onTitleChange,
  onContentChange,
  onSkillNameChange,
  onNotesChange,
  onOverwriteChange,
  onRefine,
  onCommit
}: CaptureDraftSheetProps): React.JSX.Element {
  const busy = generating || refining || committing
  const canCommit = Boolean(content.trim()) && !busy

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[720px] sm:max-w-[min(720px,calc(100vw-3rem))]">
        <SheetHeader className="pr-12">
          <div className="flex items-center gap-2">
            <SheetTitle>{kind === 'skill' ? t.capture.titleSkill : t.capture.titleSop}</SheetTitle>
            <Badge variant="outline">{kind === 'skill' ? t.input.tagSkill : t.input.tagSop}</Badge>
          </div>
          <SheetDescription>{t.capture.description}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t.capture.titleLabel}
            <Input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              disabled={generating}
            />
          </label>
          {kind === 'skill' && (
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t.capture.skillNameLabel}
              <Input
                value={skillName}
                onChange={(event) => onSkillNameChange(event.target.value)}
                disabled={generating}
              />
            </label>
          )}

          {generating && !content ? (
            <div className="app-empty-state flex items-center gap-2">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              {t.capture.generating}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
              <label className="grid min-h-0 gap-1 text-xs text-muted-foreground">
                {t.capture.edit}
                <Textarea
                  className="min-h-[320px] resize-y font-mono text-xs"
                  value={content}
                  onChange={(event) => onContentChange(event.target.value)}
                  disabled={generating}
                />
              </label>
              <div className="grid min-h-0 gap-1 text-xs text-muted-foreground">
                {t.capture.preview}
                <div className="min-h-[320px] overflow-auto rounded-md border border-border/70 bg-background/40 p-3">
                  <MarkdownContent value={content} t={t} headingIdPrefix="capture-draft" />
                </div>
              </div>
            </div>
          )}

          <label className="grid gap-1 text-xs text-muted-foreground">
            {t.capture.refine}
            <Input
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder={t.capture.notesPlaceholder}
              disabled={busy}
            />
          </label>

          {conflict && (
            <label className="flex items-center gap-2 text-xs text-amber-500">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(event) => onOverwriteChange(event.target.checked)}
              />
              {t.capture.overwrite}
            </label>
          )}

          <SkillManageStatus message={error ? { type: 'error', text: error } : null} />
        </div>

        <SheetFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={committing}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onRefine}
            disabled={!content.trim() || busy}
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
            onClick={onCommit}
            disabled={!canCommit || (conflict && !overwrite)}
          >
            {committing && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {committing ? t.capture.committing : t.capture.commit}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
