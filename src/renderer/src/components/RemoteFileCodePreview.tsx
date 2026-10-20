import { useEffect, useState } from 'react'

import { Badge } from '@renderer/components/ui/badge'
import { languageFromFilename } from '@renderer/lib/files/file-language'
import { cn } from '@renderer/lib/utils'

interface RemoteFileCodePreviewProps {
  filePath: string
  content: string
  truncated?: boolean
  truncatedLabel?: string
  className?: string
}

/** Read-only Shiki preview for remote text files. */
export function RemoteFileCodePreview({
  filePath,
  content,
  truncated,
  truncatedLabel = 'Truncated',
  className
}: RemoteFileCodePreviewProps): React.JSX.Element {
  const lang = languageFromFilename(filePath)
  const [html, setHtml] = useState<string | null>(content ? null : '')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!content) {
      return () => {
        cancelled = true
      }
    }

    void import('@renderer/lib/shiki/highlight-code')
      .then(({ highlightCode }) => highlightCode(content, lang))
      .then((next) => {
        if (!cancelled) {
          setHtml(next)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [content, lang])

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{filePath}</p>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {lang}
          </Badge>
          {truncated ? <span className="text-amber-500">{truncatedLabel}</span> : null}
        </div>
      </div>
      <div
        className={cn(
          'app-code-panel relative min-h-0 flex-1 overflow-auto rounded-md border border-border/70 bg-black/40',
          html == null && !failed && 'min-h-48'
        )}
      >
        {html == null && !failed ? (
          <div className="m-3 h-40 animate-pulse rounded-md bg-muted/40" aria-hidden="true" />
        ) : failed || html === null ? (
          <pre className="break-all p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {content}
          </pre>
        ) : (
          <div
            className="app-code-panel-body p-3 text-xs leading-relaxed [&_pre]:m-0 [&_pre]:bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
