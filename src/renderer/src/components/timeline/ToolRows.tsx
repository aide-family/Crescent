import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { AGENT_RUN_STREAM_MAX_CHARS, clampAgentText } from '@renderer/lib/agent-text-limits'
import { copyFeedback, copyText } from '@renderer/lib/operation-feedback'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  Loader2Icon,
  TriangleAlertIcon
} from 'lucide-react'
import { useState } from 'react'
import { parseBatchedToolOutput, type BatchedCommandPart } from '../../../../shared/readonly-batch'
import { ApprovalStepCard } from './ApprovalStepCard'
import { CommandBlock } from './CommandBlock'
import { summarizeArgs } from './helpers'

export function ToolCallRow({
  step,
  t,
  hideCommand = false,
  onInterruptCommand,
  onFocusTerminal,
  fallbackExecutionTabId
}: {
  step: Extract<AgentRunStep, { kind: 'tool' }>
  t: Dictionary
  hideCommand?: boolean
  onInterruptCommand?: (tabId: string) => void
  onFocusTerminal?: (tabId: string) => void
  fallbackExecutionTabId?: string
}): React.JSX.Element {
  const running = step.phase === 'started'
  const command = step.command?.trim()
  const preview = hideCommand ? undefined : command || summarizeArgs(step.argsText)
  const observationRaw = step.resultText?.trim()
  const observation = observationRaw
    ? clampAgentText(observationRaw, AGENT_RUN_STREAM_MAX_CHARS)
    : undefined
  const batchParts = observation ? parseBatchedToolOutput(observation) : null
  const showObservation = Boolean(observation && observation !== command && !batchParts)
  const observationLong = Boolean(showObservation && observation && observation.length > 240)
  const isPtyCommand = step.name === 'bash' || step.name === 'terminal'
  const toolLabel = isPtyCommand ? t.input.toolCommandLabel : step.name
  const executionTarget = step.executionTarget
  const executionLabel = executionTarget
    ? [
        executionTarget.paneRole === 'subterminal'
          ? t.terminal.subterminal
          : t.terminal.mainTerminal,
        executionTarget.executionMode === 'ssh' ? 'SSH' : t.terminal.targetLocal,
        executionTarget.connectionName,
        executionTarget.expectedTarget
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined
  const statusLabel = running
    ? step.dispatchPending
      ? t.input.toolReviewing
      : t.input.toolRunning
    : step.lifecycle === 'blocked-before-dispatch'
      ? t.input.toolBlocked
      : step.lifecycle === 'completion-unknown'
        ? t.input.toolCompletionUnknown
        : step.interrupted
          ? t.input.toolInterrupted
          : step.timedOut
            ? t.input.toolTimedOut
            : step.isError
              ? t.input.toolFailed
              : t.input.toolFinished
  const warnFinish = Boolean(step.interrupted || step.timedOut)

  return (
    <div className="app-agent-tool-step min-w-0 space-y-1.5">
      <div className="flex items-start gap-2 min-w-0">
        {running ? (
          <Loader2Icon
            className="mt-0.5 size-3 shrink-0 animate-spin text-primary"
            aria-hidden="true"
          />
        ) : warnFinish ? (
          <TriangleAlertIcon
            className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        ) : (
          <span
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
              step.isError ? 'bg-destructive' : 'bg-primary/70'
            }`}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium text-foreground/80">{toolLabel}</span>
            <span className="text-[11px] text-muted-foreground">{statusLabel}</span>
            {executionLabel && (
              <button
                type="button"
                className="max-w-full truncate text-[11px] text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
                title={executionLabel}
                onClick={() => onFocusTerminal?.(executionTarget!.paneId)}
              >
                {executionLabel}
              </button>
            )}
            {running && !step.dispatchPending && isPtyCommand && onInterruptCommand ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={t.terminal.interruptCommand}
                title={t.terminal.interruptCommand}
                onClick={() => {
                  const target = step.tabId?.trim() || fallbackExecutionTabId?.trim()
                  if (target) onInterruptCommand(target)
                }}
              >
                Ctrl+C
              </Button>
            ) : null}
          </div>
          {batchParts ? (
            <BatchCommandGroupCard
              parts={batchParts}
              isError={Boolean(step.isError)}
              running={running}
              t={t}
            />
          ) : preview ? (
            <CommandBlock command={preview} t={t} tone="command" />
          ) : null}
        </div>
      </div>

      {showObservation && observation ? (
        observationLong ? (
          <details className="group ml-5 min-w-0">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronRightIcon
                className="size-3 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              <span className="truncate font-mono group-open:hidden">
                {observation.slice(0, 120)}
                {observation.length > 120 ? '…' : ''}
              </span>
              <span className="hidden group-open:inline">{t.input.toolFinished}</span>
            </summary>
            <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground/90">
              {observation}
            </pre>
          </details>
        ) : (
          <pre className="ml-5 max-h-56 overflow-auto rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground/90">
            {observation}
          </pre>
        )
      ) : null}
    </div>
  )
}

export function BatchCommandGroupCard({
  parts,
  isError,
  running,
  t
}: {
  parts: BatchedCommandPart[]
  isError: boolean
  running: boolean
  t: Dictionary
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const previewCount = 2
  const visible = expanded ? parts : parts.slice(0, previewCount)
  const hiddenCount = Math.max(0, parts.length - previewCount)
  const statusIcon = running ? (
    <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
  ) : isError ? (
    <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
  ) : (
    <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
  )

  return (
    <div className="min-w-0 rounded-md border border-border/50">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground">
        {statusIcon}
        <span className="min-w-0 flex-1">
          {t.commandReview.batchGroupCollapsed.replace('{n}', String(parts.length))}
        </span>
      </div>
      <div className="space-y-2 border-t border-border/40 px-2 py-2">
        {visible.map((part) => (
          <BatchCommandSegment key={`${part.index}-${part.command}`} part={part} t={t} />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <>
                <ChevronUpIcon className="size-3.5" aria-hidden="true" />
                {t.commandReview.batchGroupHide}
              </>
            ) : (
              <>
                <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                {t.commandReview.batchGroupShowMore.replace('{n}', String(hiddenCount))}
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function BatchCommandSegment({
  part,
  t
}: {
  part: BatchedCommandPart
  t: Dictionary
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const segmentId = `batch-cmd-${part.index}`

  async function copyOutput(): Promise<void> {
    try {
      await copyText(part.output || part.command, copyFeedback(t))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // copyText already toasted the failure.
    }
  }

  function scrollToOutput(): void {
    document.getElementById(segmentId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div className="min-w-0 space-y-1 rounded-md border border-border/60 bg-muted/15 p-2">
      <div className="flex items-start gap-1.5">
        <CheckIcon className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden="true" />
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-mono text-[11px] text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={scrollToOutput}
          title={part.command}
        >
          <span className="line-clamp-2 whitespace-pre-wrap break-words">{part.command}</span>
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground select-none hover:bg-muted/50"
          title={t.commandReview.batchCopyOutput}
          aria-label={t.commandReview.batchCopyOutput}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void copyOutput()}
        >
          <CopyIcon className="size-3" aria-hidden="true" />
        </button>
      </div>
      <pre
        id={segmentId}
        className="max-h-40 overflow-auto rounded-md border border-border/50 bg-muted/15 p-1.5 font-mono text-[10px] whitespace-pre-wrap break-words text-foreground/90"
      >
        {part.output || '(no output)'}
      </pre>
      {copied ? <span className="text-[10px] text-muted-foreground">{t.common.copied}</span> : null}
    </div>
  )
}

export function CollapsedLowRiskGroup({
  steps,
  t
}: {
  steps: Array<Extract<AgentRunStep, { kind: 'approval' }>>
  t: Dictionary
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const maxMs = Math.max(
    0,
    ...steps.map((step) => (typeof step.elapsedMs === 'number' ? Math.round(step.elapsedMs) : 0))
  )
  const label = t.commandReview.lowRiskGroupCollapsed
    .replace('{n}', String(steps.length))
    .replace('{ms}', String(maxMs))

  return (
    <div className="min-w-0 rounded-lg border border-border/50">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => setExpanded((value) => !value)}
      >
        <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{label}</span>
        {expanded ? (
          <ChevronUpIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {expanded ? (
        <div className="space-y-1.5 border-t border-border/40 px-2 py-2">
          {steps.map((step) => (
            <ApprovalStepCard key={step.id} step={step} t={t} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
