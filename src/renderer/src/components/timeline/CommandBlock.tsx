import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { copyFeedback, copyText } from '@renderer/lib/operation-feedback'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'

export function highlightRiskVerb(summary: string, verb: string): React.ReactNode {
  if (!verb) return summary
  const markers = [`（${verb}）`, `(${verb})`]
  for (const marker of markers) {
    const index = summary.indexOf(marker)
    if (index < 0) continue
    return (
      <>
        {summary.slice(0, index + 1)}
        <strong className="font-semibold text-amber-700 dark:text-amber-400">{verb}</strong>
        {summary.slice(index + marker.length - 1)}
      </>
    )
  }
  return summary
}

export function CommandBlock({
  command,
  t,
  tone = 'command'
}: {
  command: string
  t: Dictionary
  tone?: 'command' | 'audit'
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const lineCount = command.split('\n').length
  const needsFold = lineCount > 2 || command.length > 120

  async function copyCommand(): Promise<void> {
    try {
      await copyText(command, copyFeedback(t))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // copyText already toasted the failure.
    }
  }

  const toneClass =
    tone === 'audit'
      ? 'border-border/50 bg-muted/25 text-foreground'
      : 'border-border/60 bg-muted/20 text-foreground/90'

  return (
    <div className={`relative min-w-0 rounded border ${toneClass}`}>
      <pre
        className={`p-2 pr-16 font-mono text-[11px] whitespace-pre-wrap break-words ${
          needsFold && !expanded ? 'line-clamp-2' : ''
        }`}
      >
        {command}
      </pre>
      <div className="absolute top-1 right-1 flex items-center gap-0.5">
        {needsFold ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground select-none"
            aria-label={expanded ? t.input.collapseCommand : t.input.expandCommand}
            title={expanded ? t.input.collapseCommand : t.input.expandCommand}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronUpIcon className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground select-none"
          aria-label={copied ? t.common.copied : t.input.copyCommand}
          title={copied ? t.common.copied : t.input.copyCommand}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void copyCommand()}
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  )
}
