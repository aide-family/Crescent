import type { Dictionary } from '@renderer/i18n'
import { formatLogTime } from '@renderer/lib/agent-log'
import type { ParsedAgentRunDocument } from '@renderer/lib/agent-run-document'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  ServerIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useState } from 'react'
import { formatDuration, statusStepDetail, statusStepTitle } from './helpers'

export function ConnectionFlowGroup({
  steps,
  t,
  connectionName,
  finished = false,
  failed = false
}: {
  steps: Array<Extract<AgentRunStep, { kind: 'status' }>>
  t: Dictionary
  connectionName: string
  finished?: boolean
  failed?: boolean
}): React.JSX.Element {
  // Expand by default so every login action is visible in the transcript; the
  // user can collapse/expand at will and their choice is preserved.
  const [expanded, setExpanded] = useState(true)
  const label = connectionName
    ? t.terminal.connectionFlowLabel.replace('{name}', connectionName)
    : t.terminal.connectionFlowFallback
  const stepCount = t.terminal.connectionFlowStepCount.replace('{n}', String(steps.length))
  const statusTone = failed
    ? 'text-destructive'
    : finished
      ? 'text-primary'
      : 'text-muted-foreground'
  const statusLabel = failed
    ? t.terminal.loginFailed
    : finished
      ? t.terminal.loginSuccess
      : t.terminal.loginInProgress

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border bg-card/40 ${
        failed ? 'border-destructive/30' : 'border-border/50'
      }`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={expanded}
        title={expanded ? t.terminal.connectionFlowCollapse : t.terminal.connectionFlowExpand}
        onClick={() => setExpanded((value) => !value)}
      >
        <ServerIcon className={`size-3.5 shrink-0 ${statusTone}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">{label}</span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusTone} border-current/30`}
        >
          {!finished && !failed ? (
            <Loader2Icon className="mr-1 inline size-2.5 animate-spin" aria-hidden="true" />
          ) : null}
          {statusLabel}
        </span>
        <span className="shrink-0 text-muted-foreground/70">{stepCount}</span>
        {expanded ? (
          <ChevronUpIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {expanded ? (
        <div className="space-y-1 border-t border-border/40 px-2.5 py-2">
          {steps.map((step, stepIndex) => {
            const isLast = step.id === steps[steps.length - 1]?.id
            const createdAt = (step as { createdAt?: string }).createdAt
            const titleText = statusStepTitle(step)
            const detailText = statusStepDetail(step)
            return (
              <div key={step.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                  {failed && isLast ? (
                    <TriangleAlertIcon className="size-3 text-destructive" aria-hidden="true" />
                  ) : !finished && isLast ? (
                    <Loader2Icon className="size-3 animate-spin text-primary" aria-hidden="true" />
                  ) : (
                    <span
                      className={`size-1 rounded-full ${
                        finished ? 'bg-primary/70' : 'bg-muted-foreground/40'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-muted-foreground">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                      {stepIndex + 1}
                    </span>
                    <span className="min-w-0 break-words whitespace-pre-wrap">{titleText}</span>
                  </div>
                  {createdAt ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground/50">
                      {formatLogTime(createdAt)}
                    </div>
                  ) : null}
                  {detailText ? (
                    <div className="mt-0.5 break-words whitespace-pre-wrap text-muted-foreground/70">
                      {detailText}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function LoginResultCard({
  document,
  t
}: {
  document: ParsedAgentRunDocument
  t: Dictionary
}): React.JSX.Element {
  const meta = document.loginMeta
  const failed = Boolean(document.errorMarkdown?.trim())
  const elapsedMs = typeof document.elapsedMs === 'number' ? document.elapsedMs : undefined
  const address = [meta?.host ?? '', meta?.port ? `:${meta.port}` : ''].join('')
  // Count typed + explicitly skipped login-action steps so the result card
  // agrees with the flow (single source: document.steps).
  const actionPrefixes = [
    `${t.terminal.connectionAction} `,
    `${t.terminal.connectionActionSkipped} `
  ]
  const actionStepCount = document.steps.filter(
    (step) =>
      step.kind === 'status' &&
      typeof step.title === 'string' &&
      actionPrefixes.some((prefix) => step.title.trim().startsWith(prefix))
  ).length
  const rowEntries: Array<[string, string]> = [
    [t.terminal.loginConnectionName, meta?.connectionName ?? ''],
    [t.terminal.loginConnectionAddress, address],
    [t.terminal.loginUser, meta?.user ?? ''],
    [
      t.terminal.loginActions,
      failed
        ? t.terminal.loginFailed
        : t.terminal.loginActionsDone.replace(
            '{n}',
            String(actionStepCount || meta?.actionCount || 0)
          )
    ]
  ]
  const rows: Array<[string, string]> = []
  for (const [key, value] of rowEntries) {
    if (value) rows.push([key, value])
  }

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border ${
        failed ? 'border-destructive/30 bg-destructive/[0.04]' : 'border-border/70 bg-card/50'
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b px-3 py-2 ${
          failed ? 'border-destructive/20 bg-destructive/[0.06]' : 'border-border/60 bg-muted/20'
        }`}
      >
        {failed ? (
          <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span
          className={`text-xs font-semibold tracking-wide ${
            failed ? 'text-destructive' : 'text-foreground/85'
          }`}
        >
          {failed ? t.terminal.loginFailed : t.terminal.loginSuccess}
        </span>
        {meta?.connectionName ? (
          <span className="ml-auto shrink-0 rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {meta.connectionName}
          </span>
        ) : null}
        {typeof elapsedMs === 'number' ? (
          <span className="shrink-0 font-mono tabular-nums text-[10px] text-muted-foreground">
            {t.terminal.loginEndToEndElapsed} {formatDuration(elapsedMs)}
          </span>
        ) : null}
      </div>
      <div className="px-3 py-2.5">
        {rows.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {rows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground/80">{key}</dt>
                <dd className="break-all font-mono text-[11px] tabular-nums text-foreground/90">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {failed && document.errorMarkdown?.trim() ? (
          <div className="mt-2 break-words rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            {document.errorMarkdown.trim()}
          </div>
        ) : null}
      </div>
    </div>
  )
}
