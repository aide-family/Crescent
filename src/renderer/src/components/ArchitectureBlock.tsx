import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CheckIcon, CopyIcon, DownloadIcon, Loader2Icon, Maximize2Icon, XIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import {
  parseArchitectureSpec,
  type ArchitectureKind,
  type ArchitectureSpec
} from '../../../shared/architecture-spec'
import type { Dictionary } from '@renderer/i18n'
import { APP_UI_THEME } from '@renderer/lib/design-system'
import { resolveMermaidBlockUiState } from '@renderer/lib/markdown-fence'
import {
  exportFeedback,
  notifyOperationError,
  saveTextFile
} from '@renderer/lib/operation-feedback'
import { useAppModalA11y } from '@renderer/hooks/useAppModalA11y'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ArchEdge } from './architecture/ArchEdge'
import { ArchGroupNode } from './architecture/ArchGroupNode'
import { ArchNode } from './architecture/ArchNode'
import { buildArchitectureExportSvg } from './architecture/export-svg'
import { ARCHITECTURE_KIND_ORDER, ARCHITECTURE_KIND_TONE } from './architecture/kinds'
import { buildArchitectureFlowGraph } from './architecture/layout'

const nodeTypes = {
  archNode: ArchNode,
  archGroup: ArchGroupNode
} as NodeTypes

const edgeTypes = {
  archEdge: ArchEdge
} as EdgeTypes

const panelStyle = {
  '--background': 'var(--app-markdown-surface-raised)',
  '--foreground': 'var(--app-markdown-text)',
  '--muted-foreground': 'var(--app-markdown-muted)',
  '--border': 'var(--app-markdown-border)'
} as CSSProperties

const canvasVars = {
  '--app-diagram-canvas': APP_UI_THEME.diagram.canvas
} as CSSProperties

export function ArchitectureBlock({
  code,
  closed = true,
  streaming = false,
  t,
  onCopy,
  copied
}: {
  code: string
  closed?: boolean
  streaming?: boolean
  t: Dictionary
  onCopy: () => void
  copied: boolean
}): React.JSX.Element {
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = usePrefersReducedMotion()
  const spec = closed ? parseArchitectureSpec(code) : null
  const uiState = resolveMermaidBlockUiState({
    closed,
    streaming,
    hasSvg: spec !== null,
    hasError: closed && spec === null
  })

  const closeExpanded = useCallback((): void => {
    setExpanded(false)
  }, [])

  const expandedOverlayRef = useAppModalA11y(expanded, {
    onEscape: closeExpanded,
    panelRef
  })

  async function exportSvg(): Promise<void> {
    if (!spec) return
    const { svg } = buildArchitectureExportSvg(spec)
    await saveTextFile(
      svg,
      buildArchitectureFilename('svg'),
      'image/svg+xml;charset=utf-8',
      exportFeedback(t),
      [{ name: 'SVG image', extensions: ['svg'] }]
    )
  }

  async function exportPng(): Promise<void> {
    if (!spec) return
    const feedback = exportFeedback(t)
    try {
      const { svg, width, height } = buildArchitectureExportSvg(spec)
      const result = await window.api.agent.saveSvgAsPng({
        svg,
        defaultPath: buildArchitectureFilename('png'),
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

  const body =
    uiState === 'ready' && spec ? (
      <div className="flex min-w-0 flex-col gap-2 p-3">
        {spec.title ? (
          <div className="truncate text-xs font-medium text-[var(--app-markdown-text)]">
            {spec.title}
          </div>
        ) : null}
        <div
          className="app-arch-canvas relative h-[320px] min-h-[240px] overflow-hidden rounded-md border border-[var(--app-markdown-border)]"
          style={canvasVars}
        >
          <ReactFlowProvider>
            <ArchitectureCanvas spec={spec} reduceMotion={reduceMotion} />
          </ReactFlowProvider>
          <ArchitectureLegend t={t} />
        </div>
        {showSource ? <ArchitectureSource code={code} /> : null}
      </div>
    ) : uiState === 'generating' ? (
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          {t.common.architectureGenerating}
        </div>
        {code.trim() ? (
          <details className="rounded-md border border-border/50 bg-muted/20">
            <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {t.common.architectureSourceToggle}
            </summary>
            <ArchitectureSource code={code} />
          </details>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-col gap-2 p-3">
        <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {t.common.architectureRenderFailed}
        </div>
        <ArchitectureSource code={code} />
      </div>
    )

  return (
    <div
      className="app-mermaid-panel app-architecture-panel min-w-0 rounded-lg border"
      style={panelStyle}
    >
      <div className="app-code-panel-header app-sticky-nested relative z-20 flex min-w-0 items-center justify-between gap-2 border-b bg-[var(--app-terminal-rail)] pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">architecture</span>
        <div className="relative z-20 flex shrink-0 items-center gap-1">
          {uiState === 'ready' && spec ? (
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
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 px-2 text-[11px]"
                aria-pressed={showSource}
                onClick={() => setShowSource((current) => !current)}
              >
                {t.common.architectureSourceToggle}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="select-none"
            aria-label={copied ? t.common.copied : t.common.copy}
            title={copied ? t.common.copied : t.common.copy}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onCopy()}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {body}
      {expanded && spec
        ? createPortal(
            <div
              ref={expandedOverlayRef}
              className="app-fullscreen-overlay app-mermaid-expanded fixed inset-0 z-50 flex flex-col overscroll-contain"
              style={canvasVars}
            >
              <div
                ref={panelRef}
                className="flex min-h-0 flex-1 flex-col"
                role="dialog"
                aria-modal="true"
                aria-label={spec.title || 'architecture'}
              >
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    architecture{spec.title ? ` · ${spec.title}` : ''}
                  </span>
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
                <div className="app-arch-canvas relative min-h-0 flex-1">
                  <ReactFlowProvider>
                    <ArchitectureCanvas spec={spec} reduceMotion={reduceMotion} tall />
                  </ReactFlowProvider>
                  <ArchitectureLegend t={t} />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

function ArchitectureCanvas({
  spec,
  reduceMotion,
  tall = false
}: {
  spec: ArchitectureSpec
  reduceMotion: boolean
  tall?: boolean
}): React.JSX.Element {
  const graph = useMemo(() => buildArchitectureFlowGraph(spec), [spec])
  const { fitView } = useReactFlow()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.16, duration: reduceMotion ? 0 : 200 })
    }, 30)
    return () => window.clearTimeout(timer)
  }, [fitView, graph.nodes, graph.edges, reduceMotion])

  return (
    <ReactFlow
      className={tall ? 'h-full' : 'h-[320px]'}
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'archEdge' }}
    >
      <Background
        id="arch-grid"
        variant={BackgroundVariant.Lines}
        gap={24}
        color={APP_UI_THEME.diagram.grid}
        lineWidth={1}
      />
      <Controls
        showInteractive={false}
        className="!overflow-hidden !rounded-md !border !border-[var(--app-markdown-border)] !bg-[rgba(11,14,20,0.92)] !shadow-none"
      />
    </ReactFlow>
  )
}

function ArchitectureLegend({ t }: { t: Dictionary }): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 z-10 flex flex-wrap gap-1.5 rounded-md border border-[var(--app-markdown-border)] bg-[rgba(11,14,20,0.9)] px-2 py-1.5">
      {ARCHITECTURE_KIND_ORDER.map((kind) => {
        const tone = ARCHITECTURE_KIND_TONE[kind]
        return (
          <span
            key={kind}
            className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--app-markdown-muted)]"
          >
            <span
              className="inline-block size-2 rounded-[2px] border"
              style={{ borderColor: tone.border, background: tone.fill }}
            />
            {architectureKindLabel(t, kind)}
          </span>
        )
      })}
    </div>
  )
}

function ArchitectureSource({ code }: { code: string }): React.JSX.Element {
  return (
    <pre className="min-w-0 overflow-hidden rounded-md bg-[var(--app-markdown-canvas)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--app-markdown-text)]">
      <code>{code}</code>
    </pre>
  )
}

function architectureKindLabel(t: Dictionary, kind: ArchitectureKind): string {
  switch (kind) {
    case 'client':
      return t.common.architectureKindClient
    case 'frontend':
      return t.common.architectureKindFrontend
    case 'ingress':
      return t.common.architectureKindIngress
    case 'service':
      return t.common.architectureKindService
    case 'data':
      return t.common.architectureKindData
    case 'auth':
      return t.common.architectureKindAuth
    case 'external':
      return t.common.architectureKindExternal
    case 'queue':
      return t.common.architectureKindQueue
  }
}

function buildArchitectureFilename(extension: 'svg' | 'png'): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '')
  return `crescent-architecture-${timestamp}.${extension}`
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = (): void => setReduced(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return reduced
}
