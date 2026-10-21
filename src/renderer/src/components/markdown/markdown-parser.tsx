import { Separator } from '@renderer/components/ui/separator'
import type { Dictionary } from '@renderer/i18n'
import { scanMarkdownFence } from '@renderer/lib/markdown-fence'
import { buildMarkdownHeadingId } from '@renderer/lib/markdown-heading'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'

export function renderMarkdownBlocks(
  value: string,
  t: Dictionary,
  options: { headingIdPrefix?: string; streaming?: boolean } = {}
): React.ReactNode[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let index = 0
  let headingIndex = 0
  const streaming = Boolean(options.streaming)

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^\s*---+\s*$/.test(line)) {
      nodes.push(<Separator key={nodes.length} />)
      index += 1
      continue
    }

    if (/^<details(?:\s+open)?>$/.test(line.trim())) {
      const detailsOpen = line.trim() === '<details open>'
      index += 1
      let summary = 'Details'
      const contentLines: string[] = []

      if (lines[index]?.trim().startsWith('<summary>')) {
        summary = lines[index]
          .trim()
          .replace(/^<summary>/, '')
          .replace(/<\/summary>$/, '')
        index += 1
      }

      while (index < lines.length && lines[index].trim() !== '</details>') {
        contentLines.push(lines[index])
        index += 1
      }
      index += 1
      nodes.push(
        <details
          key={`${nodes.length}:${summary}`}
          className="min-w-0 rounded-md border bg-muted/15 shadow-xs"
          open={detailsOpen ? true : undefined}
        >
          <summary className="app-sticky-nested cursor-pointer rounded-t-md border-b bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
            {summary}
          </summary>
          <div className="min-w-0 space-y-2 p-3">
            {renderMarkdownBlocks(contentLines.join('\n'), t, options)}
          </div>
        </details>
      )
      continue
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines: string[] = []
      while (index < lines.length && isMarkdownTableLine(lines[index])) {
        tableLines.push(lines[index])
        index += 1
      }
      nodes.push(<MarkdownTable key={nodes.length} lines={tableLines} />)
      continue
    }

    const fence = scanMarkdownFence(lines, index)
    if (fence) {
      index = fence.nextIndex
      nodes.push(
        <MarkdownCodeBlock
          key={nodes.length}
          code={fence.code}
          language={fence.language}
          closed={fence.closed}
          streaming={streaming}
          t={t}
        />
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*$/)
    if (heading) {
      const level = heading[1].length
      const headingText = heading[2].trim()
      const headingId = options.headingIdPrefix
        ? buildMarkdownHeadingId(options.headingIdPrefix, headingText, headingIndex)
        : undefined
      headingIndex += 1
      const className =
        level === 1
          ? 'text-base font-semibold text-pretty'
          : level === 2
            ? 'text-sm font-semibold text-pretty'
            : 'text-sm font-medium text-pretty'
      const scrollMarginClass = options.headingIdPrefix ? 'scroll-mt-28' : ''
      const HeadingTag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5'

      nodes.push(
        <HeadingTag
          id={headingId}
          key={nodes.length}
          className={`${className} ${scrollMarginClass} min-w-0 break-words`}
        >
          {renderInlineMarkdown(headingText)}
        </HeadingTag>
      )
      index += 1
      continue
    }

    if (/^>\s+/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      nodes.push(
        <blockquote key={nodes.length} className="min-w-0 break-words border-l-2 pl-3">
          {renderInlineMarkdown(quoteLines.join(' '))}
        </blockquote>
      )
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      nodes.push(
        <ul key={nodes.length} className="min-w-0 list-disc space-y-1 pl-5 break-words">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      nodes.push(
        <ol key={nodes.length} className="min-w-0 list-decimal space-y-1 pl-5 break-words">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index])
      index += 1
    }
    nodes.push(
      <p key={nodes.length} className="min-w-0 break-words">
        {renderInlineMarkdown(paragraphLines.join(' '))}
      </p>
    )
  }

  return nodes
}

export function isMarkdownBlockStart(line: string): boolean {
  return (
    /^\s*(```|~~~)/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    isMarkdownTableLine(line) ||
    /^<details(?:\s+open)?>$/.test(line.trim()) ||
    /^(#{1,4})\s+/.test(line) ||
    /^>\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  )
}

export function isMarkdownTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index] &&
    lines[index + 1] &&
    isMarkdownTableLine(lines[index]) &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  )
}

export function isMarkdownTableLine(line: string): boolean {
  return line.includes('|') && line.trim().split('|').filter(Boolean).length >= 2
}

export function MarkdownTable({ lines }: { lines: string[] }): React.JSX.Element {
  const [headerLine, , ...bodyLines] = lines
  const headers = splitMarkdownTableRow(headerLine)
  const rows = bodyLines.map(splitMarkdownTableRow)

  return (
    <div className="markdown-table min-w-0 overflow-x-auto rounded-md border">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} className="break-words border-b px-2 py-1.5 font-medium">
                {renderInlineMarkdown(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-b-0">
              {headers.map((_, cellIndex) => (
                <td key={cellIndex} className="break-words px-2 py-1.5 align-top">
                  {renderInlineMarkdown(row[cellIndex] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function renderInlineMarkdown(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index))

    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code key={nodes.length} className="break-all rounded px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={nodes.length}>{renderInlineMarkdown(token.slice(2, -2))}</strong>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = link ? safeHref(link[2]) : ''
      nodes.push(
        href ? (
          <a
            key={nodes.length}
            href={href}
            className="break-words text-[var(--app-markdown-accent)] underline underline-offset-2"
            rel="noreferrer"
            target="_blank"
          >
            {link?.[1]}
          </a>
        ) : (
          token
        )
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex))
  return nodes
}

export function safeHref(value: string): string {
  return /^(https?:|mailto:)/i.test(value) ? value : ''
}
