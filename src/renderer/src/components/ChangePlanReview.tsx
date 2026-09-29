import { useEffect, useState } from 'react'
import type {
  PlanApprovalRequest,
  PlanProgress,
  ChangePlanStep
} from '../../../shared/execution-plan'
import type { Dictionary } from '@renderer/i18n'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog'

function Steps({ steps, t }: { steps: ChangePlanStep[]; t: Dictionary }): React.JSX.Element {
  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.id} className="border-b pb-3">
          <div className="font-medium">
            {step.id} · {step.title} ({t.plan.kinds[step.kind]})
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
            {step.command}
          </pre>
          <div className="text-xs text-muted-foreground">
            {t.plan.timeout}: {step.timeoutMs / 1000}s · {t.plan.dependencies}:{' '}
            {step.dependsOn.join(', ') || '—'}
          </div>
          <p className="mt-1 text-xs">{t.plan.conditions}</p>
          <pre className="whitespace-pre-wrap font-mono text-xs">
            {step.precondition.command}
            {'\n→ '}
            {JSON.stringify(step.precondition.expectedOutput)}
          </pre>
          <p className="mt-1 text-xs">
            {t.plan.expected}: <code>{JSON.stringify(step.expectedOutput)}</code>
          </p>
        </li>
      ))}
    </ol>
  )
}

export function ChangePlanReview({
  tabId,
  t
}: {
  tabId: string
  t: Dictionary
}): React.JSX.Element | null {
  const [requests, setRequests] = useState<Record<string, PlanApprovalRequest>>({})
  const [events, setEvents] = useState<Record<string, PlanProgress[]>>({})
  const [openId, setOpenId] = useState<string>()
  const [note, setNote] = useState('')
  const [approveRecovery, setApproveRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const offRequest = window.api.agent.onPlanApprovalRequest((request) => {
      setRequests((current) => ({ ...current, [request.id]: request }))
      setOpenId(request.id)
      setNote('')
      setApproveRecovery(false)
      setError('')
    })
    const offProgress = window.api.agent.onPlanProgress((progress) => {
      setEvents((current) => ({
        ...current,
        [progress.requestId]: [...(current[progress.requestId] ?? []), progress].slice(-200)
      }))
    })
    return () => {
      offRequest()
      offProgress()
    }
  }, [])
  const request = Object.values(requests).findLast((item) => item.chatTabId === tabId)
  if (!request) return null
  const history = events[request.id] ?? []
  const phase = history.at(-1)?.phase ?? 'pending'
  const pending = phase === 'pending'
  const plan = request.plan
  const decide = async (approved: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.agent.resolvePlanApproval({
        requestId: request.id,
        digest: request.binding.digest,
        approved,
        approveRecovery: approved && approveRecovery,
        note
      })
      if (!result.ok) setError(t.plan.expired)
    } catch {
      setError(t.plan.expired)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpenId(request.id)}
        className="fixed right-5 bottom-5 z-30 shadow-sm"
      >
        {t.plan.view} · {t.plan.phases[phase]}
      </Button>
      <Dialog
        open={openId === request.id}
        onOpenChange={(open) => {
          if (!open) setOpenId(undefined)
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t.plan.title} · {plan.title}
            </DialogTitle>
            <DialogDescription>{t.plan.notApproval}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto px-4 text-sm">
            <section>
              <h3 className="font-semibold">{t.plan.target}</h3>
              <p>
                {plan.target.host} · {plan.target.cluster} · {plan.target.namespace}
              </p>
              <p>{plan.target.resources.join(', ')}</p>
              <p>
                {t.plan.excluded}: {plan.target.excluded.join(', ')}
              </p>
              <p className="text-xs">
                {t.plan.expires}: {new Date(request.binding.expiresAt).toLocaleString()}
              </p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t.plan.binding}</summary>
                <pre className="whitespace-pre-wrap break-all">
                  {request.binding.targetIdentity}
                </pre>
                <p className="break-all">SHA-256: {request.binding.digest}</p>
              </details>
            </section>
            <section>
              <h3 className="font-semibold">{t.plan.identity}</h3>
              <pre className="whitespace-pre-wrap text-xs">
                {plan.identity.command}
                {'\n→ '}
                {JSON.stringify(plan.identity.expectedOutput)}
              </pre>
            </section>
            <section>
              <h3 className="font-semibold">{t.plan.backup}</h3>
              {plan.backups.map((backup) => (
                <div key={backup.stepId} className="border-b py-2">
                  <p>
                    {backup.protects} → {backup.location}
                  </p>
                  <p>
                    {backup.permissions} · {backup.sensitivity}
                  </p>
                  <p>
                    {backup.retention} · {backup.cleanup}
                  </p>
                  <p className="font-mono text-xs">
                    {backup.stepId} → {backup.verificationStepId}
                  </p>
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                    {backup.integrity.command}
                    {'\n→ '}
                    {backup.integrity.expectedOutput}
                  </pre>
                </div>
              ))}
              {plan.alternativeProtection && (
                <p>
                  {t.plan.alternative}: {plan.alternativeProtection}
                </p>
              )}
            </section>
            <section>
              <h3 className="font-semibold">{t.plan.impact}</h3>
              <p>{plan.impact}</p>
              <p>{plan.stopConditions}</p>
            </section>
            <section>
              <h3 className="font-semibold">{t.plan.steps}</h3>
              <Steps steps={plan.steps} t={t} />
            </section>
            <section>
              <h3 className="font-semibold">{t.plan.recovery}</h3>
              <p>
                {t.plan.risk}: {plan.recoveryRisk}
              </p>
              {plan.recovery.map((recovery) => (
                <div key={recovery.triggerStepId}>
                  <p className="font-mono">{recovery.triggerStepId} →</p>
                  <Steps steps={recovery.steps} t={t} />
                </div>
              ))}
            </section>
            {pending && plan.recovery.length > 0 && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={approveRecovery}
                  onChange={(event) => setApproveRecovery(event.target.checked)}
                />
                {t.plan.recoveryConsent}
              </label>
            )}
            {pending && (
              <label className="block">
                {t.plan.note}
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                  className="mt-1 w-full rounded border bg-background p-2 focus-visible:outline-ring"
                />
              </label>
            )}
            <section aria-live="polite">
              <h3 className="font-semibold">{t.plan.progress}</h3>
              {history.map((event, index) => (
                <p key={index} className="break-words text-xs">
                  {new Date(event.at).toLocaleTimeString()} · {t.plan.phases[event.phase]}{' '}
                  {event.stepId} · {event.message}
                </p>
              ))}
            </section>
            {error && <p role="alert">{error}</p>}
          </div>
          <DialogFooter>
            {pending ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
                  {t.plan.reject}
                </Button>
                <Button disabled={busy} onClick={() => void decide(true)}>
                  {t.plan.approve}
                </Button>
              </>
            ) : (
              <Button onClick={() => setOpenId(undefined)}>{t.plan.close}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
