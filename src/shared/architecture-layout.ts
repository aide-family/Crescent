import type { ArchitectureEdge, ArchitectureKind, ArchitectureSpec } from './architecture-spec'
import {
  ARCHITECTURE_KIND_TONE,
  ARCH_COL_GAP,
  ARCH_GROUP_PAD_X,
  ARCH_GROUP_PAD_Y,
  ARCH_NODE_HEIGHT,
  ARCH_NODE_WIDTH,
  ARCH_PORT_GAP,
  ARCH_ROW_GAP
} from './architecture-theme'

export type ArchPortSide = 'left' | 'right' | 'top' | 'bottom'

export type ArchitectureLayoutNode = {
  id: string
  x: number
  y: number
  label: string
  subtitle?: string
  kind: ArchitectureKind
  group?: string
}

export type ArchitectureLayoutGroup = {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  kind?: ArchitectureKind
}

export type ArchitectureLayoutPoint = { x: number; y: number }

export type ArchitectureLayoutEdge = {
  index: number
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
  sourcePort: ArchPortSide
  targetPort: ArchPortSide
  points: ArchitectureLayoutPoint[]
  d: string
  color: string
  dashed: boolean
  label?: string
}

export type ArchitectureLayout = {
  width: number
  height: number
  nodes: ArchitectureLayoutNode[]
  groups: ArchitectureLayoutGroup[]
  edges: ArchitectureLayoutEdge[]
}

export type LayoutArchitectureOptions = {
  /** Extra top inset for SVG title text (docs/export). React Flow should pass 0. */
  titleOffset?: number
}

const ELBOW_RADIUS = 12
const OBSTACLE_PAD = 16
const LANE_SPACING = 8
const BARYCENTRIC_PASSES = 8

/** Rank + place nodes/groups, then route edges through column/row gutters (avoid node cards). */
export function layoutArchitecture(
  spec: ArchitectureSpec,
  options: LayoutArchitectureOptions = {}
): ArchitectureLayout {
  const titleOffset = options.titleOffset ?? 0
  const ranks = assignRanks(spec)
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node] as const))
  const byGroup = new Map<string, string[]>()
  const ungrouped: string[] = []
  for (const node of spec.nodes) {
    if (node.group) {
      const list = byGroup.get(node.group) ?? []
      list.push(node.id)
      byGroup.set(node.group, list)
    } else {
      ungrouped.push(node.id)
    }
  }

  const neighbors = buildNeighborMap(spec)
  const abs = new Map<string, ArchitectureLayoutPoint>()

  const columns = new Map<number, string[]>()
  for (const id of ungrouped) {
    const rank = ranks.get(id) ?? 0
    const column = columns.get(rank) ?? []
    column.push(id)
    columns.set(rank, column)
  }
  placeColumns(columns, ranks, neighbors, (id, row, rank) => {
    abs.set(id, {
      x: rank * (ARCH_NODE_WIDTH + ARCH_COL_GAP),
      y: row * (ARCH_NODE_HEIGHT + ARCH_ROW_GAP) + titleOffset
    })
  })

  let groupOriginX =
    Math.max(0, ...[...abs.values()].map((point) => point.x + ARCH_NODE_WIDTH)) +
    (abs.size > 0 ? ARCH_COL_GAP : 0)
  if (!Number.isFinite(groupOriginX)) groupOriginX = 0

  const groups: ArchitectureLayoutGroup[] = []
  const groupMeta = new Map((spec.groups ?? []).map((group) => [group.id, group] as const))

  for (const groupId of orderedGroupIds(spec, byGroup)) {
    const memberIds = (byGroup.get(groupId) ?? []).slice().sort((a, b) => {
      const delta = (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0)
      return delta !== 0 ? delta : a.localeCompare(b)
    })
    const memberRanks = memberIds.map((id) => ranks.get(id) ?? 0)
    const minRank = Math.min(...memberRanks, 0)
    const localColumns = new Map<number, string[]>()
    for (const id of memberIds) {
      const localRank = (ranks.get(id) ?? 0) - minRank
      const column = localColumns.get(localRank) ?? []
      column.push(id)
      localColumns.set(localRank, column)
    }
    const orderedLocal = new Map<number, string[]>()
    for (const localRank of [...localColumns.keys()].sort((a, b) => a - b)) {
      orderedLocal.set(
        localRank,
        barycentricOrder(localColumns.get(localRank) ?? [], neighbors, ranks)
      )
    }
    const colCount = Math.max(1, ...orderedLocal.keys(), 0) + 1
    let maxRows = 1
    for (const [, ids] of orderedLocal) maxRows = Math.max(maxRows, ids.length)
    const innerWidth = colCount * ARCH_NODE_WIDTH + Math.max(0, colCount - 1) * ARCH_COL_GAP
    const innerHeight = maxRows * ARCH_NODE_HEIGHT + Math.max(0, maxRows - 1) * ARCH_ROW_GAP
    const width = innerWidth + ARCH_GROUP_PAD_X * 2
    const height = innerHeight + ARCH_GROUP_PAD_Y + ARCH_GROUP_PAD_X
    const meta = groupMeta.get(groupId)
    groups.push({
      id: groupId,
      x: groupOriginX,
      y: titleOffset,
      width,
      height,
      label: meta?.label ?? groupId,
      kind: meta?.kind
    })
    for (const [localRank, ids] of orderedLocal) {
      ids.forEach((id, row) => {
        abs.set(id, {
          x: groupOriginX + ARCH_GROUP_PAD_X + localRank * (ARCH_NODE_WIDTH + ARCH_COL_GAP),
          y: titleOffset + ARCH_GROUP_PAD_Y + row * (ARCH_NODE_HEIGHT + ARCH_ROW_GAP)
        })
      })
    }
    groupOriginX += width + ARCH_COL_GAP
  }

  const nodes: ArchitectureLayoutNode[] = spec.nodes.map((node) => {
    const point = abs.get(node.id) ?? { x: 0, y: titleOffset }
    return {
      id: node.id,
      x: point.x,
      y: point.y,
      label: node.label,
      ...(node.subtitle ? { subtitle: node.subtitle } : {}),
      kind: node.kind,
      ...(node.group ? { group: node.group } : {})
    }
  })

  const obstacles = nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    w: ARCH_NODE_WIDTH,
    h: ARCH_NODE_HEIGHT
  }))

  const channelUsage = new Map<string, number>()
  const edges: ArchitectureLayoutEdge[] = spec.edges.map((edge, index) =>
    routeOneEdge(edge, index, abs, nodeById, obstacles, channelUsage)
  )

  const maxX = Math.max(
    0,
    ...nodes.map((node) => node.x + ARCH_NODE_WIDTH),
    ...groups.map((group) => group.x + group.width)
  )
  const maxY = Math.max(
    0,
    ...nodes.map((node) => node.y + ARCH_NODE_HEIGHT),
    ...groups.map((group) => group.y + group.height)
  )

  return { width: maxX, height: maxY, nodes, groups, edges }
}

function routeOneEdge(
  edge: ArchitectureEdge,
  index: number,
  abs: Map<string, ArchitectureLayoutPoint>,
  nodeById: Map<string, { kind: ArchitectureKind }>,
  obstacles: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  channelUsage: Map<string, number>
): ArchitectureLayoutEdge {
  const from = abs.get(edge.from) ?? { x: 0, y: 0 }
  const to = abs.get(edge.to) ?? { x: 0, y: 0 }
  const ports = choosePorts(from, to)
  const blockers = obstacles.filter((box) => box.id !== edge.from && box.id !== edge.to)
  const routed = routeOrthogonal(
    ports.sx1,
    ports.sy1,
    ports.sx2,
    ports.sy2,
    blockers,
    obstacles,
    channelUsage,
    index
  )
  const points = withBorderStubs({ x: ports.x1, y: ports.y1 }, routed, { x: ports.x2, y: ports.y2 })
  const fromKind = nodeById.get(edge.from)?.kind ?? 'service'
  return {
    index,
    from: edge.from,
    to: edge.to,
    x1: ports.x1,
    y1: ports.y1,
    x2: ports.x2,
    y2: ports.y2,
    sourcePort: ports.sourcePort,
    targetPort: ports.targetPort,
    points,
    d: pointsToRoundedPath(points),
    color: ARCHITECTURE_KIND_TONE[fromKind].border,
    dashed: edge.style === 'dashed',
    ...(edge.label ? { label: edge.label } : {})
  }
}

/**
 * Border midpoints (x1/y1, x2/y2) plus outward stub points (sx/sy) for gutter routing.
 * Final path reconnects border → stub → route → stub → border.
 */
export function choosePorts(
  from: ArchitectureLayoutPoint,
  to: ArchitectureLayoutPoint
): {
  x1: number
  y1: number
  x2: number
  y2: number
  sx1: number
  sy1: number
  sx2: number
  sy2: number
  sourcePort: ArchPortSide
  targetPort: ArchPortSide
} {
  const fromCx = from.x + ARCH_NODE_WIDTH / 2
  const fromCy = from.y + ARCH_NODE_HEIGHT / 2
  const toCx = to.x + ARCH_NODE_WIDTH / 2
  const toCy = to.y + ARCH_NODE_HEIGHT / 2
  const dx = toCx - fromCx
  const dy = toCy - fromCy

  let sourcePort: ArchPortSide
  let targetPort: ArchPortSide
  let x1: number
  let y1: number
  let x2: number
  let y2: number

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      sourcePort = 'right'
      targetPort = 'left'
      x1 = from.x + ARCH_NODE_WIDTH
      y1 = fromCy
      x2 = to.x
      y2 = toCy
    } else {
      sourcePort = 'left'
      targetPort = 'right'
      x1 = from.x
      y1 = fromCy
      x2 = to.x + ARCH_NODE_WIDTH
      y2 = toCy
    }
  } else if (dy >= 0) {
    sourcePort = 'bottom'
    targetPort = 'top'
    x1 = fromCx
    y1 = from.y + ARCH_NODE_HEIGHT
    x2 = toCx
    y2 = to.y
  } else {
    sourcePort = 'top'
    targetPort = 'bottom'
    x1 = fromCx
    y1 = from.y
    x2 = toCx
    y2 = to.y + ARCH_NODE_HEIGHT
  }

  const stubStart = offsetPortOutward(x1, y1, sourcePort)
  const stubEnd = offsetPortOutward(x2, y2, targetPort)
  return {
    x1,
    y1,
    x2,
    y2,
    sx1: stubStart.x,
    sy1: stubStart.y,
    sx2: stubEnd.x,
    sy2: stubEnd.y,
    sourcePort,
    targetPort
  }
}

/** Prepend/append border anchors around a stub-to-stub route; keep stubs even if collinear. */
function withBorderStubs(
  borderStart: ArchitectureLayoutPoint,
  routed: ArchitectureLayoutPoint[],
  borderEnd: ArchitectureLayoutPoint
): ArchitectureLayoutPoint[] {
  const middle =
    routed.length >= 2
      ? routed
      : [
          { x: borderStart.x, y: borderStart.y },
          { x: borderEnd.x, y: borderEnd.y }
        ]
  const raw = [borderStart, ...middle, borderEnd]
  const out: ArchitectureLayoutPoint[] = [raw[0]!]
  for (let i = 1; i < raw.length; i++) {
    const prev = out[out.length - 1]!
    const curr = raw[i]!
    if (Math.abs(prev.x - curr.x) < 0.5 && Math.abs(prev.y - curr.y) < 0.5) continue
    out.push(curr)
  }
  return out
}

function offsetPortOutward(x: number, y: number, side: ArchPortSide): ArchitectureLayoutPoint {
  switch (side) {
    case 'right':
      return { x: x + ARCH_PORT_GAP, y }
    case 'left':
      return { x: x - ARCH_PORT_GAP, y }
    case 'bottom':
      return { x, y: y + ARCH_PORT_GAP }
    case 'top':
      return { x, y: y - ARCH_PORT_GAP }
  }
}

/**
 * Orthogonal polyline that prefers column/row gutters and skips node AABBs.
 * Falls back to the shortest clear HVH/VHV candidate, then a perimeter detour.
 */
export function routeOrthogonal(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  blockers: Array<{ x: number; y: number; w: number; h: number }>,
  allNodes: Array<{ x: number; y: number; w: number; h: number }>,
  channelUsage: Map<string, number>,
  edgeIndex: number
): ArchitectureLayoutPoint[] {
  if (
    Math.abs(y1 - y2) < 1 &&
    pathClear(
      [
        { x: x1, y: y1 },
        { x: x2, y: y2 }
      ],
      blockers
    )
  ) {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 }
    ]
  }
  if (
    Math.abs(x1 - x2) < 1 &&
    pathClear(
      [
        { x: x1, y: y1 },
        { x: x2, y: y2 }
      ],
      blockers
    )
  ) {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 }
    ]
  }

  const verticalChannels = collectVerticalChannels(allNodes)
  const horizontalChannels = collectHorizontalChannels(allNodes)
  const candidates: ArchitectureLayoutPoint[][] = []

  for (const cx of verticalChannels) {
    const lane = laneOffset(channelUsage, `v:${Math.round(cx)}`, edgeIndex)
    const x = cx + lane
    candidates.push([
      { x: x1, y: y1 },
      { x, y: y1 },
      { x, y: y2 },
      { x: x2, y: y2 }
    ])
  }
  for (const cy of horizontalChannels) {
    const lane = laneOffset(channelUsage, `h:${Math.round(cy)}`, edgeIndex)
    const y = cy + lane
    candidates.push([
      { x: x1, y: y1 },
      { x: x1, y },
      { x: x2, y },
      { x: x2, y: y2 }
    ])
  }

  // Midpoint HVH / VHV (legacy) as low-priority candidates.
  candidates.push([
    { x: x1, y: y1 },
    { x: (x1 + x2) / 2, y: y1 },
    { x: (x1 + x2) / 2, y: y2 },
    { x: x2, y: y2 }
  ])
  candidates.push([
    { x: x1, y: y1 },
    { x: x1, y: (y1 + y2) / 2 },
    { x: x2, y: (y1 + y2) / 2 },
    { x: x2, y: y2 }
  ])

  const bounds = boundsOf(allNodes)
  const topY = bounds.minY - ARCH_ROW_GAP / 2
  const bottomY = bounds.maxY + ARCH_ROW_GAP / 2
  const leftX = bounds.minX - ARCH_COL_GAP / 2
  const rightX = bounds.maxX + ARCH_COL_GAP / 2
  for (const y of [topY, bottomY]) {
    const lane = laneOffset(channelUsage, `h-edge:${Math.round(y)}`, edgeIndex)
    candidates.push([
      { x: x1, y: y1 },
      { x: x1, y: y + lane },
      { x: x2, y: y + lane },
      { x: x2, y: y2 }
    ])
  }
  for (const x of [leftX, rightX]) {
    const lane = laneOffset(channelUsage, `v-edge:${Math.round(x)}`, edgeIndex)
    candidates.push([
      { x: x1, y: y1 },
      { x: x + lane, y: y1 },
      { x: x + lane, y: y2 },
      { x: x2, y: y2 }
    ])
  }

  let best: ArchitectureLayoutPoint[] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const path of candidates) {
    const simplified = simplifyOrthogonal(path)
    if (!pathClear(simplified, blockers)) continue
    const score = pathLength(simplified) + bendCount(simplified) * 40
    if (score < bestScore) {
      bestScore = score
      best = simplified
    }
  }

  if (best) {
    commitChannelUsage(best, channelUsage)
    return best
  }

  // Last resort: go around the top perimeter (always geometrically valid for card AABBs).
  const escapeY = topY - LANE_SPACING * (1 + (edgeIndex % 3))
  const fallback = simplifyOrthogonal([
    { x: x1, y: y1 },
    { x: x1, y: escapeY },
    { x: x2, y: escapeY },
    { x: x2, y: y2 }
  ])
  commitChannelUsage(fallback, channelUsage)
  return fallback
}

export function pointsToRoundedPath(points: ArchitectureLayoutPoint[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`
  }

  const parts: string[] = [`M ${points[0]!.x} ${points[0]!.y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const inDx = Math.sign(curr.x - prev.x)
    const inDy = Math.sign(curr.y - prev.y)
    const outDx = Math.sign(next.x - curr.x)
    const outDy = Math.sign(next.y - curr.y)
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y)
    const radius = Math.min(ELBOW_RADIUS, inLen / 2 - 0.5, outLen / 2 - 0.5)
    if (radius < 2) {
      parts.push(`L ${curr.x} ${curr.y}`)
      continue
    }
    const before = { x: curr.x - inDx * radius, y: curr.y - inDy * radius }
    const after = { x: curr.x + outDx * radius, y: curr.y + outDy * radius }
    parts.push(`L ${before.x} ${before.y}`)
    parts.push(`Q ${curr.x} ${curr.y} ${after.x} ${after.y}`)
  }
  const last = points[points.length - 1]!
  parts.push(`L ${last.x} ${last.y}`)
  return parts.join(' ')
}

/** Sample polyline interiors; true when any sample lies inside a non-endpoint node card. */
export function pathIntersectsNodes(
  points: ArchitectureLayoutPoint[],
  nodes: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  endpointIds: Set<string>
): boolean {
  const samples = samplePath(points, 4)
  for (const sample of samples) {
    for (const node of nodes) {
      if (endpointIds.has(node.id)) continue
      if (pointInRect(sample.x, sample.y, node, OBSTACLE_PAD)) return true
    }
  }
  return false
}

function placeColumns(
  columns: Map<number, string[]>,
  ranks: Map<string, number>,
  neighbors: Map<string, string[]>,
  place: (id: string, row: number, rank: number) => void
): void {
  const ranksSorted = [...columns.keys()].sort((a, b) => a - b)
  for (const rank of ranksSorted) {
    const ordered = barycentricOrder(columns.get(rank) ?? [], neighbors, ranks)
    columns.set(rank, ordered)
    ordered.forEach((id, row) => place(id, row, rank))
  }
}

function barycentricOrder(
  ids: string[],
  neighbors: Map<string, string[]>,
  ranks: Map<string, number>
): string[] {
  if (ids.length <= 1) return ids.slice().sort((a, b) => a.localeCompare(b))
  let order = ids.slice().sort((a, b) => a.localeCompare(b))
  const indexOf = () => new Map(order.map((id, index) => [id, index] as const))

  for (let pass = 0; pass < BARYCENTRIC_PASSES; pass++) {
    const index = indexOf()
    const scored = order.map((id) => {
      const neigh = neighbors.get(id) ?? []
      const positions = neigh
        .map((other) => index.get(other))
        .filter((value): value is number => value !== undefined)
      const avg =
        positions.length > 0
          ? positions.reduce((sum, value) => sum + value, 0) / positions.length
          : (index.get(id) ?? 0)
      return { id, avg, rank: ranks.get(id) ?? 0 }
    })
    scored.sort((a, b) => {
      if (a.avg !== b.avg) return a.avg - b.avg
      return a.id.localeCompare(b.id)
    })
    const next = scored.map((item) => item.id)
    if (next.every((id, i) => id === order[i])) break
    order = next
  }
  return order
}

function buildNeighborMap(spec: ArchitectureSpec): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const node of spec.nodes) map.set(node.id, [])
  for (const edge of spec.edges) {
    map.get(edge.from)?.push(edge.to)
    map.get(edge.to)?.push(edge.from)
  }
  return map
}

function orderedGroupIds(spec: ArchitectureSpec, byGroup: Map<string, string[]>): string[] {
  const declared = (spec.groups ?? []).map((group) => group.id).filter((id) => byGroup.has(id))
  const extras = [...byGroup.keys()].filter((id) => !declared.includes(id)).sort()
  return [...declared, ...extras]
}

function assignRanks(spec: ArchitectureSpec): Map<string, number> {
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of spec.nodes) {
    incoming.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of spec.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const ranks = new Map<string, number>()
  const queue = spec.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
  if (queue.length === 0) for (const node of spec.nodes) queue.push(node.id)
  for (const id of queue) ranks.set(id, 0)
  const seen = new Set(queue)
  while (queue.length > 0) {
    const id = queue.shift()!
    const rank = ranks.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      ranks.set(next, Math.max(ranks.get(next) ?? 0, rank + 1))
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  for (const node of spec.nodes) if (!ranks.has(node.id)) ranks.set(node.id, 0)
  return ranks
}

function collectVerticalChannels(
  nodes: Array<{ x: number; y: number; w: number; h: number }>
): number[] {
  if (nodes.length === 0) return []
  const lefts = [...new Set(nodes.map((node) => node.x))].sort((a, b) => a - b)
  const channels: number[] = []
  for (let i = 0; i < lefts.length - 1; i++) {
    const left = lefts[i]!
    const right = lefts[i + 1]!
    const gapStart = left + ARCH_NODE_WIDTH
    if (right - gapStart >= ARCH_COL_GAP * 0.5) {
      channels.push(gapStart + (right - gapStart) / 2)
    }
  }
  const bounds = boundsOf(nodes)
  channels.push(bounds.minX - ARCH_COL_GAP / 2)
  channels.push(bounds.maxX + ARCH_COL_GAP / 2)
  return [...new Set(channels.map((value) => Math.round(value * 10) / 10))]
}

function collectHorizontalChannels(
  nodes: Array<{ x: number; y: number; w: number; h: number }>
): number[] {
  if (nodes.length === 0) return []
  const tops = [...new Set(nodes.map((node) => node.y))].sort((a, b) => a - b)
  const channels: number[] = []
  for (let i = 0; i < tops.length - 1; i++) {
    const top = tops[i]!
    const next = tops[i + 1]!
    const gapStart = top + ARCH_NODE_HEIGHT
    if (next - gapStart >= ARCH_ROW_GAP * 0.5) {
      channels.push(gapStart + (next - gapStart) / 2)
    }
  }
  const bounds = boundsOf(nodes)
  channels.push(bounds.minY - ARCH_ROW_GAP / 2)
  channels.push(bounds.maxY + ARCH_ROW_GAP / 2)
  return [...new Set(channels.map((value) => Math.round(value * 10) / 10))]
}

function boundsOf(nodes: Array<{ x: number; y: number; w: number; h: number }>): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.w)),
    maxY: Math.max(...nodes.map((node) => node.y + node.h))
  }
}

function laneOffset(usage: Map<string, number>, key: string, edgeIndex: number): number {
  const count = usage.get(key) ?? 0
  const sign = edgeIndex % 2 === 0 ? 1 : -1
  return sign * Math.ceil(count / 2) * LANE_SPACING
}

function commitChannelUsage(points: ArchitectureLayoutPoint[], usage: Map<string, number>): void {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (Math.abs(a.x - b.x) < 1) {
      const key = `v:${Math.round(a.x)}`
      usage.set(key, (usage.get(key) ?? 0) + 1)
    } else if (Math.abs(a.y - b.y) < 1) {
      const key = `h:${Math.round(a.y)}`
      usage.set(key, (usage.get(key) ?? 0) + 1)
    }
  }
}

function pathClear(
  points: ArchitectureLayoutPoint[],
  blockers: Array<{ x: number; y: number; w: number; h: number }>
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    for (const box of blockers) {
      if (segmentHitsRect(a.x, a.y, b.x, b.y, box, OBSTACLE_PAD)) return false
    }
  }
  return true
}

function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: { x: number; y: number; w: number; h: number },
  pad: number
): boolean {
  const left = box.x - pad
  const right = box.x + box.w + pad
  const top = box.y - pad
  const bottom = box.y + box.h + pad

  // Degenerate: treat endpoints on the border as OK when the segment runs along the outside.
  if (Math.abs(y1 - y2) < 0.5) {
    const y = y1
    if (y <= top || y >= bottom) return false
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    return maxX > left && minX < right
  }
  if (Math.abs(x1 - x2) < 0.5) {
    const x = x1
    if (x <= left || x >= right) return false
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)
    return maxY > top && minY < bottom
  }
  return false
}

function pointInRect(
  x: number,
  y: number,
  box: { x: number; y: number; w: number; h: number },
  pad: number
): boolean {
  return x > box.x + pad && x < box.x + box.w - pad && y > box.y + pad && y < box.y + box.h - pad
}

function samplePath(points: ArchitectureLayoutPoint[], step: number): ArchitectureLayoutPoint[] {
  const samples: ArchitectureLayoutPoint[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const count = Math.max(1, Math.floor(len / step))
    for (let s = 1; s < count; s++) {
      const t = s / count
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return samples
}

function simplifyOrthogonal(points: ArchitectureLayoutPoint[]): ArchitectureLayoutPoint[] {
  if (points.length <= 2) return points
  const out: ArchitectureLayoutPoint[] = [points[0]!]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const colinear =
      (Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5) ||
      (Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5)
    if (!colinear) out.push(curr)
  }
  out.push(points[points.length - 1]!)
  return out
}

function pathLength(points: ArchitectureLayoutPoint[]): number {
  let sum = 0
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y)
  }
  return sum
}

function bendCount(points: ArchitectureLayoutPoint[]): number {
  return Math.max(0, points.length - 2)
}
