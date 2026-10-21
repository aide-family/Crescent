import { ExecutionTargetChip } from './ExecutionTargetChip'
import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui/dialog'
import type { Dictionary } from '@renderer/i18n'
import type { HandoffEditor } from '@renderer/hooks/useHandoff'
import { HANDOFF_DRAFT_MAX, HANDOFF_GOAL_MAX } from '../../../shared/handoff'

export function HandoffDialog({
  connections,
  sourceTarget,
  sourcePaneId,
  sourceSessionKey,
  onTarget,
  editor,
  title,
  cwd,
  model,
  t,
  onGoal,
  onDraft,
  onGenerate,
  onClose,
  onConfirm
}: {
  connections: Array<{ id: string; name: string }>
  sourceTarget: string
  sourcePaneId: string
  sourceSessionKey: string
  onTarget: (target: import('../../../shared/handoff').HandoffTarget) => void
  editor: HandoffEditor
  title: string
  cwd?: string
  model: string
  t: Dictionary
  onGoal: (value: string) => void
  onDraft: (value: string) => void
  onGenerate: () => void
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState('')
  const busy = editor.generating || editor.creating
  return (
    <Dialog
      open={editor.open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (editor.creating) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.handoff.title}</DialogTitle>
          <DialogDescription>
            {t.handoff.source}: {title}
            {cwd ? ` · ${cwd}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto px-4 text-xs">
          <p className="text-muted-foreground">源执行终端：{sourceTarget}</p>
          <ExecutionTargetChip sessionKey={sourceSessionKey} tabId={sourcePaneId} />
          <label className="block space-y-1">
            <span>交接执行环境</span>
            <select
              className="w-full rounded border border-border bg-background p-2"
              value={editor.target}
              disabled={busy}
              onChange={(event) => onTarget(event.target.value as HandoffEditor['target'])}
            >
              <option value="inherit">沿用当前执行终端（需重新验证）</option>
              {connections.map((connection) => (
                <option key={connection.id} value={`connection:${connection.id}`}>
                  {connection.name}
                </option>
              ))}
              <option value="local">本机</option>
              <option value="none">暂不连接（仅资料）</option>
            </select>
          </label>
          {editor.target !== 'inherit' && (
            <p className="text-amber-600">目标改变；审批不继承，连接就绪后才能执行。</p>
          )}
          <label className="block space-y-1">
            <span>{t.handoff.goal}</span>
            <Textarea
              value={editor.goal}
              onChange={(event) => onGoal(event.target.value)}
              disabled={busy || Boolean(editor.draft)}
              aria-invalid={editor.goal.length > HANDOFF_GOAL_MAX}
              className="min-h-20"
            />
          </label>
          <p className="text-muted-foreground">
            {editor.goal.length} / {HANDOFF_GOAL_MAX}
          </p>
          {editor.draft && (
            <label className="block space-y-1">
              <span>{t.handoff.preview}</span>
              <Textarea
                value={editor.draft}
                onChange={(event) => onDraft(event.target.value)}
                disabled={busy}
                aria-invalid={editor.draft.length > HANDOFF_DRAFT_MAX}
                className="h-64 [field-sizing:fixed] font-mono text-xs"
              />
            </label>
          )}
          <p className="text-muted-foreground">{t.handoff.review}</p>
          <p className="text-muted-foreground">
            {t.handoff.target} {t.app.model}: {model}
          </p>
          <p className="text-muted-foreground">{t.handoff.draftNote}</p>
          {editor.error && (
            <p role="alert" className="text-destructive">
              {editor.error}
            </p>
          )}
          <p role="status">
            {editor.generating
              ? t.handoff.generating
              : editor.creating
                ? t.handoff.creating
                : copyStatus}
          </p>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={onClose} disabled={editor.creating}>
            {t.handoff.cancel}
          </Button>
          {editor.draft && (
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(editor.draft)
                  .then(() => setCopyStatus(t.handoff.copied))
                  .catch(() => setCopyStatus(t.handoff.failed))
              }}
            >
              {t.handoff.copy}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onGenerate}
            disabled={busy || !editor.goal.trim() || editor.goal.length > HANDOFF_GOAL_MAX}
          >
            {editor.draft ? t.handoff.regenerate : t.handoff.generate}
          </Button>
          {editor.draft && (
            <Button
              onClick={onConfirm}
              disabled={busy || !editor.draft.trim() || editor.draft.length > HANDOFF_DRAFT_MAX}
            >
              {t.handoff.create}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
