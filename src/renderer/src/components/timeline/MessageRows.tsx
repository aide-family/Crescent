import { useState } from 'react'
import { MessageInlineContent } from '@renderer/components/AgentReferenceBadges'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import type { Dictionary } from '@renderer/i18n'
import { formatLogTime } from '@renderer/lib/agent-log'
import { AGENT_RUN_STREAM_MAX_CHARS, clampAgentText } from '@renderer/lib/agent-text-limits'
import type { AgentRunStep } from '@renderer/lib/terminal-tabs'
import { ChevronRightIcon, Loader2Icon } from 'lucide-react'

export const THOUGHT_PREVIEW_CHARS = 120

export function ThoughtStepRow({
  step,
  t,
  collapsedByDefault
}: {
  step: Extract<AgentRunStep, { kind: 'thought' }>
  t: Dictionary
  collapsedByDefault: boolean
}): React.JSX.Element | null {
  return (
    <ThoughtContent
      key={`${step.id}:${step.phase}:${collapsedByDefault}`}
      step={step}
      t={t}
      collapsedByDefault={collapsedByDefault}
    />
  )
}
function ThoughtContent({
  step,
  t,
  collapsedByDefault
}: {
  step: Extract<AgentRunStep, { kind: 'thought' }>
  t: Dictionary
  collapsedByDefault: boolean
}): React.JSX.Element | null {
  const streaming = step.phase === 'streaming'
  const [expanded, setExpanded] = useState(streaming && !collapsedByDefault)
  const text = clampAgentText(step.text.trim(), AGENT_RUN_STREAM_MAX_CHARS)
  if (!text) return null
  return (
    <details className="group min-w-0" open={expanded}>
      <summary
        className="flex cursor-pointer select-none items-start gap-1.5 marker:content-none focus-visible:outline-2 focus-visible:outline-primary"
        onClick={(event) => {
          event.preventDefault()
          setExpanded(!expanded)
        }}
      >
        {streaming ? (
          <Loader2Icon
            className="mt-0.5 size-3 shrink-0 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <ChevronRightIcon
            className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        )}
        <span className="text-[12px] text-muted-foreground">
          {streaming ? t.input.thinkingProcessStreaming : t.input.thinkingProcessCompleted}
        </span>
      </summary>
      {expanded && (
        <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted-foreground italic">
          {text}
        </div>
      )}
    </details>
  )
}

export function MessageStepRow({
  step,
  t
}: {
  step: Extract<AgentRunStep, { kind: 'message' }>
  t: Dictionary
}): React.JSX.Element | null {
  const text = clampAgentText(step.text.trim(), AGENT_RUN_STREAM_MAX_CHARS)
  if (!text) return null
  const streaming = step.phase === 'streaming'
  return (
    <div className="min-w-0 text-[14px] leading-relaxed text-foreground/90">
      <MarkdownContent value={text} t={t} streaming={streaming} />
      {streaming ? (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/40 align-middle" />
      ) : null}
    </div>
  )
}

export function UserSupplementStepRow({
  step,
  t
}: {
  step: Extract<AgentRunStep, { kind: 'user-supplement' }>
  t: Dictionary
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-semibold tracking-wide text-foreground/80">{t.roles.user}</span>
        <span className="rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t.input.contextSupplement}
        </span>
        <time dateTime={step.createdAt}>{formatLogTime(step.createdAt)}</time>
      </div>
      <MessageInlineContent text={step.text} references={step.references} t={t} />
    </div>
  )
}
