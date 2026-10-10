import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { buildMarkdownPreview, shouldTruncateMarkdown } from '@renderer/lib/markdown-truncate'
import { exportFeedback, saveTextFile } from '@renderer/lib/operation-feedback'
import { useState } from 'react'
import { renderMarkdownBlocks } from './markdown/markdown-parser'

export function MarkdownContent({
  value,
  t,
  headingIdPrefix,
  streaming = false
}: {
  value: string
  t: Dictionary
  headingIdPrefix?: string
  streaming?: boolean
}): React.JSX.Element {
  const oversized = shouldTruncateMarkdown(value)
  const [forceExpanded, setForceExpanded] = useState(false)
  const expanded = !oversized || forceExpanded
  const renderValue = expanded ? value : buildMarkdownPreview(value)

  return (
    <div className="markdown-body select-text flex min-w-0 flex-col gap-2 leading-relaxed break-words">
      {renderMarkdownBlocks(renderValue, t, { headingIdPrefix, streaming })}
      {oversized ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setForceExpanded((current) => !current)}
          >
            {forceExpanded ? t.input.markdownCollapseLarge : t.input.markdownExpandLarge}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => {
              void saveTextFile(
                value,
                'crescent-markdown.txt',
                'text/plain;charset=utf-8',
                exportFeedback(t)
              )
            }}
          >
            {t.input.markdownDownloadLarge}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
