import type { FormEvent, Ref } from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { CommandApprovalRequest, CommandRiskLevel } from '../../../shared/agent-types'

export interface CloseTabsConfirmRequest {
  mode: 'tab' | 'other-tabs' | 'all-tabs'
  tabId: string
  dontAskAgain: boolean
}

export interface PasswordPromptRequest {
  tabId: string
  title: string
  prompt: string
}

export function CloseTabsConfirmModal({
  request,
  t,
  onCancel,
  onConfirm,
  onDontAskAgainChange
}: {
  request: CloseTabsConfirmRequest | null
  t: Dictionary
  onCancel: () => void
  onConfirm: () => void
  onDontAskAgainChange: (checked: boolean) => void
}): React.JSX.Element | null {
  if (!request) return null

  return (
    <div
      className="app-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-tabs-confirm-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="app-modal-panel w-full max-w-md overflow-hidden rounded-lg border bg-background shadow-xl">
        <div className="app-modal-header flex items-start gap-3 border-b px-4 py-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <h2 id="close-tabs-confirm-title" className="text-sm font-semibold">
              {t.confirm.closeTabsTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {request.mode === 'tab'
                ? t.confirm.closeTab
                : request.mode === 'other-tabs'
                  ? t.confirm.closeOtherTabs
                  : t.confirm.closeAllTabs}
            </p>
          </div>
        </div>
        <div className="space-y-4 px-4 py-4">
          <label
            htmlFor="close-tabs-dont-ask"
            className="flex items-center gap-3 rounded-md border bg-muted/10 p-3 text-sm"
          >
            <Input
              id="close-tabs-dont-ask"
              type="checkbox"
              checked={request.dontAskAgain}
              onChange={(event) => onDontAskAgainChange(event.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
            <span>{t.confirm.dontAskAgain}</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t.common.close}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PasswordPromptModal({
  request,
  t,
  value,
  error,
  inputRef,
  onChange,
  onCancel,
  onSubmit
}: {
  request: PasswordPromptRequest | null
  t: Dictionary
  value: string
  error: string
  inputRef: Ref<HTMLInputElement>
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}): React.JSX.Element | null {
  // Kept for API compatibility; password prompts now render inline in the chat pane.
  void request
  void t
  void value
  void error
  void inputRef
  void onChange
  void onCancel
  void onSubmit
  return null
}

/** Inline password prompt in the conversation pane (command-approval style). */
export function PasswordPromptInlineCard({
  request,
  t,
  value,
  error,
  inputRef,
  onChange,
  onCancel,
  onSubmit
}: {
  request: PasswordPromptRequest
  t: Dictionary
  value: string
  error: string
  inputRef: Ref<HTMLInputElement>
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}): React.JSX.Element {
  return (
    <form
      onSubmit={onSubmit}
      className="min-w-0 rounded-md border border-amber-500/35 bg-amber-500/5"
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
            <TriangleAlertIcon className="size-3.5 text-amber-500" aria-hidden="true" />
            <span>{t.terminal.passwordPromptTitle}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{request.title}</p>
        </div>
        <div className="shrink-0 text-[10px] text-muted-foreground">{t.input.approvalPending}</div>
      </div>

      <div className="space-y-2.5 border-t border-border/40 px-3 py-2.5 text-[11px]">
        <pre className="overflow-auto rounded bg-muted/25 p-2 font-mono whitespace-pre-wrap break-words">
          {request.prompt}
        </pre>
        <Field>
          <FieldLabel htmlFor="terminal-password-inline-input">
            {t.terminal.passwordPromptLabel}
          </FieldLabel>
          <Input
            id="terminal-password-inline-input"
            ref={inputRef}
            type="password"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="current-password"
            className="h-9"
          />
          <FieldDescription>{t.terminal.passwordPromptDescription}</FieldDescription>
        </Field>
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" size="sm">
            {t.terminal.passwordPromptSubmit}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function CommandApprovalModal({
  commandApproval,
  sessionLabel,
  isCurrentSession,
  t,
  riskLabel,
  rejectionReason,
  onRejectionReasonChange,
  onResolve
}: {
  commandApproval: CommandApprovalRequest | null
  sessionLabel: string
  isCurrentSession: boolean
  t: Dictionary
  riskLabel: string
  rejectionReason: string
  onRejectionReasonChange: (value: string) => void
  onResolve: (approved: boolean) => void
}): React.JSX.Element | null {
  if (!commandApproval) return null

  return (
    <div
      className="app-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-review-title"
    >
      <div className="app-modal-panel flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
        <div className="app-modal-header flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TriangleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
              <h2 id="command-review-title" className="text-sm font-semibold">
                {t.commandReview.title}
              </h2>
              <Badge variant={riskBadgeVariant(commandApproval.audit.risk)}>{riskLabel}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t.commandReview.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t.commandReview.sourceSession}</span>
              <Badge variant={isCurrentSession ? 'secondary' : 'outline'} className="font-medium">
                {sessionLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {isCurrentSession ? t.commandReview.currentSession : t.commandReview.otherSession}
              </Badge>
            </div>
          </div>
        </div>
        <div className="select-text min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.command}
            </h3>
            <Textarea
              readOnly
              value={commandApproval.command}
              className="min-h-24 max-h-64 resize-y bg-muted/30 font-mono text-xs"
            />
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.auditSummary}
            </h3>
            <p className="text-sm">{commandApproval.audit.summary}</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.operationReason}
            </h3>
            <p className="text-sm">{commandApproval.audit.operationReason}</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.riskPoints}
            </h3>
            <ul className="space-y-1 text-sm">
              {commandApproval.audit.riskPoints.map((point, index) => (
                <li key={`${point}-${index}`} className="rounded-md bg-muted/30 px-3 py-2">
                  {point}
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.impactAnalysis}
            </h3>
            <p className="text-sm">{commandApproval.audit.impactAnalysis}</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.recommendation}
            </h3>
            <p className="text-sm">{commandApproval.audit.recommendation}</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t.commandReview.decisionNote}
            </h3>
            <Textarea
              value={rejectionReason}
              onChange={(event) => onRejectionReasonChange(event.target.value)}
              placeholder={t.commandReview.decisionNotePlaceholder}
              className="min-h-20 resize-y text-sm"
            />
          </section>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onResolve(false)}>
            {t.commandReview.reject}
          </Button>
          <Button type="button" variant="destructive" onClick={() => onResolve(true)}>
            {t.commandReview.approve}
          </Button>
        </div>
      </div>
    </div>
  )
}

function riskBadgeVariant(risk: CommandRiskLevel): 'outline' | 'secondary' | 'destructive' {
  if (risk === 'high') return 'destructive'
  if (risk === 'medium') return 'secondary'
  return 'outline'
}
