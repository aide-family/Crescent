import type { JSX } from 'react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import type { Dictionary } from '@renderer/i18n'
import { parseSkillMarkdown } from '@renderer/lib/skill-markdown'

export function SkillMarkdownPreview({
  content,
  t,
  headingIdPrefix,
  fallbackName,
  fallbackDescription
}: {
  content: string
  t: Dictionary
  headingIdPrefix?: string
  fallbackName?: string
  fallbackDescription?: string
}): JSX.Element {
  const parsed = parseSkillMarkdown(content)
  const name = parsed.name || fallbackName || ''
  const description = parsed.description || fallbackDescription || ''

  return (
    <div className="min-w-0">
      {name || description ? (
        <header className="mb-3 border-l-2 border-primary pl-2.5">
          {name ? <div className="text-sm font-semibold text-foreground">{name}</div> : null}
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      <MarkdownContent value={parsed.body} t={t} headingIdPrefix={headingIdPrefix} />
    </div>
  )
}
