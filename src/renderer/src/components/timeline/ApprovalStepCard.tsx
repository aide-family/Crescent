import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import { CheckIcon, ShieldPlusIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import {
  extractRiskVerb,
  isStaticallyReadonly,
  shouldShowWhitelistEntry
} from '../../../../shared/command-guard'
import { CommandBlock, highlightRiskVerb } from './CommandBlock'
import { riskBadgeVariant, riskLabel } from './helpers'

export function ApprovalStepCard({
  step,
  t,
  onResolve,
  onAddToWhitelist
}: {
  step: Extract<AgentRunStep, { kind: 'approval' }>
  t: Dictionary
  onResolve?: (requestId: string, approved: boolean, note?: string) => void
  onAddToWhitelist?: (command: string) => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  const [whitelistSuggestionDismissed, setWhitelistSuggestionDismissed] = useState(false)
  const [whitelistAdded, setWhitelistAdded] = useState(false)
  const pending = step.phase === 'pending'
  const risk = step.risk ?? 'medium'
  const canWhitelist = Boolean(step.command.trim() && onAddToWhitelist)
  const isLowAutoPass = risk === 'low' && !pending
  const isTimeoutPending = pending && step.source === 'timeout-fallback'
  const isHighPending = pending && risk === 'high'
  const showWhitelistEntry =
    canWhitelist &&
    shouldShowWhitelistEntry({
      phase: step.phase,
      risk,
      alreadyAdded: whitelistAdded
    }) &&
    !whitelistSuggestionDismissed
  const showWhitelistAdded =
    canWhitelist &&
    risk === 'high' &&
    step.phase === 'approved' &&
    whitelistAdded &&
    !whitelistSuggestionDismissed

  if (isLowAutoPass) {
    const elapsed =
      typeof step.elapsedMs === 'number' ? Math.max(0, Math.round(step.elapsedMs)) : undefined
    return (
      <div className="min-w-0 rounded-lg border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
          <span>
            {elapsed === undefined
              ? t.commandReview.lowRiskAutoPass
              : t.commandReview.lowRiskAutoPassWithMs.replace('{ms}', String(elapsed))}
          </span>
        </span>
      </div>
    )
  }

  const statusLabel =
    step.phase === 'pending'
      ? t.input.approvalPending
      : step.phase === 'approved'
        ? step.requestId
          ? t.input.approvalAllowed
          : t.input.autoApprovedShort
        : t.input.approvalDenied

  const riskVerb = extractRiskVerb(step.command)
  const humanSummary =
    step.auditSummary?.trim() ||
    (isStaticallyReadonly(step.command)
      ? t.commandReview.readOnlyHuman.replace('{verb}', riskVerb)
      : t.commandReview.highRiskHuman.replace('{verb}', riskVerb))
  const riskDetail = (
    <>
      {step.riskPoints && step.riskPoints.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {step.riskPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {step.impactAnalysis ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">{t.commandReview.impactAnalysis}: </span>
          {step.impactAnalysis}
        </p>
      ) : null}
      {step.recommendation ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">{t.commandReview.recommendation}: </span>
          {step.recommendation}
        </p>
      ) : null}
    </>
  )

  return (
    <div
      className={
        pending
          ? 'app-command-approval min-w-0 rounded-xl border border-border/70 bg-card'
          : 'app-command-approval min-w-0 rounded-xl border border-border/60'
      }
      data-risk={risk}
    >
      {showWhitelistEntry ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-[11px]">
          <span className="text-foreground/90">{t.commandReview.whitelistSuggest}</span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                onAddToWhitelist?.(step.command)
                setWhitelistAdded(true)
              }}
            >
              {t.commandReview.whitelistSuggestAdd}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setWhitelistSuggestionDismissed(true)}
            >
              {t.commandReview.whitelistSuggestIgnore}
            </Button>
          </div>
        </div>
      ) : null}

      {showWhitelistAdded ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-[11px]">
          <span className="text-muted-foreground">{t.commandReview.addedToWhitelist}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled
          >
            <ShieldPlusIcon className="size-3.5" aria-hidden="true" />
            {t.commandReview.addedToWhitelist}
          </Button>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
            <TriangleAlertIcon
              className={`size-3.5 ${risk === 'high' ? 'text-destructive' : 'text-[var(--app-warning)]'}`}
              aria-hidden="true"
            />
            <span>{t.commandReview.title}</span>
            <Badge variant={riskBadgeVariant(risk)}>{riskLabel(risk, t)}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[10px] text-muted-foreground">{statusLabel}</span>
        </div>
      </div>

      <div className="space-y-2.5 border-t border-border/40 px-3 py-2.5 text-[11px]">
        <CommandBlock command={step.command} t={t} tone="audit" />

        {isTimeoutPending ? (
          <p className="text-foreground/90">{t.commandReview.timeoutManualConfirm}</p>
        ) : isHighPending || (risk === 'high' && !pending) ? (
          <>
            {step.purposePhase === 'loading' ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t.commandReview.purposeLabel}:{' '}
                </span>
                {t.commandReview.purposeGenerating}
              </p>
            ) : null}
            {step.purposePhase === 'ready' && step.purpose?.trim() ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t.commandReview.purposeLabel}:{' '}
                </span>
                {step.purpose.trim()}
              </p>
            ) : null}
            <p className="text-foreground/90">{highlightRiskVerb(humanSummary, riskVerb)}</p>
            {riskDetail}
          </>
        ) : (
          <>
            {step.auditSummary ? <p className="text-foreground/90">{step.auditSummary}</p> : null}
            {step.operationReason ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {t.commandReview.operationReason}:{' '}
                </span>
                {step.operationReason}
              </p>
            ) : null}
            {riskDetail}
          </>
        )}

        {pending && onResolve ? (
          <>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t.input.approvalNotePlaceholder}
              className="min-h-14 resize-y text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => onResolve(step.requestId, true, note.trim() || undefined)}
              >
                {t.commandReview.approve}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onResolve(step.requestId, false, note.trim() || undefined)}
              >
                {t.commandReview.reject}
              </Button>
            </div>
          </>
        ) : null}

        {!pending && step.note?.trim() ? (
          <p className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-foreground/90">
            {t.input.yourApprovalNote.replace('{note}', step.note.trim())}
          </p>
        ) : null}

        {!pending && !step.note?.trim() && step.rejectionReason ? (
          <p className="text-muted-foreground">{step.rejectionReason}</p>
        ) : null}
      </div>
    </div>
  )
}
