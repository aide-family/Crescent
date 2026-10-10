import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useAppModalA11y } from '@renderer/hooks/useAppModalA11y'
import { useAppTheme } from '@renderer/hooks/useAppTheme'
import { useElementVisible } from '@renderer/hooks/useElementVisible'
import type { Dictionary } from '@renderer/i18n'
import { resolveMermaidBlockUiState } from '@renderer/lib/markdown-fence'
import { LruMap } from '@renderer/lib/markdown-truncate'
import { renderThemedMermaid } from '@renderer/lib/mermaid-runtime'
import { exportFeedback, notifyOperationError } from '@renderer/lib/operation-feedback'
import { sanitizeMermaidSvg } from '@renderer/lib/sanitize-svg'
import { APP_THEMES } from '@renderer/lib/theme-definitions'
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  Maximize2Icon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { buildMermaidFilename, downloadSvg, getSvgDimensions, savePngFromSvg } from './svg-export'

export const MERMAID_MIN_ZOOM = 0.05

export const MERMAID_MAX_ZOOM = 10

export const MERMAID_ZOOM_STEP = 0.15

export const MERMAID_ZOOM_EPSILON = 0.001

export const MERMAID_RENDER_DEBOUNCE_MS = 100

export const mermaidSvgCache = new LruMap<string, string>(32)

export function MermaidBlock({
  code,
  closed,
  streaming,
  t,
  onCopy,
  copied
}: {
  code: string
  closed: boolean
  streaming: boolean
  t: Dictionary
  onCopy: () => Promise<void>
  copied: boolean
}): React.JSX.Element {
  const theme = useAppTheme()
  const diagramHostRef = useRef<HTMLDivElement | null>(null)
  const visible = useElementVisible(diagramHostRef)
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
  const zoomRef = useRef(1)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const [diagramSize, setDiagramSize] = useState({ width: 1, height: 1 })
  const expandedPanelRef = useRef<HTMLDivElement | null>(null)

  const closeExpanded = useCallback((): void => {
    setExpanded(false)
    setZoom(1)
    setPanning(false)
    expandedPanRef.current = null
  }, [])

  const expandedOverlayRef = useAppModalA11y(expanded, {
    onEscape: closeExpanded,
    panelRef: expandedPanelRef
  })

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    if (!closed || (!visible && !expanded)) {
      return
    }

    const cacheKey = `${theme}\0${code}`
    const cached = mermaidSvgCache.get(cacheKey)
    if (cached) {
      queueMicrotask(() => {
        setSvg(cached)
        setError('')
        setDiagramSize(getSvgDimensions(cached))
      })
      return
    }

    let disposed = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const rendered = await renderThemedMermaid(
            `${diagramIdRef.current}-${crypto.randomUUID()}`,
            code,
            theme,
            () => !disposed
          )
          if (disposed || !rendered) return
          const safeSvg = sanitizeMermaidSvg(rendered)
          mermaidSvgCache.set(cacheKey, safeSvg)
          setSvg(safeSvg)
          setError('')
          setDiagramSize(getSvgDimensions(safeSvg))
        } catch (renderError) {
          if (disposed) return
          setSvg('')
          setError(renderError instanceof Error ? renderError.message : String(renderError))
        }
      })()
    }, MERMAID_RENDER_DEBOUNCE_MS)

    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [code, closed, theme, visible, expanded])

  const uiState = resolveMermaidBlockUiState({
    closed,
    streaming,
    hasSvg: Boolean(svg),
    hasError: Boolean(error)
  })

  const updateZoom = useCallback(
    (nextZoom: number, anchor?: { clientX: number; clientY: number }): void => {
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
        const previousContentWidth = Math.max(
          container.clientWidth,
          diagramSize.width * previousZoom
        )
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
          const nextContentHeight = Math.max(
            container.clientHeight,
            diagramSize.height * clampedZoom
          )
          container.scrollLeft = contentX * nextContentWidth - offsetX
          container.scrollTop = contentY * nextContentHeight - offsetY
        })
      }
    },
    [diagramSize.height, diagramSize.width, zoom]
  )

  // Non-passive wheel listener for fullscreen zoom (React onWheel is passive).
  useEffect(() => {
    if (!expanded) return
    const node = expandedScrollRef.current
    if (!node) return

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const direction = event.deltaY > 0 ? -1 : 1
      updateZoom(zoomRef.current + direction * MERMAID_ZOOM_STEP, {
        clientX: event.clientX,
        clientY: event.clientY
      })
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [expanded, updateZoom])

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
    const rendered = await renderThemedMermaid(`mermaid-export-${crypto.randomUUID()}`, code, theme)
    if (!rendered) throw new Error('Diagram export canceled')
    return sanitizeMermaidSvg(rendered)
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
      await savePngFromSvg(await renderExportSvg(), buildMermaidFilename('png'), t, theme)
    } catch (exportError) {
      notifyOperationError(exportFeedback(t).failed, exportError)
    }
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

  const body =
    uiState === 'ready' && svg ? (
      <div
        className="min-w-0 overflow-auto p-3 text-foreground [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:rounded [&_svg]:bg-[var(--app-diagram-canvas)]"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    ) : uiState === 'generating' ? (
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          {t.common.mermaidGenerating}
        </div>
        {code.trim() ? (
          <details className="rounded-md border border-border/50 bg-muted/20">
            <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {t.common.mermaidSourceToggle}
            </summary>
            <pre className="min-w-0 overflow-hidden whitespace-pre-wrap break-words border-t border-border/40 p-2.5 font-mono text-[11px] text-muted-foreground">
              <code>{code}</code>
            </pre>
          </details>
        ) : null}
      </div>
    ) : (
      <div className="space-y-2 p-3">
        <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {t.common.mermaidRenderFailed}
        </div>
        <pre className="min-w-0 overflow-hidden rounded-md bg-[var(--app-markdown-canvas)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--app-markdown-text)]">
          <code>{code}</code>
        </pre>
      </div>
    )

  return (
    <div
      ref={diagramHostRef}
      className="app-mermaid-panel min-w-0 rounded-lg border"
      style={{ '--app-diagram-canvas': APP_THEMES[theme].diagram.canvas } as CSSProperties}
    >
      <div className="app-code-panel-header app-sticky-nested flex min-w-0 items-center justify-between gap-2 border-b pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">mermaid</span>
        <div className="flex shrink-0 items-center gap-1">
          {svg ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="select-none"
                    aria-label={t.common.exportDiagram}
                    title={t.common.exportDiagram}
                  >
                    <DownloadIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => void exportSvg()}>
                      {t.common.exportSvg}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportPng()}>
                      {t.common.exportPng}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="select-none"
                aria-label={t.common.enlarge}
                title={t.common.enlarge}
                onClick={() => setExpanded(true)}
              >
                <Maximize2Icon aria-hidden="true" />
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6 select-none"
            aria-label={copied ? t.common.copied : t.common.copy}
            title={copied ? t.common.copied : t.common.copy}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void onCopy()}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {body}
      {expanded && svg
        ? createPortal(
            <div
              ref={expandedOverlayRef}
              className="app-fullscreen-overlay app-mermaid-expanded fixed inset-0 z-50 flex flex-col overscroll-contain"
              style={{ '--app-diagram-canvas': APP_THEMES[theme].diagram.canvas } as CSSProperties}
              role="dialog"
              aria-modal="true"
              aria-label={t.common.enlarge}
            >
              <div
                ref={expandedPanelRef}
                className="flex items-center justify-between gap-2 border-b px-3 py-2"
              >
                <span className="text-xs text-muted-foreground">mermaid · {zoomPercent}%</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t.common.zoomOut}
                    title={t.common.zoomOut}
                    onClick={() => updateZoom(zoom - MERMAID_ZOOM_STEP)}
                  >
                    <ZoomOutIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t.common.zoomIn}
                    title={t.common.zoomIn}
                    onClick={() => updateZoom(zoom + MERMAID_ZOOM_STEP)}
                  >
                    <ZoomInIcon aria-hidden="true" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="select-none"
                        aria-label={t.common.exportDiagram}
                        title={t.common.exportDiagram}
                      >
                        <DownloadIcon aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => void exportSvg()}>
                          {t.common.exportSvg}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportPng()}>
                          {t.common.exportPng}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="select-none"
                    aria-label={copied ? t.common.copied : t.common.copy}
                    title={copied ? t.common.copied : t.common.copy}
                    onPointerDown={(event) => event.preventDefault()}
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
                    onClick={closeExpanded}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                ref={expandedScrollRef}
                className={`min-h-0 flex-1 touch-none overflow-auto bg-[var(--app-diagram-canvas)] select-none ${
                  panning ? 'cursor-grabbing' : 'cursor-grab'
                }`}
                onPointerDown={handleExpandedPointerDown}
                onPointerMove={handleExpandedPointerMove}
                onPointerUp={stopExpandedPan}
                onPointerCancel={stopExpandedPan}
              >
                <div className="relative" style={expandedCanvasStyle}>
                  <div
                    ref={expandedContentRef}
                    className="absolute top-1/2 left-1/2 origin-center [&_svg]:!h-auto [&_svg]:!max-w-none [&_svg]:rounded [&_svg]:bg-[var(--app-diagram-canvas)]"
                    style={expandedContentStyle}
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export function clampMermaidZoom(value: number): number {
  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, value))
}
