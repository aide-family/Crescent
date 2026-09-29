export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'radar', 'radial'] as const

export type ChartType = (typeof CHART_TYPES)[number]

export interface ChartSeries {
  name: string
  values: number[]
}

export interface ChartSpec {
  type: ChartType
  title?: string
  unit?: string
  categories: string[]
  series: ChartSeries[]
}

const CATEGORY_MIN = 2
const CATEGORY_MAX = 24
const SERIES_MIN = 1
const SERIES_MAX = 4
const TITLE_MAX = 80
const NAME_MAX = 48
const UNIT_MAX = 16
const CATEGORY_LABEL_MAX = 40

export const CHART_SPEC_EXAMPLE: ChartSpec = {
  type: 'bar',
  title: '节点内存',
  unit: '%',
  categories: ['node-a', 'node-b', 'node-c'],
  series: [{ name: '已用', values: [72, 41, 88] }]
}

export function formatChartSpecExample(): string {
  return JSON.stringify(CHART_SPEC_EXAMPLE)
}

export function isChartCodeLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'chart'
}

/** Parse a ```chart fence body. Returns null when the payload cannot be drawn. */
export function parseChartSpec(source: string): ChartSpec | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const type = parsed.type
  if (!isChartType(type)) return null

  if (!Array.isArray(parsed.categories)) return null
  if (parsed.categories.length < CATEGORY_MIN || parsed.categories.length > CATEGORY_MAX) {
    return null
  }
  const categories: string[] = []
  for (const category of parsed.categories) {
    if (typeof category !== 'string') return null
    const label = category.trim()
    if (!label || label.length > CATEGORY_LABEL_MAX) return null
    categories.push(label)
  }

  if (!Array.isArray(parsed.series)) return null
  const seriesMax = type === 'pie' || type === 'radial' ? 1 : SERIES_MAX
  if (parsed.series.length < SERIES_MIN || parsed.series.length > seriesMax) return null
  const series: ChartSeries[] = []
  for (const entry of parsed.series) {
    const parsedSeries = parseSeries(entry, categories.length)
    if (!parsedSeries) return null
    series.push(parsedSeries)
  }

  const title = readOptionalText(parsed.title, TITLE_MAX)
  if (title === undefined) return null
  const unit = readOptionalText(parsed.unit, UNIT_MAX)
  if (unit === undefined) return null

  return {
    type,
    ...(title ? { title } : {}),
    ...(unit ? { unit } : {}),
    categories,
    series
  }
}

function parseSeries(entry: unknown, categoryCount: number): ChartSeries | null {
  if (!isRecord(entry)) return null
  if (typeof entry.name !== 'string') return null
  const name = entry.name.trim()
  if (!name || name.length > NAME_MAX) return null
  if (!Array.isArray(entry.values) || entry.values.length !== categoryCount) return null
  const values: number[] = []
  for (const value of entry.values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    values.push(value)
  }
  return { name, values }
}

/** Missing or blank optional text is omitted. A wrong type or over-long value fails the spec. */
function readOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value == null) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return null
  if (text.length > maxLength) return undefined
  return text
}

function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
