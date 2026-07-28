import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import mermaid from 'mermaid'
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  Maximize2Icon,
  ZoomInIcon,
  ZoomOutIcon,
  XIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import type { Dictionary } from '@renderer/i18n'
import { appMermaidThemeVariables } from '@renderer/lib/design-system'
import {
  copyFeedback,
  copyText,
  exportFeedback,
  notifyOperationError,
  saveTextFile
} from '@renderer/lib/operation-feedback'
export {
  extractResultMarkdown,
  parseAgentRunMarkdown,
  trimMarkdownLines,
  type ParsedAgentRunMarkdown
} from '@renderer/lib/agent-run-markdown'

const MERMAID_MIN_ZOOM = 0.05
const MERMAID_MAX_ZOOM = 10
const MERMAID_ZOOM_STEP = 0.15
const MERMAID_ZOOM_EPSILON = 0.001

const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  flowchart: {
    htmlLabels: false
  },
  theme: 'base',
  themeVariables: appMermaidThemeVariables,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif'
} as const

async function downloadSvg(value: string, filename: string, t: Dictionary): Promise<void> {
  await saveTextFile(
    normalizeSvgForExport(value),
    filename,
    'image/svg+xml;charset=utf-8',
    exportFeedback(t),
    [{ name: 'SVG image', extensions: ['svg'] }]
  )
}

async function savePngFromSvg(value: string, filename: string, t: Dictionary): Promise<void> {
  const feedback = exportFeedback(t)
  try {
    const { svg, width, height } = normalizeSvgForPng(value)
    const result = await window.api.agent.saveSvgAsPng({
      svg,
      defaultPath: filename,
      width,
      height
    })
    if (result.canceled) {
      toast.info(feedback.canceled ?? feedback.failed)
      return
    }

    if (!result.ok) throw new Error(result.error || 'Failed to write PNG file.')
    toast.success(feedback.success)
  } catch (error) {
    notifyOperationError(feedback.failed, error)
  }
}

function getSvgDimensions(value: string): { width: number; height: number } {
  const svgTag = getSvgRootTag(value)
  const viewBox = getSvgAttribute(svgTag, 'viewBox')?.trim().split(/\s+/).map(Number)
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: Math.max(1, viewBox[2]), height: Math.max(1, viewBox[3]) }
  }

  return {
    width: Math.max(1, parseFloat(getSvgAttribute(svgTag, 'width') ?? '1200') || 1200),
    height: Math.max(1, parseFloat(getSvgAttribute(svgTag, 'height') ?? '800') || 800)
  }
}

function normalizeSvgForExport(value: string): string {
  const svg = normalizeSvgVoidElements(value.trim())
  return svg.startsWith('<?xml') ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`
}

function normalizeSvgForPng(value: string): { svg: string; width: number; height: number } {
  let svg = normalizeSvgVoidElements(value.trim().replace(/^\s*<\?xml[^>]*>\s*/i, ''))
  svg = replaceForeignObjectsWithSvgText(svg)
  const rootTag = getSvgRootTag(svg)
  const { width, height } = getSvgDimensions(value)

  let nextRootTag = setSvgAttribute(rootTag, 'xmlns', 'http://www.w3.org/2000/svg')
  nextRootTag = setSvgAttribute(nextRootTag, 'xmlns:xlink', 'http://www.w3.org/1999/xlink')
  if (!getSvgAttribute(nextRootTag, 'viewBox')) {
    nextRootTag = setSvgAttribute(nextRootTag, 'viewBox', `0 0 ${width} ${height}`)
  }
  nextRootTag = setSvgAttribute(nextRootTag, 'width', String(width))
  nextRootTag = setSvgAttribute(nextRootTag, 'height', String(height))
  nextRootTag = setSvgAttribute(
    nextRootTag,
    'style',
    `${getSvgAttribute(nextRootTag, 'style') ?? ''}; background: #050608;`
  )

  svg = svg.replace(rootTag, nextRootTag)
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`,
    width,
    height
  }
}

function normalizeSvgVoidElements(value: string): string {
  return value
    .replace(/&nbsp;/g, '&#160;')
    .replace(/<(br|hr|img|input|meta|link)(\s[^<>]*?)?>/gi, (match, tag, attrs = '') => {
      if (/\/\s*>$/.test(match)) return match
      return `<${tag}${attrs}/>`
    })
}

function replaceForeignObjectsWithSvgText(value: string): string {
  return value.replace(
    /<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject>/gi,
    (_match, attrs: string, html: string) => {
      const x = parseFloat(getSvgAttribute(attrs, 'x') ?? '0') || 0
      const y = parseFloat(getSvgAttribute(attrs, 'y') ?? '0') || 0
      const text = extractForeignObjectText(html)
      if (!text) return ''

      const lines = text.split('\n').filter(Boolean)
      const tspans = lines
        .map((line, index) => {
          const dy = index === 0 ? '1em' : '1.25em'
          return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`
        })
        .join('')

      return `<text x="${x}" y="${y}" fill="#fafafa" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14">${tspans}</text>`
    }
  )
}

function extractForeignObjectText(value: string): string {
  const container = document.createElement('div')
  container.innerHTML = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (container.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function getSvgRootTag(value: string): string {
  const match = value.match(/<svg\b[^>]*>/i)
  if (!match) throw new Error('Invalid SVG.')
  return match[0]
}

function getSvgAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\s${escapedName}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2]
}

function setSvgAttribute(tag: string, name: string, value: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedValue = value.replace(/"/g, '&quot;')
  const attributePattern = new RegExp(`(\\s${escapedName}=)(?:"[^"]*"|'[^']*')`, 'i')
  if (attributePattern.test(tag)) return tag.replace(attributePattern, `$1"${escapedValue}"`)

  return tag.replace(/>$/, ` ${name}="${escapedValue}">`)
}

function buildMermaidFilename(extension: 'svg' | 'png'): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '')
  return `crescent-mermaid-${timestamp}.${extension}`
}

export function MarkdownContent({
  value,
  t,
  headingIdPrefix
}: {
  value: string
  t: Dictionary
  headingIdPrefix?: string
}): React.JSX.Element {
  return (
    <div className="markdown-body select-text min-w-0 space-y-2 overflow-hidden leading-relaxed break-words">
      {renderMarkdownBlocks(value, t, { headingIdPrefix })}
    </div>
  )
}

function renderMarkdownBlocks(
  value: string,
  t: Dictionary,
  options: { headingIdPrefix?: string } = {}
): React.ReactNode[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let index = 0
  let headingIndex = 0

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
          <summary className="sticky top-0 z-30 -mt-px cursor-pointer rounded-t-md border-t border-b bg-card/95 px-3 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
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

    const fence = line.match(/^```([\w-]+)?\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      nodes.push(
        <MarkdownCodeBlock
          key={nodes.length}
          code={codeLines.join('\n')}
          language={fence[1] ?? ''}
          t={t}
        />
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const headingText = heading[2].trim()
      const headingId = options.headingIdPrefix
        ? buildMarkdownHeadingId(options.headingIdPrefix, headingText, headingIndex)
        : undefined
      headingIndex += 1
      const className =
        level === 1
          ? 'text-base font-semibold'
          : level === 2
            ? 'text-sm font-semibold'
            : 'text-sm font-medium'

      nodes.push(
        <div id={headingId} key={nodes.length} className={`${className} min-w-0 break-words`}>
          {renderInlineMarkdown(headingText)}
        </div>
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
        <blockquote
          key={nodes.length}
          className="min-w-0 break-words border-l-2 border-border pl-3 text-muted-foreground"
        >
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

function MarkdownCodeBlock({
  code,
  language,
  t
}: {
  code: string
  language: string
  t: Dictionary
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const normalizedLanguage = language.trim().toLowerCase()
  const label = language || 'text'

  async function copyCode(): Promise<void> {
    await copyText(code, copyFeedback(t))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  if (normalizedLanguage === 'mermaid') {
    return <MermaidBlock code={code} t={t} onCopy={copyCode} copied={copied} />
  }

  return (
    <div className="app-code-panel min-w-0 rounded-md border bg-[var(--app-terminal)] text-zinc-100">
      <div className="sticky top-0 z-30 flex min-w-0 items-center justify-between gap-2 border-b border-white/10 bg-[var(--app-terminal-rail)] px-3 py-1.5 backdrop-blur">
        <span className="min-w-0 truncate font-mono text-[11px] text-zinc-400">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-6 w-6 shrink-0 text-zinc-300 hover:bg-white/10 hover:text-white"
          aria-label={copied ? t.common.copied : t.common.copy}
          title={copied ? t.common.copied : t.common.copy}
          onClick={() => void copyCode()}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      </div>
      <pre className="min-w-0 overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
        <code className="break-words">{code}</code>
      </pre>
    </div>
  )
}

export function buildMarkdownHeadingId(prefix: string, text: string, index: number): string {
  const slug =
    text
      .toLowerCase()
      .replace(/[`*_~[\]()#+.!?，。！？：:;；、/\\|]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'heading'

  return `${prefix}-${index}-${slug}`
}

function MermaidBlock({
  code,
  t,
  onCopy,
  copied
}: {
  code: string
  t: Dictionary
  onCopy: () => Promise<void>
  copied: boolean
}): React.JSX.Element {
  const diagramIdRef = useRef(`mermaid-${crypto.randomUUID()}`)
  const expandedScrollRef = useRef<HTMLDivElement | null>(null)
  const expandedContentRef = useRef<HTMLDivElement | null>(null)
  const expandedPanRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const [exportSelectKey, setExportSelectKey] = useState(0)
  const [diagramSize, setDiagramSize] = useState({ width: 1, height: 1 })

  useEffect(() => {
    let disposed = false

    async function renderDiagram(): Promise<void> {
      mermaid.initialize(MERMAID_RENDER_CONFIG)

      setSvg('')
      setError('')

      try {
        const result = await mermaid.render(diagramIdRef.current, code)
        if (!disposed) {
          setSvg(result.svg)
          setDiagramSize(getSvgDimensions(result.svg))
        }
      } catch (renderError) {
        if (!disposed) {
          setError(renderError instanceof Error ? renderError.message : String(renderError))
        }
      }
    }

    void renderDiagram()

    return () => {
      disposed = true
    }
  }, [code])

  function centerExpandedMermaid(
    container: HTMLDivElement,
    contentWidth: number,
    contentHeight: number
  ): void {
    container.scrollLeft = Math.max(0, (contentWidth - container.clientWidth) / 2)
    container.scrollTop = Math.max(0, (contentHeight - container.clientHeight) / 2)
  }

  const fitExpandedMermaidToViewport = useCallback((): void => {
    const container = expandedScrollRef.current
    if (!container || !diagramSize.width || !diagramSize.height) return

    const nextZoom = clampMermaidZoom(
      Math.max(
        container.clientWidth / diagramSize.width,
        container.clientHeight / diagramSize.height
      )
    )

    setZoom(nextZoom)
    window.requestAnimationFrame(() => {
      centerExpandedMermaid(container, diagramSize.width * nextZoom, diagramSize.height * nextZoom)
    })
  }, [diagramSize.height, diagramSize.width])

  useEffect(() => {
    if (!expanded) {
      expandedPanRef.current = null
      return
    }

    const fitOnNextFrame = (): number =>
      window.requestAnimationFrame(() => {
        fitExpandedMermaidToViewport()
      })

    let animationFrame = fitOnNextFrame()
    const handleResize = (): void => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = fitOnNextFrame()
    }
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize)

    window.addEventListener('resize', handleResize)
    if (expandedScrollRef.current) resizeObserver?.observe(expandedScrollRef.current)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
    }
  }, [expanded, fitExpandedMermaidToViewport, svg])

  function updateZoom(nextZoom: number, anchor?: { clientX: number; clientY: number }): void {
    const container = expandedScrollRef.current
    const previousZoom = zoom
    const clampedZoom = clampMermaidZoom(nextZoom)
    if (Math.abs(clampedZoom - previousZoom) < MERMAID_ZOOM_EPSILON) return

    let contentX = 0
    let contentY = 0
    let offsetX = 0
    let offsetY = 0

    if (container) {
      const rect = container.getBoundingClientRect()
      offsetX = anchor ? anchor.clientX - rect.left : container.clientWidth / 2
      offsetY = anchor ? anchor.clientY - rect.top : container.clientHeight / 2
      const previousContentWidth = Math.max(container.clientWidth, diagramSize.width * previousZoom)
      const previousContentHeight = Math.max(
        container.clientHeight,
        diagramSize.height * previousZoom
      )
      contentX = (container.scrollLeft + offsetX) / previousContentWidth
      contentY = (container.scrollTop + offsetY) / previousContentHeight
    }

    setZoom(clampedZoom)

    if (container) {
      window.requestAnimationFrame(() => {
        const nextContentWidth = Math.max(container.clientWidth, diagramSize.width * clampedZoom)
        const nextContentHeight = Math.max(container.clientHeight, diagramSize.height * clampedZoom)
        container.scrollLeft = contentX * nextContentWidth - offsetX
        container.scrollTop = contentY * nextContentHeight - offsetY
      })
    }
  }

  function handleExpandedWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    event.preventDefault()
    const direction = event.deltaY > 0 ? -1 : 1
    updateZoom(zoom + direction * MERMAID_ZOOM_STEP, {
      clientX: event.clientX,
      clientY: event.clientY
    })
  }

  function handleExpandedPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    expandedPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop
    }
    setPanning(true)
  }

  function handleExpandedPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const pan = expandedPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return

    event.preventDefault()
    event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
    event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
  }

  function stopExpandedPan(event: ReactPointerEvent<HTMLDivElement>): void {
    const pan = expandedPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    expandedPanRef.current = null
    setPanning(false)
  }

  async function renderExportSvg(): Promise<string> {
    mermaid.initialize(MERMAID_RENDER_CONFIG)
    const result = await mermaid.render(`mermaid-export-${crypto.randomUUID()}`, code)
    return result.svg
  }

  async function exportSvg(): Promise<void> {
    if (!svg) return
    try {
      await downloadSvg(await renderExportSvg(), buildMermaidFilename('svg'), t)
    } catch (exportError) {
      notifyOperationError(exportFeedback(t).failed, exportError)
    }
  }

  async function exportPng(): Promise<void> {
    if (!svg) return
    try {
      await savePngFromSvg(await renderExportSvg(), buildMermaidFilename('png'), t)
    } catch (exportError) {
      notifyOperationError(exportFeedback(t).failed, exportError)
    }
  }

  function handleMermaidExportFormat(format: string): void {
    if (format === 'svg') void exportSvg()
    if (format === 'png') void exportPng()
    setExportSelectKey((current) => current + 1)
  }

  const zoomPercent = Math.round(zoom * 100)
  const expandedCanvasStyle = {
    width: expanded ? `max(100%, ${Math.max(1, diagramSize.width * zoom)}px)` : undefined,
    height: expanded ? `max(100%, ${Math.max(1, diagramSize.height * zoom)}px)` : undefined
  } as CSSProperties
  const expandedContentStyle = {
    width: diagramSize.width,
    height: diagramSize.height,
    transform: `translate(-50%, -50%) scale(${zoom})`
  } as CSSProperties

  return (
    <div className="app-mermaid-panel min-w-0 rounded-md border bg-background">
      <div className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-2 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          mermaid
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6 shrink-0"
            aria-label={t.common.enlarge}
            title={t.common.enlarge}
            disabled={!svg}
            onClick={() => setExpanded(true)}
          >
            <Maximize2Icon aria-hidden="true" />
          </Button>
          <Select
            key={`inline-export-${exportSelectKey}`}
            onValueChange={handleMermaidExportFormat}
            disabled={!svg}
          >
            <SelectTrigger
              className="h-6 w-[4.5rem] border-0 bg-transparent px-1.5 text-[11px] shadow-none hover:bg-accent focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent/50"
              aria-label={t.common.exportDiagram}
              title={t.common.exportDiagram}
            >
              <SelectValue placeholder={t.common.exportDiagram} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="svg">{t.common.exportSvg}</SelectItem>
              <SelectItem value="png">{t.common.exportPng}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6 shrink-0"
            aria-label={copied ? t.common.copied : t.common.copy}
            title={copied ? t.common.copied : t.common.copy}
            onClick={() => void onCopy()}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {svg ? (
        <div
          className="min-w-0 overflow-auto bg-[var(--app-terminal)] p-3 text-foreground [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:rounded [&_svg]:bg-[var(--app-terminal)]"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : error ? (
        <div className="space-y-2 p-3">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
          <pre className="min-w-0 overflow-hidden rounded bg-[var(--app-terminal)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-zinc-100">
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          mermaid
        </div>
      )}
      {expanded && svg ? (
        <div
          className="app-mermaid-expanded fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-label={t.common.enlarge}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-4 py-3">
            <div className="min-w-0 truncate font-mono text-xs text-muted-foreground">mermaid</div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.common.zoomOut}
                title={t.common.zoomOut}
                disabled={zoom <= MERMAID_MIN_ZOOM + MERMAID_ZOOM_EPSILON}
                onClick={() => updateZoom(zoom - MERMAID_ZOOM_STEP)}
              >
                <ZoomOutIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-w-16 font-mono"
                aria-label={t.common.reset}
                title={t.common.reset}
                onClick={() => updateZoom(1)}
              >
                {zoomPercent}%
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t.common.fitToScreen}
                title={t.common.fitToScreen}
                onClick={fitExpandedMermaidToViewport}
              >
                {t.common.fitToScreen}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.common.zoomIn}
                title={t.common.zoomIn}
                disabled={zoom >= MERMAID_MAX_ZOOM - MERMAID_ZOOM_EPSILON}
                onClick={() => updateZoom(zoom + MERMAID_ZOOM_STEP)}
              >
                <ZoomInIcon aria-hidden="true" />
              </Button>
              <Select
                key={`expanded-export-${exportSelectKey}`}
                onValueChange={handleMermaidExportFormat}
              >
                <SelectTrigger
                  className="h-8 w-28 border-0 bg-transparent shadow-none hover:bg-accent focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent/50"
                  aria-label={t.common.exportDiagram}
                  title={t.common.exportDiagram}
                >
                  <DownloadIcon className="size-3.5" aria-hidden="true" />
                  <SelectValue placeholder={t.common.exportDiagram} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="svg">{t.common.exportSvg}</SelectItem>
                  <SelectItem value="png">{t.common.exportPng}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={copied ? t.common.copied : t.common.copy}
                title={copied ? t.common.copied : t.common.copy}
                onClick={() => void onCopy()}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? t.common.copied : t.common.copy}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.common.close}
                title={t.common.close}
                onClick={() => {
                  setExpanded(false)
                  setZoom(1)
                  setPanning(false)
                  expandedPanRef.current = null
                }}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div
            ref={expandedScrollRef}
            className={`min-h-0 flex-1 touch-none overflow-auto bg-[var(--app-terminal)] select-none ${
              panning ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            onWheel={handleExpandedWheel}
            onPointerDown={handleExpandedPointerDown}
            onPointerMove={handleExpandedPointerMove}
            onPointerUp={stopExpandedPan}
            onPointerCancel={stopExpandedPan}
          >
            <div className="relative" style={expandedCanvasStyle}>
              <div
                ref={expandedContentRef}
                className="absolute top-1/2 left-1/2 origin-center [&_svg]:!h-auto [&_svg]:!max-w-none [&_svg]:rounded [&_svg]:bg-[var(--app-terminal)]"
                style={expandedContentStyle}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function clampMermaidZoom(value: number): number {
  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, value))
}

function isMarkdownBlockStart(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    isMarkdownTableLine(line) ||
    /^<details(?:\s+open)?>$/.test(line.trim()) ||
    /^(#{1,4})\s+/.test(line) ||
    /^>\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  )
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index] &&
    lines[index + 1] &&
    isMarkdownTableLine(lines[index]) &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  )
}

function isMarkdownTableLine(line: string): boolean {
  return line.includes('|') && line.trim().split('|').filter(Boolean).length >= 2
}

function MarkdownTable({ lines }: { lines: string[] }): React.JSX.Element {
  const [headerLine, , ...bodyLines] = lines
  const headers = splitMarkdownTableRow(headerLine)
  const rows = bodyLines.map(splitMarkdownTableRow)

  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead className="bg-muted/40">
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

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderInlineMarkdown(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index))

    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={nodes.length}
          className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
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
            className="break-words text-[var(--app-cyan)] underline underline-offset-2"
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

function safeHref(value: string): string {
  return /^(https?:|mailto:)/i.test(value) ? value : ''
}
