import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CheckIcon, CopyIcon, DownloadIcon, Loader2Icon, Maximize2Icon, XIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis
} from 'recharts'

import {
  ARCHITECTURE_CANVAS,
  ARCHITECTURE_GRID,
  CHART_SERIES_COLORS
} from '../../../shared/architecture-theme'
import { parseChartSpec, type ChartSpec } from '../../../shared/chart-spec'
import type { Dictionary } from '@renderer/i18n'
import { serializeChartSvgFromHost } from '@renderer/lib/chart-export'
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
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@renderer/components/ui/chart'

const TICK_FILL = 'rgba(238,242,247,0.72)'

const panelStyle = {
  '--background': 'var(--app-markdown-surface-raised)',
  '--foreground': 'var(--app-markdown-text)',
  '--muted-foreground': 'var(--app-markdown-muted)',
  '--border': 'var(--app-markdown-border)',
  '--app-diagram-canvas': ARCHITECTURE_CANVAS
} as CSSProperties

export function ChartBlock({
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
  const inlineChartHostRef = useRef<HTMLDivElement | null>(null)
  const expandedChartHostRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = usePrefersReducedMotion()
  const spec = closed ? parseChartSpec(code) : null
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

  function captureExportSvg(): { svg: string; width: number; height: number } {
    const host =
      (expanded ? expandedChartHostRef.current : null) ??
      inlineChartHostRef.current ??
      expandedChartHostRef.current
    if (!host) {
      throw new Error('Chart is not ready to export.')
    }
    const serialized = serializeChartSvgFromHost(host)
    if (!serialized) {
      throw new Error('Chart SVG was not found.')
    }
    return serialized
  }

  async function exportSvg(): Promise<void> {
    if (!spec) return
    const feedback = exportFeedback(t)
    try {
      const { svg } = captureExportSvg()
      await saveTextFile(
        svg.startsWith('<?xml') ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`,
        buildChartFilename('svg'),
        'image/svg+xml;charset=utf-8',
        feedback,
        [{ name: 'SVG image', extensions: ['svg'] }]
      )
    } catch (error) {
      notifyOperationError(feedback.failed, error)
    }
  }

  async function exportPng(): Promise<void> {
    if (!spec) return
    const feedback = exportFeedback(t)
    try {
      const { svg, width, height } = captureExportSvg()
      const result = await window.api.agent.saveSvgAsPng({
        svg,
        defaultPath: buildChartFilename('png'),
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

  const exportMenu =
    uiState === 'ready' && spec ? (
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
    ) : null

  const chartBody =
    uiState === 'ready' && spec ? (
      <ChartPanelBody
        hostRef={inlineChartHostRef}
        spec={spec}
        code={code}
        showSource={showSource}
        reduceMotion={reduceMotion}
        tall={false}
      />
    ) : uiState === 'generating' ? (
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          {t.common.chartGenerating}
        </div>
        {code.trim() ? (
          <details className="rounded-md border border-border/50 bg-muted/20">
            <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {t.common.chartSourceToggle}
            </summary>
            <ChartSource code={code} />
          </details>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-col gap-2 p-3">
        <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {t.common.chartRenderFailed}
        </div>
        <ChartSource code={code} />
      </div>
    )

  return (
    <div
      className="app-mermaid-panel app-architecture-panel min-w-0 rounded-lg border"
      style={panelStyle}
    >
      <div className="app-code-panel-header app-sticky-nested relative z-20 flex min-w-0 items-center justify-between gap-2 border-b bg-[var(--app-terminal-rail)] pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">chart</span>
        <div className="relative z-20 flex shrink-0 items-center gap-1">
          {uiState === 'ready' && spec ? (
            <>
              {exportMenu}
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
                {t.common.chartSourceToggle}
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
      {chartBody}
      {expanded && spec
        ? createPortal(
            <div
              ref={expandedOverlayRef}
              className="app-fullscreen-overlay app-mermaid-expanded fixed inset-0 z-50 flex flex-col overscroll-contain"
              style={panelStyle}
            >
              <div
                ref={panelRef}
                className="flex min-h-0 flex-1 flex-col"
                role="dialog"
                aria-modal="true"
                aria-label={spec.title || 'chart'}
              >
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    chart{spec.title ? ` · ${spec.title}` : ''}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {exportMenu}
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
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <ChartPanelBody
                    hostRef={expandedChartHostRef}
                    spec={spec}
                    code={code}
                    showSource={false}
                    reduceMotion={reduceMotion}
                    tall
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

function ChartPanelBody({
  hostRef,
  spec,
  code,
  showSource,
  reduceMotion,
  tall
}: {
  hostRef: React.RefObject<HTMLDivElement | null>
  spec: ChartSpec
  code: string
  showSource: boolean
  reduceMotion: boolean
  tall: boolean
}): React.JSX.Element {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${tall ? 'h-full' : 'p-3'}`}>
      {spec.title || spec.unit ? (
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          {spec.title ? (
            <span className="min-w-0 truncate text-xs font-medium text-[var(--app-markdown-text)]">
              {spec.title}
            </span>
          ) : (
            <span />
          )}
          {spec.unit ? (
            <span className="shrink-0 text-[11px] text-[var(--app-markdown-muted)]">
              {spec.unit}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={`overflow-hidden rounded-md border border-[var(--app-markdown-border)] ${
          tall ? 'min-h-[60vh] flex-1' : ''
        }`}
        style={{ background: ARCHITECTURE_CANVAS }}
      >
        <div className={tall ? 'flex h-full min-h-[60vh] items-center p-4' : 'p-2'}>
          <ResultChart spec={spec} reduceMotion={reduceMotion} tall={tall} />
        </div>
      </div>
      {showSource ? <ChartSource code={code} /> : null}
    </div>
  )
}

function ResultChart({
  spec,
  reduceMotion,
  tall = false
}: {
  spec: ChartSpec
  reduceMotion: boolean
  tall?: boolean
}): React.JSX.Element {
  const rows = useMemo(() => toChartRows(spec), [spec])
  const config = useMemo(() => toChartConfig(spec), [spec])
  const sliceRows = useMemo(() => toSliceRows(spec), [spec])
  const sliceConfig = useMemo(() => toSliceConfig(spec), [spec])
  const multiple = spec.series.length > 1
  const squareClass = tall
    ? 'mx-auto aspect-square max-h-[min(70vh,520px)] w-full'
    : 'mx-auto aspect-square max-h-[250px]'
  const cartesianClass = tall
    ? 'aspect-auto h-[min(70vh,480px)] w-full'
    : 'aspect-auto h-[200px] w-full'

  if (spec.type === 'pie') {
    return (
      <ChartContainer config={sliceConfig} className={squareClass}>
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel nameKey="slice" />}
          />
          <Pie data={sliceRows} dataKey="value" nameKey="slice" isAnimationActive={!reduceMotion} />
        </PieChart>
      </ChartContainer>
    )
  }

  if (spec.type === 'radial') {
    return (
      <ChartContainer config={sliceConfig} className={squareClass}>
        <RadialBarChart data={sliceRows} innerRadius={30} outerRadius={110}>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel nameKey="slice" />}
          />
          <RadialBar dataKey="value" background isAnimationActive={!reduceMotion} />
        </RadialBarChart>
      </ChartContainer>
    )
  }

  if (spec.type === 'radar') {
    return (
      <ChartContainer config={config} className={squareClass}>
        <RadarChart data={rows}>
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <PolarGrid stroke={ARCHITECTURE_GRID} />
          <PolarAngleAxis dataKey="category" tick={{ fill: TICK_FILL, fontSize: 11 }} />
          {multiple ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {spec.series.map((_, index) => {
            const key = seriesKey(index)
            return (
              <Radar
                key={key}
                dataKey={key}
                fill={`var(--color-${key})`}
                fillOpacity={0.6}
                isAnimationActive={!reduceMotion}
              />
            )
          })}
        </RadarChart>
      </ChartContainer>
    )
  }

  const categoryAxis = (
    <XAxis
      dataKey="category"
      tickLine={false}
      axisLine={false}
      tickMargin={spec.type === 'bar' ? 10 : 8}
      interval={spec.categories.length <= 8 ? 0 : 'preserveStartEnd'}
      tickFormatter={formatCategoryTick}
      tick={{ fill: TICK_FILL, fontSize: 11 }}
    />
  )
  const tooltip = (
    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel={!multiple} />} />
  )
  const legend = multiple ? <ChartLegend content={<ChartLegendContent />} /> : null
  const grid = <CartesianGrid vertical={false} stroke={ARCHITECTURE_GRID} />

  if (spec.type === 'area') {
    return (
      <ChartContainer config={config} className={cartesianClass}>
        <AreaChart accessibilityLayer data={rows} margin={chartMargin}>
          {grid}
          {categoryAxis}
          {tooltip}
          {legend}
          {spec.series.map((_, index) => {
            const key = seriesKey(index)
            const color = `var(--color-${key})`
            return (
              <Area
                key={key}
                dataKey={key}
                type="natural"
                fill={color}
                fillOpacity={0.4}
                stroke={color}
                isAnimationActive={!reduceMotion}
              />
            )
          })}
        </AreaChart>
      </ChartContainer>
    )
  }

  if (spec.type === 'line') {
    return (
      <ChartContainer config={config} className={cartesianClass}>
        <LineChart accessibilityLayer data={rows} margin={chartMargin}>
          {grid}
          {categoryAxis}
          {tooltip}
          {legend}
          {spec.series.map((_, index) => {
            const key = seriesKey(index)
            return (
              <Line
                key={key}
                dataKey={key}
                type="natural"
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={!reduceMotion}
              />
            )
          })}
        </LineChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className={cartesianClass}>
      <BarChart accessibilityLayer data={rows}>
        {grid}
        {categoryAxis}
        {tooltip}
        {legend}
        {spec.series.map((_, index) => {
          const key = seriesKey(index)
          return (
            <Bar
              key={key}
              dataKey={key}
              fill={`var(--color-${key})`}
              radius={8}
              isAnimationActive={!reduceMotion}
            />
          )
        })}
      </BarChart>
    </ChartContainer>
  )
}

function ChartSource({ code }: { code: string }): React.JSX.Element {
  return (
    <pre className="min-w-0 overflow-hidden rounded-md bg-[var(--app-markdown-canvas)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--app-markdown-text)]">
      <code>{code}</code>
    </pre>
  )
}

const chartMargin = { left: 12, right: 12 }

function toChartRows(spec: ChartSpec): Array<Record<string, string | number>> {
  return spec.categories.map((category, index) => {
    const row: Record<string, string | number> = { category }
    spec.series.forEach((series, seriesIndex) => {
      row[seriesKey(seriesIndex)] = series.values[index] ?? 0
    })
    return row
  })
}

function toChartConfig(spec: ChartSpec): ChartConfig {
  const config: ChartConfig = {}
  spec.series.forEach((series, index) => {
    config[seriesKey(index)] = {
      label: series.name,
      color: chartColor(index)
    }
  })
  return config
}

interface SliceRow {
  slice: string
  value: number
  fill: string
}

function toSliceRows(spec: ChartSpec): SliceRow[] {
  const series = spec.series[0]
  if (!series) return []
  return spec.categories.map((_, index) => ({
    slice: seriesKey(index),
    value: series.values[index] ?? 0,
    fill: `var(--color-${seriesKey(index)})`
  }))
}

function toSliceConfig(spec: ChartSpec): ChartConfig {
  const config: ChartConfig = {}
  spec.categories.forEach((category, index) => {
    config[seriesKey(index)] = {
      label: category,
      color: chartColor(index)
    }
  })
  return config
}

function chartColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] ?? CHART_SERIES_COLORS[0]!
}

function seriesKey(index: number): string {
  return `s${index}`
}

function formatCategoryTick(value: string): string {
  return value.length > 12 ? `${value.slice(0, 11)}…` : value
}

function buildChartFilename(extension: 'svg' | 'png'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `crescent-chart-${stamp}.${extension}`
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}
