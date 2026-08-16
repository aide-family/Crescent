import { ArrowDownIcon, ArrowUpIcon, FileJsonIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import type { Dictionary } from '@renderer/i18n'
import { formatCompactTokenCount } from '../../../shared/session-token-usage'

export function SessionUsageBar({
  inputTokens,
  outputTokens,
  t,
  onExportSessionTrace
}: {
  inputTokens: number
  outputTokens: number
  t: Dictionary
  onExportSessionTrace: () => void
}): React.JSX.Element {
  return (
    <div
      className="flex h-7 items-center gap-2 px-0.5"
      role="status"
      aria-label={t.common.sessionTokenUsage}
    >
      <TooltipProvider delayDuration={200}>
        <TokenCount direction="input" count={inputTokens} label={t.common.inputTokens} />
        <TokenCount direction="output" count={outputTokens} label={t.common.outputTokens} />
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t.common.exportSessionTraceJson}
              onClick={onExportSessionTrace}
            >
              <FileJsonIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t.common.exportSessionTraceJsonTooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

function TokenCount({
  direction,
  count,
  label
}: {
  direction: 'input' | 'output'
  count: number
  label: string
}): React.JSX.Element {
  const Icon = direction === 'input' ? ArrowUpIcon : ArrowDownIcon
  const exact = Math.max(0, Math.round(count)).toLocaleString()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground"
          aria-label={`${label} ${exact}`}
        >
          <Icon className="size-3" aria-hidden="true" />
          {formatCompactTokenCount(count)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}: {exact}
      </TooltipContent>
    </Tooltip>
  )
}
