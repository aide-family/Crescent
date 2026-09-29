import type { ArchitectureSpec } from './architecture-spec'
import { layoutArchitecture } from './architecture-layout'
import {
  ARCHITECTURE_CANVAS,
  ARCHITECTURE_GRID,
  ARCHITECTURE_KIND_TONE,
  ARCHITECTURE_TEXT,
  ARCH_NODE_HEIGHT,
  ARCH_NODE_WIDTH
} from './architecture-theme'

/** Build a self-contained SVG for export / docs (no foreignObject). */
export function buildArchitectureExportSvg(spec: ArchitectureSpec): {
  svg: string
  width: number
  height: number
} {
  const layout = layoutArchitecture(spec, { titleOffset: spec.title ? 28 : 0 })
  const pad = 24
  const width = Math.max(320, layout.width + pad * 2)
  const height = Math.max(200, layout.height + pad * 2)

  const groupRects = layout.groups
    .map((group) => {
      const tone = ARCHITECTURE_KIND_TONE[group.kind ?? 'ingress']
      return [
        `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="12" ry="12" fill="rgba(18,22,31,0.55)" stroke="${tone.border}" stroke-width="1.25" stroke-dasharray="6 5" />`,
        `<text x="${group.x + 14}" y="${group.y + 22}" fill="${tone.border}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${escapeXml(group.label)}</text>`
      ].join('')
    })
    .join('')

  const nodeRects = layout.nodes
    .map((node) => {
      const tone = ARCHITECTURE_KIND_TONE[node.kind]
      const subtitle = node.subtitle
        ? `<text x="${node.x + ARCH_NODE_WIDTH / 2}" y="${node.y + 44}" text-anchor="middle" fill="${tone.border}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${escapeXml(node.subtitle)}</text>`
        : ''
      return [
        `<rect x="${node.x}" y="${node.y}" width="${ARCH_NODE_WIDTH}" height="${ARCH_NODE_HEIGHT}" rx="10" ry="10" fill="${tone.fill}" stroke="${tone.border}" stroke-width="1.5" />`,
        `<text x="${node.x + ARCH_NODE_WIDTH / 2}" y="${node.y + (subtitle ? 28 : 38)}" text-anchor="middle" fill="${ARCHITECTURE_TEXT}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600">${escapeXml(node.label)}</text>`,
        subtitle
      ].join('')
    })
    .join('')

  const edgePaths = layout.edges
    .map((edge) => {
      const dash = edge.dashed ? ' stroke-dasharray="6 6"' : ''
      const label = edge.label
        ? `<text x="${(edge.x1 + edge.x2) / 2}" y="${(edge.y1 + edge.y2) / 2 - 6}" text-anchor="middle" fill="${edge.color}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${escapeXml(edge.label)}</text>`
        : ''
      return `<path d="${edge.d}" fill="none" stroke="${edge.color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${dash} marker-end="url(#arch-arrow-${edge.index})" />${label}`
    })
    .join('')

  const markers = layout.edges
    .map(
      (edge) =>
        `<marker id="arch-arrow-${edge.index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${edge.color}" /></marker>`
    )
    .join('')

  const title = spec.title
    ? `<text x="${pad}" y="18" fill="${ARCHITECTURE_TEXT}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="600">${escapeXml(spec.title)}</text>`
    : ''

  // Single translate keeps nodes/edges/groups on one coordinate system (no pad drift).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
  <defs>
    <pattern id="arch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${ARCHITECTURE_GRID}" stroke-width="1"/>
    </pattern>
    ${markers}
  </defs>
  <rect width="100%" height="100%" fill="${ARCHITECTURE_CANVAS}"/>
  <rect width="100%" height="100%" fill="url(#arch-grid)"/>
  ${title}
  <g transform="translate(${pad},${pad})">
  ${groupRects}
  ${edgePaths}
  ${nodeRects}
  </g>
</svg>`

  return { svg, width, height }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
