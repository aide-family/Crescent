import { ARCHITECTURE_CANVAS, CHART_SERIES_COLORS } from '../../../shared/architecture-theme'

const PAINT_PROPS = [
  'fill',
  'stroke',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'font-size',
  'font-family',
  'font-weight'
] as const

export type SerializedChartSvg = {
  svg: string
  width: number
  height: number
}

/**
 * Clone the live Recharts SVG under `host`, inline computed paint styles,
 * and wrap with an opaque architecture canvas background for file export.
 */
export function serializeChartSvgFromHost(host: HTMLElement): SerializedChartSvg | null {
  const source =
    host.querySelector<SVGSVGElement>('svg.recharts-surface') ??
    host.querySelector<SVGSVGElement>('svg')
  if (!source) return null

  const clone = source.cloneNode(true) as SVGSVGElement
  const rect = source.getBoundingClientRect()
  const width = Math.max(
    1,
    Math.round(rect.width || Number.parseFloat(source.getAttribute('width') ?? '') || 320)
  )
  const height = Math.max(
    1,
    Math.round(rect.height || Number.parseFloat(source.getAttribute('height') ?? '') || 200)
  )

  inlineComputedPaint(source, clone)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('x', '0')
  background.setAttribute('y', '0')
  background.setAttribute('width', String(width))
  background.setAttribute('height', String(height))
  background.setAttribute('fill', ARCHITECTURE_CANVAS)
  clone.insertBefore(background, clone.firstChild)

  let svg = new XMLSerializer().serializeToString(clone)
  if (!/^<svg\b[^>]*\sxmlns=/.test(svg)) {
    svg = svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  // Safety net: any unresolved series CSS vars → architecture palette hex.
  svg = replaceCssVarsInSvgMarkup(svg, chartSeriesCssVarMap())

  return { svg, width, height }
}

/** Replace CSS var(...) paint attributes using a resolved color map (for unit tests / fallback). */
export function replaceCssVarsInSvgMarkup(markup: string, vars: Record<string, string>): string {
  return markup.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g,
    (_match, name: string, fallback?: string) =>
      vars[name] ?? fallback?.trim() ?? ARCHITECTURE_CANVAS
  )
}

export function chartSeriesCssVarMap(): Record<string, string> {
  const map: Record<string, string> = {}
  CHART_SERIES_COLORS.forEach((color, index) => {
    map[`--color-s${index}`] = color
    map[`--chart-${index + 1}`] = color
  })
  return map
}

function inlineComputedPaint(sourceRoot: Element, cloneRoot: Element): void {
  const sources = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))]
  const clones = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))]
  const count = Math.min(sources.length, clones.length)

  for (let index = 0; index < count; index++) {
    const source = sources[index]
    const clone = clones[index]
    if (!(source instanceof Element) || !(clone instanceof Element)) continue
    if (typeof window === 'undefined' || !window.getComputedStyle) continue

    const computed = window.getComputedStyle(source)
    for (const prop of PAINT_PROPS) {
      const attr = clone.getAttribute(prop)
      const needsInline =
        !attr ||
        attr.includes('var(') ||
        attr === 'currentColor' ||
        attr === 'inherit' ||
        attr.startsWith('url(')
      if (!needsInline) continue
      const value = computed.getPropertyValue(prop).trim()
      if (!value || value === 'none' || value === 'normal') continue
      clone.setAttribute(prop, value)
    }

    // Drop style attributes that still reference CSS variables after attribute inlining.
    const style = clone.getAttribute('style')
    if (style?.includes('var(')) {
      clone.removeAttribute('style')
    }
  }
}
