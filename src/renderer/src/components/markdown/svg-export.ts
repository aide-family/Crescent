import type { Dictionary } from '@renderer/i18n'
import {
  exportFeedback,
  notifyOperationError,
  saveTextFile
} from '@renderer/lib/operation-feedback'
import { APP_THEMES, type AppThemeId } from '@renderer/lib/theme-definitions'
import { toast } from 'sonner'

export async function downloadSvg(value: string, filename: string, t: Dictionary): Promise<void> {
  await saveTextFile(
    normalizeSvgForExport(value),
    filename,
    'image/svg+xml;charset=utf-8',
    exportFeedback(t),
    [{ name: 'SVG image', extensions: ['svg'] }]
  )
}

export async function savePngFromSvg(
  value: string,
  filename: string,
  t: Dictionary,
  themeId: AppThemeId
): Promise<void> {
  const feedback = exportFeedback(t)
  try {
    const { svg, width, height } = normalizeSvgForPng(value, themeId)
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

export function getSvgDimensions(value: string): { width: number; height: number } {
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

export function normalizeSvgForExport(value: string): string {
  const svg = normalizeSvgVoidElements(value.trim())
  return svg.startsWith('<?xml') ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`
}

export function normalizeSvgForPng(
  value: string,
  themeId: AppThemeId
): { svg: string; width: number; height: number } {
  let svg = normalizeSvgVoidElements(value.trim().replace(/^\s*<\?xml[^>]*>\s*/i, ''))
  svg = replaceForeignObjectsWithSvgText(svg, themeId)
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
    `${getSvgAttribute(nextRootTag, 'style') ?? ''}; background: ${APP_THEMES[themeId].diagram.canvas};`
  )

  svg = svg.replace(rootTag, nextRootTag)
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`,
    width,
    height
  }
}

export function normalizeSvgVoidElements(value: string): string {
  return value
    .replace(/&nbsp;/g, '&#160;')
    .replace(/<(br|hr|img|input|meta|link)(\s[^<>]*?)?>/gi, (match, tag, attrs = '') => {
      if (/\/\s*>$/.test(match)) return match
      return `<${tag}${attrs}/>`
    })
}

export function replaceForeignObjectsWithSvgText(value: string, themeId: AppThemeId): string {
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

      return `<text x="${x}" y="${y}" fill="${APP_THEMES[themeId].diagram.text}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14">${tspans}</text>`
    }
  )
}

export function extractForeignObjectText(value: string): string {
  const container = document.createElement('div')
  container.innerHTML = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (container.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function getSvgRootTag(value: string): string {
  const match = value.match(/<svg\b[^>]*>/i)
  if (!match) throw new Error('Invalid SVG.')
  return match[0]
}

export function getSvgAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\s${escapedName}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2]
}

export function setSvgAttribute(tag: string, name: string, value: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedValue = value.replace(/"/g, '&quot;')
  const attributePattern = new RegExp(`(\\s${escapedName}=)(?:"[^"]*"|'[^']*')`, 'i')
  if (attributePattern.test(tag)) return tag.replace(attributePattern, `$1"${escapedValue}"`)

  return tag.replace(/>$/, ` ${name}="${escapedValue}">`)
}

export function buildMermaidFilename(extension: 'svg' | 'png'): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '')
  return `crescent-mermaid-${timestamp}.${extension}`
}
