import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { isMermaidCodeLanguage } from '@renderer/lib/mermaid-language'
import { copyFeedback, copyText } from '@renderer/lib/operation-feedback'
import { CheckIcon, CopyIcon, Loader2Icon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { isArchitectureCodeLanguage } from '../../../../shared/architecture-spec'
import { isChartCodeLanguage } from '../../../../shared/chart-spec'
import { MermaidBlock } from './MermaidBlock'

export const ChartBlock = lazy(() =>
  import('../ChartBlock').then((module) => ({ default: module.ChartBlock }))
)

export const ArchitectureBlock = lazy(() =>
  import('../ArchitectureBlock').then((module) => ({ default: module.ArchitectureBlock }))
)

export function ChartLoading({ t }: { t: Dictionary }): React.JSX.Element {
  return (
    <div className="app-mermaid-panel min-w-0 rounded-lg border">
      <div className="app-code-panel-header app-sticky-nested flex min-w-0 items-center gap-2 border-b pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">chart</span>
      </div>
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        {t.common.chartGenerating}
      </div>
    </div>
  )
}

export function ArchitectureLoading({ t }: { t: Dictionary }): React.JSX.Element {
  return (
    <div className="app-mermaid-panel min-w-0 rounded-lg border">
      <div className="app-code-panel-header app-sticky-nested flex min-w-0 items-center gap-2 border-b pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">architecture</span>
      </div>
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        {t.common.architectureGenerating}
      </div>
    </div>
  )
}

export function MarkdownCodeBlock({
  code,
  language,
  t,
  closed = true,
  streaming = false
}: {
  code: string
  language: string
  t: Dictionary
  closed?: boolean
  streaming?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const normalizedLanguage = language.trim().toLowerCase()
  const label = language || 'text'

  async function copyCode(): Promise<void> {
    try {
      await copyText(code, copyFeedback(t))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // copyText already toasted the failure.
    }
  }

  if (isMermaidCodeLanguage(normalizedLanguage)) {
    return (
      <MermaidBlock
        code={code}
        closed={closed}
        streaming={streaming}
        t={t}
        onCopy={copyCode}
        copied={copied}
      />
    )
  }

  if (isChartCodeLanguage(normalizedLanguage)) {
    return (
      <Suspense fallback={<ChartLoading t={t} />}>
        <ChartBlock
          code={code}
          closed={closed}
          streaming={streaming}
          t={t}
          onCopy={() => void copyCode()}
          copied={copied}
        />
      </Suspense>
    )
  }

  if (isArchitectureCodeLanguage(normalizedLanguage)) {
    return (
      <Suspense fallback={<ArchitectureLoading t={t} />}>
        <ArchitectureBlock
          code={code}
          closed={closed}
          streaming={streaming}
          t={t}
          onCopy={() => void copyCode()}
          copied={copied}
        />
      </Suspense>
    )
  }

  return (
    <div className="app-code-panel group min-w-0 rounded-lg border">
      <div className="app-code-panel-header app-sticky-nested flex min-w-0 items-center justify-between gap-2 pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">
          {closed ? label : `${label || 'text'}…`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-7 shrink-0 gap-1 px-2 text-[11px] text-[var(--app-markdown-muted)] select-none hover:bg-white/8 hover:text-[var(--app-markdown-text)]"
          aria-label={copied ? t.common.copied : t.common.copy}
          title={copied ? t.common.copied : t.common.copy}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void copyCode()}
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-3.5" aria-hidden="true" />
          )}
          {copied ? t.common.copied : t.common.copy}
        </Button>
      </div>
      <pre className="app-code-panel-body">
        <code>{code}</code>
      </pre>
    </div>
  )
}
