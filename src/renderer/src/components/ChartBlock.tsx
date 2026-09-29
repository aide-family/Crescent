import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CheckIcon, CopyIcon, Loader2Icon } from 'lucide-react'
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

import { parseChartSpec, type ChartSpec } from '../../../shared/chart-spec'
import type { Dictionary } from '@renderer/i18n'
import { resolveMermaidBlockUiState } from '@renderer/lib/markdown-fence'
import { Button } from '@renderer/components/ui/button'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@renderer/components/ui/chart'

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)'
] as const

const panelStyle = {
  '--background': 'var(--app-markdown-surface-raised)',
  '--foreground': 'var(--app-markdown-text)',
  '--muted-foreground': 'var(--app-markdown-muted)',
  '--border': 'var(--app-markdown-border)'
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
  const reduceMotion = usePrefersReducedMotion()
  const spec = closed ? parseChartSpec(code) : null
  const uiState = resolveMermaidBlockUiState({
    closed,
    streaming,
    hasSvg: spec !== null,
    hasError: closed && spec === null
  })

  const body =
    uiState === 'ready' && spec ? (
      <div className="flex min-w-0 flex-col gap-2 p-3">
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
        <ResultChart spec={spec} reduceMotion={reduceMotion} />
        {showSource ? <ChartSource code={code} /> : null}
      </div>
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
    <div className="app-mermaid-panel min-w-0 rounded-lg border" style={panelStyle}>
      <div className="app-code-panel-header app-sticky-nested flex min-w-0 items-center justify-between gap-2 border-b pr-1 pl-3">
        <span className="app-code-panel-lang min-w-0 truncate">chart</span>
        <div className="flex shrink-0 items-center gap-1">
          {uiState === 'ready' ? (
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
    </div>
  )
}

function ResultChart({
  spec,
  reduceMotion
}: {
  spec: ChartSpec
  reduceMotion: boolean
}): React.JSX.Element {
  const rows = useMemo(() => toChartRows(spec), [spec])
  const config = useMemo(() => toChartConfig(spec), [spec])
  const sliceRows = useMemo(() => toSliceRows(spec), [spec])
  const sliceConfig = useMemo(() => toSliceConfig(spec), [spec])
  const multiple = spec.series.length > 1

  if (spec.type === 'pie') {
    return (
      <ChartContainer config={sliceConfig} className="mx-auto aspect-square max-h-[250px]">
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
      <ChartContainer config={sliceConfig} className="mx-auto aspect-square max-h-[250px]">
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
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[250px]">
        <RadarChart data={rows}>
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <PolarGrid />
          <PolarAngleAxis dataKey="category" />
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
    />
  )
  const tooltip = (
    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel={!multiple} />} />
  )
  const legend = multiple ? <ChartLegend content={<ChartLegendContent />} /> : null

  if (spec.type === 'area') {
    return (
      <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
        <AreaChart accessibilityLayer data={rows} margin={chartMargin}>
          <CartesianGrid vertical={false} />
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
      <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
        <LineChart accessibilityLayer data={rows} margin={chartMargin}>
          <CartesianGrid vertical={false} />
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
    <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
      <BarChart accessibilityLayer data={rows}>
        <CartesianGrid vertical={false} />
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
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0]
}

function seriesKey(index: number): string {
  return `s${index}`
}

function formatCategoryTick(value: string): string {
  return value.length > 12 ? `${value.slice(0, 11)}…` : value
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
