import type { ArchitectureEdge, ArchitectureKind, ArchitectureSpec } from './architecture-spec'
import {
  ARCH_COL_GAP,
  ARCH_GROUP_PAD_X,
  ARCH_GROUP_PAD_Y,
  ARCH_NODE_HEIGHT,
  ARCH_NODE_WIDTH,
  ARCH_PORT_GAP,
  ARCH_ROW_GAP
} from './architecture-geometry'

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
  kind: ArchitectureKind
  dashed: boolean
  label?: string
  /** Layout-resolved label anchor (shared by Flow + SVG). */
  labelX?: number
  labelY?: number
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
  /** Target canvas width/height ratio used to derive a wrap budget (default 16/9). */
  targetAspect?: number
  /** Hard max layout width; when omitted, derived from height × targetAspect and clamped. */
  maxWidth?: number
}

const DEFAULT_TARGET_ASPECT = 16 / 9
const BUDGET_WIDTH_MIN = 960
const BUDGET_WIDTH_MAX = 1440

const ELBOW_RADIUS = 12
const OBSTACLE_PAD = 16
const LANE_SPACING = 8
const BARYCENTRIC_PASSES = 8
/** Prefer an already-chosen bus spine for same out/in membership. */
const BUS_PREF_BONUS = 600
const BUS_PREF_PARTIAL = 250
const BUS_PREF_PENALTY = 900
/** Softly prefer named gutters over free midpoints so buses can lock. */
const MIDPOINT_PENALTY = 80
const BEND_COST = 100
const EXTRA_BEND_COST = 60
const LABEL_BOX_HEIGHT = 14
const LABEL_CHAR_WIDTH = 6.5
const LABEL_MIN_WIDTH = 24
const LABEL_NODE_PAD = 6

/** Per-gutter occupancy: out:/in: membership keys share a lane when matched. */
type ChannelLaneState = {
  keyToLane: Map<string, number>
  nextLane: number
}
type ChannelUsage = Map<string, ChannelLaneState>
/** membershipKey → preferred spine near that end (out=egress, in=ingress). */
type BusSpinePreference = Map<string, string>
/** membershipKey → shared long-haul corridor channel. */
type BusLongHaulPreference = Map<string, string>

type PreferredBuses = {
  egress?: string
  ingress?: string
  longHaul?: string
}

type OrthogonalRouteResult = {
  points: ArchitectureLayoutPoint[]
  channelKeys: string[]
  sharpJoins: boolean
}

type GroupPlacePlan = {
  id: string
  width: number
  height: number
  label: string
  kind?: ArchitectureKind
  orderedLocal: Map<number, string[]>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveLayoutBudgetWidth(
  estimatedHeight: number,
  options: LayoutArchitectureOptions
): number {
  if (options.maxWidth !== undefined && Number.isFinite(options.maxWidth)) {
    return Math.max(1, options.maxWidth)
  }
  const aspect = options.targetAspect ?? DEFAULT_TARGET_ASPECT
  return clamp(Math.round(estimatedHeight * aspect), BUDGET_WIDTH_MIN, BUDGET_WIDTH_MAX)
}

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
  const colPitch = ARCH_NODE_WIDTH + ARCH_COL_GAP
  const rowPitch = ARCH_NODE_HEIGHT + ARCH_ROW_GAP

  const columns = new Map<number, string[]>()
  for (const id of ungrouped) {
    const rank = ranks.get(id) ?? 0
    const column = columns.get(rank) ?? []
    column.push(id)
    columns.set(rank, column)
  }
  const orderedColumns = new Map<number, string[]>()
  for (const rank of [...columns.keys()].sort((a, b) => a - b)) {
    orderedColumns.set(rank, barycentricOrder(columns.get(rank) ?? [], neighbors, ranks))
  }

  const groupMeta = new Map((spec.groups ?? []).map((group) => [group.id, group] as const))
  const groupPlans: GroupPlacePlan[] = []
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
    const meta = groupMeta.get(groupId)
    groupPlans.push({
      id: groupId,
      width: innerWidth + ARCH_GROUP_PAD_X * 2,
      height: innerHeight + ARCH_GROUP_PAD_Y + ARCH_GROUP_PAD_X,
      label: meta?.label ?? groupId,
      ...(meta?.kind ? { kind: meta.kind } : {}),
      orderedLocal
    })
  }

  let maxUngroupedRows = 0
  for (const [, ids] of orderedColumns) maxUngroupedRows = Math.max(maxUngroupedRows, ids.length)
  const ungroupedContentH =
    maxUngroupedRows === 0
      ? 0
      : maxUngroupedRows * ARCH_NODE_HEIGHT + Math.max(0, maxUngroupedRows - 1) * ARCH_ROW_GAP
  const maxGroupH = groupPlans.reduce((max, plan) => Math.max(max, plan.height), 0)
  const estimatedHeight =
    titleOffset + ungroupedContentH + (groupPlans.length > 0 ? ARCH_ROW_GAP + maxGroupH : 0)
  const budgetW = resolveLayoutBudgetWidth(Math.max(estimatedHeight, ARCH_NODE_HEIGHT), options)

  const rankKeys = [...orderedColumns.keys()]
  const rankCount = rankKeys.length === 0 ? 0 : Math.max(...rankKeys) + 1
  const needsBanding = rankCount > 0 && rankCount * colPitch > budgetW
  const colsPerBand = needsBanding
    ? Math.max(1, Math.floor(budgetW / colPitch))
    : Math.max(1, rankCount || 1)

  const bandMaxRows = new Map<number, number>()
  for (const [rank, ids] of orderedColumns) {
    const band = Math.floor(rank / colsPerBand)
    bandMaxRows.set(band, Math.max(bandMaxRows.get(band) ?? 0, ids.length))
  }
  const bandY0 = new Map<number, number>()
  let bandYCursor = titleOffset
  for (const band of [...bandMaxRows.keys()].sort((a, b) => a - b)) {
    bandY0.set(band, bandYCursor)
    const rows = bandMaxRows.get(band) ?? 1
    const bandH = rows * ARCH_NODE_HEIGHT + Math.max(0, rows - 1) * ARCH_ROW_GAP
    bandYCursor += bandH + ARCH_ROW_GAP
  }

  for (const [rank, ids] of orderedColumns) {
    const band = Math.floor(rank / colsPerBand)
    const displayCol = rank % colsPerBand
    const baseY = bandY0.get(band) ?? titleOffset
    ids.forEach((id, row) => {
      abs.set(id, {
        x: displayCol * colPitch,
        y: baseY + row * rowPitch
      })
    })
  }

  const ungroupedRight =
    abs.size === 0 ? 0 : Math.max(...[...abs.values()].map((point) => point.x + ARCH_NODE_WIDTH))
  const shelfStartX = abs.size > 0 ? ungroupedRight + ARCH_COL_GAP : 0
  let cursorX = shelfStartX
  let rowY = titleOffset
  let rowHeight = 0

  const groups: ArchitectureLayoutGroup[] = []
  for (const plan of groupPlans) {
    if (cursorX > shelfStartX && cursorX + plan.width > budgetW) {
      rowY += rowHeight + ARCH_ROW_GAP
      cursorX = shelfStartX
      rowHeight = 0
    }
    groups.push({
      id: plan.id,
      x: cursorX,
      y: rowY,
      width: plan.width,
      height: plan.height,
      label: plan.label,
      ...(plan.kind ? { kind: plan.kind } : {})
    })
    for (const [localRank, ids] of plan.orderedLocal) {
      ids.forEach((id, row) => {
        abs.set(id, {
          x: cursorX + ARCH_GROUP_PAD_X + localRank * colPitch,
          y: rowY + ARCH_GROUP_PAD_Y + row * rowPitch
        })
      })
    }
    cursorX += plan.width + ARCH_COL_GAP
    rowHeight = Math.max(rowHeight, plan.height)
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

  const channelUsage: ChannelUsage = new Map()
  const busSpine: BusSpinePreference = new Map()
  const busLongHaul: BusLongHaulPreference = new Map()
  const canonicalPorts = resolveCanonicalPorts(spec, abs)
  const edges: ArchitectureLayoutEdge[] = spec.edges.map((edge, index) =>
    routeOneEdge(
      edge,
      index,
      abs,
      nodeById,
      obstacles,
      channelUsage,
      busSpine,
      busLongHaul,
      canonicalPorts
    )
  )
  placeEdgeLabels(edges, nodes)

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

type CanonicalPorts = {
  exit: Map<string, ArchPortSide>
  entry: Map<string, ArchPortSide>
}

const EXIT_PORT_TIEBREAK: ArchPortSide[] = ['right', 'left', 'bottom', 'top']
const ENTRY_PORT_TIEBREAK: ArchPortSide[] = ['left', 'right', 'top', 'bottom']

function routeOneEdge(
  edge: ArchitectureEdge,
  index: number,
  abs: Map<string, ArchitectureLayoutPoint>,
  nodeById: Map<string, { kind: ArchitectureKind }>,
  obstacles: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  channelUsage: ChannelUsage,
  busSpine: BusSpinePreference,
  busLongHaul: BusLongHaulPreference,
  canonicalPorts: CanonicalPorts
): ArchitectureLayoutEdge {
  const from = abs.get(edge.from) ?? { x: 0, y: 0 }
  const to = abs.get(edge.to) ?? { x: 0, y: 0 }
  const ports = choosePorts(from, to, {
    ...(canonicalPorts.exit.has(edge.from)
      ? { sourcePort: canonicalPorts.exit.get(edge.from)! }
      : {}),
    ...(canonicalPorts.entry.has(edge.to) ? { targetPort: canonicalPorts.entry.get(edge.to)! } : {})
  })
  const blockers = obstacles.filter((box) => box.id !== edge.from && box.id !== edge.to)
  const membershipKeys = [`out:${edge.from}`, `in:${edge.to}`]
  const routed = routeOrthogonal(
    ports.sx1,
    ports.sy1,
    ports.sx2,
    ports.sy2,
    blockers,
    obstacles,
    channelUsage,
    membershipKeys,
    busSpine,
    busLongHaul
  )
  const points = withBorderStubs({ x: ports.x1, y: ports.y1 }, routed.points, {
    x: ports.x2,
    y: ports.y2
  })
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
    kind: fromKind,
    dashed: edge.style === 'dashed',
    ...(edge.label ? { label: edge.label } : {})
  }
}

function borderPointOnSide(
  node: ArchitectureLayoutPoint,
  side: ArchPortSide
): ArchitectureLayoutPoint {
  const cx = node.x + ARCH_NODE_WIDTH / 2
  const cy = node.y + ARCH_NODE_HEIGHT / 2
  switch (side) {
    case 'right':
      return { x: node.x + ARCH_NODE_WIDTH, y: cy }
    case 'left':
      return { x: node.x, y: cy }
    case 'bottom':
      return { x: cx, y: node.y + ARCH_NODE_HEIGHT }
    case 'top':
      return { x: cx, y: node.y }
  }
}

function pickMajorityPort(votes: ArchPortSide[], tieOrder: ArchPortSide[]): ArchPortSide {
  const counts = new Map<ArchPortSide, number>()
  for (const vote of votes) {
    counts.set(vote, (counts.get(vote) ?? 0) + 1)
  }
  let best: ArchPortSide = tieOrder[0]!
  let bestCount = -1
  for (const side of tieOrder) {
    const count = counts.get(side) ?? 0
    if (count > bestCount) {
      best = side
      bestCount = count
    }
  }
  return best
}

/** One shared exit side per source node and entry side per target (majority of natural ports). */
function resolveCanonicalPorts(
  spec: ArchitectureSpec,
  abs: Map<string, ArchitectureLayoutPoint>
): CanonicalPorts {
  const exitVotes = new Map<string, ArchPortSide[]>()
  const entryVotes = new Map<string, ArchPortSide[]>()
  for (const edge of spec.edges) {
    const from = abs.get(edge.from) ?? { x: 0, y: 0 }
    const to = abs.get(edge.to) ?? { x: 0, y: 0 }
    const natural = choosePorts(from, to)
    const exits = exitVotes.get(edge.from) ?? []
    exits.push(natural.sourcePort)
    exitVotes.set(edge.from, exits)
    const entries = entryVotes.get(edge.to) ?? []
    entries.push(natural.targetPort)
    entryVotes.set(edge.to, entries)
  }
  const exit = new Map<string, ArchPortSide>()
  for (const [id, votes] of exitVotes) {
    exit.set(id, pickMajorityPort(votes, EXIT_PORT_TIEBREAK))
  }
  const entry = new Map<string, ArchPortSide>()
  for (const [id, votes] of entryVotes) {
    entry.set(id, pickMajorityPort(votes, ENTRY_PORT_TIEBREAK))
  }
  return { exit, entry }
}

/**
 * Border midpoints (x1/y1, x2/y2) plus outward stub points (sx/sy) for gutter routing.
 * Final path reconnects border → stub → route → stub → border.
 * Optional forced sides keep all edges of a node on one shared exit/entry.
 */
export function choosePorts(
  from: ArchitectureLayoutPoint,
  to: ArchitectureLayoutPoint,
  forced?: { sourcePort?: ArchPortSide; targetPort?: ArchPortSide }
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

  if (forced?.sourcePort) {
    sourcePort = forced.sourcePort
    const border = borderPointOnSide(from, sourcePort)
    x1 = border.x
    y1 = border.y
  }
  if (forced?.targetPort) {
    targetPort = forced.targetPort
    const border = borderPointOnSide(to, targetPort)
    x2 = border.x
    y2 = border.y
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
 * Same-origin out keys lock an egress spine; same-destination in keys lock an
 * ingress spine + long-haul — never cross-poison ends onto the wrong bus.
 */
export function routeOrthogonal(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  blockers: Array<{ x: number; y: number; w: number; h: number }>,
  allNodes: Array<{ x: number; y: number; w: number; h: number }>,
  channelUsage: ChannelUsage,
  membershipKeys: string[],
  busSpine: BusSpinePreference = new Map(),
  busLongHaul: BusLongHaulPreference = new Map()
): OrthogonalRouteResult {
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
    return {
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 }
      ],
      channelKeys: [],
      sharpJoins: false
    }
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
    return {
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 }
      ],
      channelKeys: [],
      sharpJoins: false
    }
  }

  const verticalChannels = collectVerticalChannels(allNodes)
  const horizontalChannels = collectHorizontalChannels(allNodes)
  const preferred = readPreferredBuses(busSpine, busLongHaul, membershipKeys)
  const candidates: Array<{ points: ArchitectureLayoutPoint[]; channelKeys: string[] }> = []

  for (const cx of verticalChannels) {
    const channelKey = `v:${Math.round(cx)}`
    const x = cx + laneToOffset(resolveLane(channelUsage, channelKey, membershipKeys))
    candidates.push({
      channelKeys: [channelKey],
      points: [
        { x: x1, y: y1 },
        { x, y: y1 },
        { x, y: y2 },
        { x: x2, y: y2 }
      ]
    })
  }
  for (const cy of horizontalChannels) {
    const channelKey = `h:${Math.round(cy)}`
    const y = cy + laneToOffset(resolveLane(channelUsage, channelKey, membershipKeys))
    candidates.push({
      channelKeys: [channelKey],
      points: [
        { x: x1, y: y1 },
        { x: x1, y },
        { x: x2, y },
        { x: x2, y: y2 }
      ]
    })
  }

  // Midpoint HVH / VHV (legacy) as low-priority candidates.
  candidates.push({
    channelKeys: [],
    points: [
      { x: x1, y: y1 },
      { x: (x1 + x2) / 2, y: y1 },
      { x: (x1 + x2) / 2, y: y2 },
      { x: x2, y: y2 }
    ]
  })
  candidates.push({
    channelKeys: [],
    points: [
      { x: x1, y: y1 },
      { x: x1, y: (y1 + y2) / 2 },
      { x: x2, y: (y1 + y2) / 2 },
      { x: x2, y: y2 }
    ]
  })

  const bounds = boundsOf(allNodes)
  const topY = bounds.minY - ARCH_ROW_GAP / 2
  const bottomY = bounds.maxY + ARCH_ROW_GAP / 2
  const leftX = bounds.minX - ARCH_COL_GAP / 2
  const rightX = bounds.maxX + ARCH_COL_GAP / 2
  for (const y of [topY, bottomY]) {
    const channelKey = `h-edge:${Math.round(y)}`
    const lane = laneToOffset(resolveLane(channelUsage, channelKey, membershipKeys))
    candidates.push({
      channelKeys: [channelKey],
      points: [
        { x: x1, y: y1 },
        { x: x1, y: y + lane },
        { x: x2, y: y + lane },
        { x: x2, y: y2 }
      ]
    })
  }
  for (const x of [leftX, rightX]) {
    const channelKey = `v-edge:${Math.round(x)}`
    const lane = laneToOffset(resolveLane(channelUsage, channelKey, membershipKeys))
    candidates.push({
      channelKeys: [channelKey],
      points: [
        { x: x1, y: y1 },
        { x: x + lane, y: y1 },
        { x: x + lane, y: y2 },
        { x: x2, y: y2 }
      ]
    })
  }

  if (preferred.egress || preferred.ingress || preferred.longHaul) {
    pushBusSpurCandidates(
      candidates,
      preferred,
      x1,
      y1,
      x2,
      y2,
      verticalChannels,
      horizontalChannels,
      [topY, bottomY],
      [leftX, rightX],
      channelUsage,
      membershipKeys
    )
  }

  let best: { points: ArchitectureLayoutPoint[]; channelKeys: string[] } | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const simplified = simplifyOrthogonal(candidate.points)
    if (!pathClear(simplified, blockers)) continue
    const bends = bendCount(simplified)
    const score =
      pathLength(simplified) +
      bends * BEND_COST +
      Math.max(0, bends - 2) * EXTRA_BEND_COST +
      (candidate.channelKeys.length === 0 ? MIDPOINT_PENALTY : 0) +
      busPreferenceScore(candidate.channelKeys, preferred)
    if (score < bestScore) {
      bestScore = score
      best = { points: simplified, channelKeys: candidate.channelKeys }
    }
  }

  if (best) {
    let channelKeys = best.channelKeys
    let points = best.points
    if (channelKeys.length === 0) {
      channelKeys = deriveTrunkChannelKeys(points, verticalChannels, horizontalChannels)
      const primary = channelKeys[0]
      if (primary) {
        const snapped = forceTrunkOntoChannel(points, primary, channelUsage, membershipKeys)
        if (snapped && pathClear(snapped, blockers)) {
          points = snapped
        }
      }
    }
    commitChannelKeys(channelKeys, channelUsage, membershipKeys)
    commitBusPreference(busSpine, busLongHaul, membershipKeys, channelKeys, points, x1, y1, x2, y2)
    return {
      points,
      channelKeys,
      sharpJoins: channelKeys.length >= 2
    }
  }

  // Last resort: go around the top perimeter (always geometrically valid for card AABBs).
  const escapeKey = `h-edge-escape:${Math.round(topY)}`
  const escapeLane = resolveLane(channelUsage, escapeKey, membershipKeys)
  const escapeY = topY - LANE_SPACING * (1 + escapeLane)
  const fallback = simplifyOrthogonal([
    { x: x1, y: y1 },
    { x: x1, y: escapeY },
    { x: x2, y: escapeY },
    { x: x2, y: y2 }
  ])
  commitChannelKeys([escapeKey], channelUsage, membershipKeys)
  commitBusPreference(busSpine, busLongHaul, membershipKeys, [escapeKey], fallback, x1, y1, x2, y2)
  return { points: fallback, channelKeys: [escapeKey], sharpJoins: false }
}

export function pointsToRoundedPath(
  points: ArchitectureLayoutPoint[],
  options: { sharpJoins?: boolean } = {}
): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`
  }

  const sharpJoins = options.sharpJoins === true
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
    const radius = sharpJoins ? 0 : Math.min(ELBOW_RADIUS, inLen / 2 - 0.5, outLen / 2 - 0.5)
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

function ensureChannel(usage: ChannelUsage, channelKey: string): ChannelLaneState {
  let state = usage.get(channelKey)
  if (!state) {
    state = { keyToLane: new Map(), nextLane: 0 }
    usage.set(channelKey, state)
  }
  return state
}

/** Lane index already claimed by any membership key, or the next free lane (provisional). */
function resolveLane(usage: ChannelUsage, channelKey: string, membershipKeys: string[]): number {
  const state = usage.get(channelKey)
  if (!state) return 0
  for (const key of membershipKeys) {
    const lane = state.keyToLane.get(key)
    if (lane !== undefined) return lane
  }
  return state.nextLane
}

function laneToOffset(lane: number): number {
  if (lane === 0) return 0
  const sign = lane % 2 === 0 ? 1 : -1
  return sign * Math.ceil(lane / 2) * LANE_SPACING
}

/** Bind this edge's out/in keys to one lane per logical channel (reuse when either key hits). */
function commitChannelKeys(
  channelKeys: string[],
  usage: ChannelUsage,
  membershipKeys: string[]
): void {
  for (const channelKey of channelKeys) {
    const state = ensureChannel(usage, channelKey)
    let lane: number | undefined
    for (const key of membershipKeys) {
      const existing = state.keyToLane.get(key)
      if (existing !== undefined) {
        lane = existing
        break
      }
    }
    if (lane === undefined) {
      lane = state.nextLane
      state.nextLane += 1
    }
    for (const key of membershipKeys) {
      state.keyToLane.set(key, lane)
    }
  }
}

function readPreferredBuses(
  busSpine: BusSpinePreference,
  busLongHaul: BusLongHaulPreference,
  membershipKeys: string[]
): PreferredBuses {
  const outKey = membershipKeys.find((key) => key.startsWith('out:'))
  const inKey = membershipKeys.find((key) => key.startsWith('in:'))
  const result: PreferredBuses = {}
  if (outKey) {
    const egress = busSpine.get(outKey)
    if (egress) result.egress = egress
  }
  if (inKey) {
    const ingress = busSpine.get(inKey)
    if (ingress) result.ingress = ingress
  }
  const haul =
    (inKey ? busLongHaul.get(inKey) : undefined) ?? (outKey ? busLongHaul.get(outKey) : undefined)
  if (haul) result.longHaul = haul
  return result
}

function busPreferenceScore(candidateKeys: string[], preferred: PreferredBuses): number {
  const wants = [preferred.egress, preferred.ingress, preferred.longHaul].filter(
    (key): key is string => Boolean(key)
  )
  if (wants.length === 0) return 0

  const uniqueWants = [...new Set(wants)]
  const hits = uniqueWants.filter((key) => candidateKeys.includes(key)).length
  if (hits === 0) return BUS_PREF_PENALTY

  const egress = preferred.egress
  const ingress = preferred.ingress
  if (egress && ingress && egress !== ingress) {
    const hasEgress = candidateKeys.includes(egress)
    const hasIngress = candidateKeys.includes(ingress)
    if (hasEgress && hasIngress) return -BUS_PREF_BONUS
    if (hasEgress || hasIngress) return -BUS_PREF_PARTIAL
    return BUS_PREF_PENALTY
  }

  if (preferred.longHaul && candidateKeys.includes(preferred.longHaul)) {
    return -BUS_PREF_BONUS
  }
  if (hits === uniqueWants.length) return -BUS_PREF_BONUS
  return -BUS_PREF_PARTIAL
}

function channelCoord(
  channelKey: string,
  usage: ChannelUsage,
  membershipKeys: string[]
): number | null {
  const parsed = parseChannelKey(channelKey)
  if (!parsed) return null
  return parsed.value + laneToOffset(resolveLane(usage, channelKey, membershipKeys))
}

function pushSingleSpineSpurs(
  candidates: Array<{ points: ArchitectureLayoutPoint[]; channelKeys: string[] }>,
  spineKey: string,
  role: 'egress' | 'ingress',
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  verticalChannels: number[],
  horizontalChannels: number[],
  edgeYs: number[],
  edgeXs: number[],
  channelUsage: ChannelUsage,
  membershipKeys: string[],
  extraKeys: string[] = []
): void {
  const parsed = parseChannelKey(spineKey)
  const bus = channelCoord(spineKey, channelUsage, membershipKeys)
  if (!parsed || bus === null) return
  const keysFor = (spurKey: string): string[] =>
    role === 'egress' ? [spineKey, spurKey, ...extraKeys] : [spurKey, spineKey, ...extraKeys]

  if (parsed.axis === 'v') {
    for (const cy of horizontalChannels) {
      const spurKey = `h:${Math.round(cy)}`
      const y = cy + laneToOffset(resolveLane(channelUsage, spurKey, membershipKeys))
      candidates.push({
        channelKeys: keysFor(spurKey),
        points: [
          { x: x1, y: y1 },
          { x: bus, y: y1 },
          { x: bus, y },
          { x: x2, y },
          { x: x2, y: y2 }
        ]
      })
    }
    for (const yEdge of edgeYs) {
      const spurKey = `h-edge:${Math.round(yEdge)}`
      const y = yEdge + laneToOffset(resolveLane(channelUsage, spurKey, membershipKeys))
      candidates.push({
        channelKeys: keysFor(spurKey),
        points: [
          { x: x1, y: y1 },
          { x: bus, y: y1 },
          { x: bus, y },
          { x: x2, y },
          { x: x2, y: y2 }
        ]
      })
    }
  } else {
    for (const cx of verticalChannels) {
      const spurKey = `v:${Math.round(cx)}`
      const x = cx + laneToOffset(resolveLane(channelUsage, spurKey, membershipKeys))
      candidates.push({
        channelKeys: keysFor(spurKey),
        points: [
          { x: x1, y: y1 },
          { x: x1, y: bus },
          { x, y: bus },
          { x, y: y2 },
          { x: x2, y: y2 }
        ]
      })
    }
    for (const xEdge of edgeXs) {
      const spurKey = `v-edge:${Math.round(xEdge)}`
      const x = xEdge + laneToOffset(resolveLane(channelUsage, spurKey, membershipKeys))
      candidates.push({
        channelKeys: keysFor(spurKey),
        points: [
          { x: x1, y: y1 },
          { x: x1, y: bus },
          { x, y: bus },
          { x, y: y2 },
          { x: x2, y: y2 }
        ]
      })
    }
  }
}

function pushDualSpineCandidates(
  candidates: Array<{ points: ArchitectureLayoutPoint[]; channelKeys: string[] }>,
  egressKey: string,
  ingressKey: string,
  longHaulKey: string | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  channelUsage: ChannelUsage,
  membershipKeys: string[]
): void {
  const egress = parseChannelKey(egressKey)
  const ingress = parseChannelKey(ingressKey)
  const ex = channelCoord(egressKey, channelUsage, membershipKeys)
  const ix = channelCoord(ingressKey, channelUsage, membershipKeys)
  if (!egress || !ingress || ex === null || ix === null) return

  const channelKeys = longHaulKey ? [egressKey, longHaulKey, ingressKey] : [egressKey, ingressKey]

  if (egress.axis === 'v' && ingress.axis === 'v') {
    const haulY =
      longHaulKey && parseChannelKey(longHaulKey)?.axis === 'h'
        ? channelCoord(longHaulKey, channelUsage, membershipKeys)
        : (y1 + y2) / 2
    if (haulY === null) return
    candidates.push({
      channelKeys,
      points: [
        { x: x1, y: y1 },
        { x: ex, y: y1 },
        { x: ex, y: haulY },
        { x: ix, y: haulY },
        { x: ix, y: y2 },
        { x: x2, y: y2 }
      ]
    })
  } else if (egress.axis === 'v' && ingress.axis === 'h') {
    candidates.push({
      channelKeys,
      points: [
        { x: x1, y: y1 },
        { x: ex, y: y1 },
        { x: ex, y: ix },
        { x: x2, y: ix },
        { x: x2, y: y2 }
      ]
    })
  } else if (egress.axis === 'h' && ingress.axis === 'v') {
    candidates.push({
      channelKeys,
      points: [
        { x: x1, y: y1 },
        { x: x1, y: ex },
        { x: ix, y: ex },
        { x: ix, y: y2 },
        { x: x2, y: y2 }
      ]
    })
  } else if (egress.axis === 'h' && ingress.axis === 'h') {
    const haulX =
      longHaulKey && parseChannelKey(longHaulKey)?.axis === 'v'
        ? channelCoord(longHaulKey, channelUsage, membershipKeys)
        : (x1 + x2) / 2
    if (haulX === null) return
    candidates.push({
      channelKeys,
      points: [
        { x: x1, y: y1 },
        { x: x1, y: ex },
        { x: haulX, y: ex },
        { x: haulX, y: ix },
        { x: x2, y: ix },
        { x: x2, y: y2 }
      ]
    })
  }
}

function pushBusSpurCandidates(
  candidates: Array<{ points: ArchitectureLayoutPoint[]; channelKeys: string[] }>,
  preferred: PreferredBuses,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  verticalChannels: number[],
  horizontalChannels: number[],
  edgeYs: number[],
  edgeXs: number[],
  channelUsage: ChannelUsage,
  membershipKeys: string[]
): void {
  const { egress, ingress, longHaul } = preferred
  if (egress && ingress && egress !== ingress) {
    pushDualSpineCandidates(
      candidates,
      egress,
      ingress,
      longHaul,
      x1,
      y1,
      x2,
      y2,
      channelUsage,
      membershipKeys
    )
  }
  if (egress) {
    pushSingleSpineSpurs(
      candidates,
      egress,
      'egress',
      x1,
      y1,
      x2,
      y2,
      verticalChannels,
      horizontalChannels,
      edgeYs,
      edgeXs,
      channelUsage,
      membershipKeys,
      longHaul && longHaul !== egress ? [longHaul] : []
    )
  }
  if (ingress && ingress !== egress) {
    pushSingleSpineSpurs(
      candidates,
      ingress,
      'ingress',
      x1,
      y1,
      x2,
      y2,
      verticalChannels,
      horizontalChannels,
      edgeYs,
      edgeXs,
      channelUsage,
      membershipKeys,
      longHaul && longHaul !== ingress ? [longHaul] : []
    )
  }
  if (longHaul && longHaul !== egress && longHaul !== ingress) {
    pushSingleSpineSpurs(
      candidates,
      longHaul,
      'ingress',
      x1,
      y1,
      x2,
      y2,
      verticalChannels,
      horizontalChannels,
      edgeYs,
      edgeXs,
      channelUsage,
      membershipKeys
    )
  }
}

function channelNearSource(
  channelKey: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const parsed = parseChannelKey(channelKey)
  if (!parsed) return true
  if (parsed.axis === 'v') return Math.abs(parsed.value - x1) <= Math.abs(parsed.value - x2)
  return Math.abs(parsed.value - y1) <= Math.abs(parsed.value - y2)
}

function channelNearDestination(
  channelKey: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const parsed = parseChannelKey(channelKey)
  if (!parsed) return true
  if (parsed.axis === 'v') return Math.abs(parsed.value - x2) <= Math.abs(parsed.value - x1)
  return Math.abs(parsed.value - y2) <= Math.abs(parsed.value - y1)
}

/** Classify path channels into egress / ingress / longHaul by proximity along the polyline. */
function classifyBusChannels(
  points: ArchitectureLayoutPoint[],
  channelKeys: string[]
): { egress: string | null; ingress: string | null; longHaul: string | null } {
  if (channelKeys.length === 0) return { egress: null, ingress: null, longHaul: null }
  if (channelKeys.length === 1) {
    return { egress: channelKeys[0]!, ingress: channelKeys[0]!, longHaul: channelKeys[0]! }
  }

  let bestLen = 0
  let longHaul: string | null = channelKeys[0] ?? null
  const keyed: Array<{ key: string; midT: number; len: number }> = []

  for (const key of channelKeys) {
    const parsed = parseChannelKey(key)
    if (!parsed) continue
    let totalLen = 0
    let weightedT = 0
    let pathLen = 0
    const prefix: number[] = [0]
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      pathLen += Math.hypot(b.x - a.x, b.y - a.y)
      prefix.push(pathLen)
    }
    if (pathLen < 1) continue
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      const isMatch =
        parsed.axis === 'v'
          ? Math.abs(a.x - b.x) < 1 && Math.abs(a.x - parsed.value) < LANE_SPACING + 1
          : Math.abs(a.y - b.y) < 1 && Math.abs(a.y - parsed.value) < LANE_SPACING + 1
      if (!isMatch) continue
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const mid = (prefix[i]! + prefix[i + 1]!) / 2 / pathLen
      totalLen += len
      weightedT += mid * len
    }
    if (totalLen < 1) {
      // Fall back to channelKeys order when geometry match fails (lane-shifted coords).
      const orderT = channelKeys.indexOf(key) / Math.max(1, channelKeys.length - 1)
      keyed.push({ key, midT: orderT, len: 1 })
      continue
    }
    const midT = weightedT / totalLen
    keyed.push({ key, midT, len: totalLen })
    if (totalLen > bestLen) {
      bestLen = totalLen
      longHaul = key
    }
  }

  if (keyed.length === 0) {
    return {
      egress: channelKeys[0] ?? null,
      ingress: channelKeys[channelKeys.length - 1] ?? null,
      longHaul: channelKeys[0] ?? null
    }
  }

  keyed.sort((a, b) => a.midT - b.midT)
  const egress = keyed[0]!.key
  const ingress = keyed[keyed.length - 1]!.key
  return { egress, ingress, longHaul }
}

function commitBusPreference(
  busSpine: BusSpinePreference,
  busLongHaul: BusLongHaulPreference,
  membershipKeys: string[],
  channelKeys: string[],
  points: ArchitectureLayoutPoint[],
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  if (channelKeys.length === 0) return
  const classified = classifyBusChannels(points, channelKeys)
  const egressCandidate = classified.egress ?? classified.longHaul
  const ingressCandidate = classified.ingress ?? classified.longHaul
  const longHaulCandidate = classified.longHaul ?? classified.egress ?? classified.ingress

  for (const key of membershipKeys) {
    if (key.startsWith('out:')) {
      if (
        egressCandidate &&
        !busSpine.has(key) &&
        channelNearSource(egressCandidate, x1, y1, x2, y2)
      ) {
        busSpine.set(key, egressCandidate)
      }
      if (
        longHaulCandidate &&
        !busLongHaul.has(key) &&
        channelNearSource(longHaulCandidate, x1, y1, x2, y2)
      ) {
        busLongHaul.set(key, longHaulCandidate)
      }
    } else if (key.startsWith('in:')) {
      if (
        ingressCandidate &&
        !busSpine.has(key) &&
        channelNearDestination(ingressCandidate, x1, y1, x2, y2)
      ) {
        busSpine.set(key, ingressCandidate)
      }
      if (
        longHaulCandidate &&
        !busLongHaul.has(key) &&
        channelNearDestination(longHaulCandidate, x1, y1, x2, y2)
      ) {
        busLongHaul.set(key, longHaulCandidate)
      }
    }
  }
}

/** Snap a free midpoint trunk onto the nearest named gutter so buses can lock. */
function deriveTrunkChannelKeys(
  points: ArchitectureLayoutPoint[],
  verticalChannels: number[],
  horizontalChannels: number[]
): string[] {
  let bestVertical: { x: number; len: number } | null = null
  let bestHorizontal: { y: number; len: number } | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (Math.abs(a.x - b.x) < 1) {
      const len = Math.abs(a.y - b.y)
      if (!bestVertical || len > bestVertical.len) bestVertical = { x: a.x, len }
    } else if (Math.abs(a.y - b.y) < 1) {
      const len = Math.abs(a.x - b.x)
      if (!bestHorizontal || len > bestHorizontal.len) bestHorizontal = { y: a.y, len }
    }
  }
  if (bestVertical && bestVertical.len >= (bestHorizontal?.len ?? 0)) {
    const snapped = snapToNearest(bestVertical.x, verticalChannels)
    return snapped === null ? [`v:${Math.round(bestVertical.x)}`] : [`v:${Math.round(snapped)}`]
  }
  if (bestHorizontal) {
    const snapped = snapToNearest(bestHorizontal.y, horizontalChannels)
    return snapped === null ? [`h:${Math.round(bestHorizontal.y)}`] : [`h:${Math.round(snapped)}`]
  }
  return []
}

function forceTrunkOntoChannel(
  points: ArchitectureLayoutPoint[],
  channelKey: string,
  channelUsage: ChannelUsage = new Map(),
  membershipKeys: string[] = []
): ArchitectureLayoutPoint[] | null {
  const parsed = parseChannelKey(channelKey)
  if (!parsed || points.length < 2) return null
  const coord = channelCoord(channelKey, channelUsage, membershipKeys)
  if (coord === null) return null

  let trunkStart = -1
  let trunkLen = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const isVertical = Math.abs(a.x - b.x) < 1
    const isHorizontal = Math.abs(a.y - b.y) < 1
    if (parsed.axis === 'v' && isVertical) {
      const len = Math.abs(a.y - b.y)
      if (len > trunkLen) {
        trunkLen = len
        trunkStart = i
      }
    } else if (parsed.axis === 'h' && isHorizontal) {
      const len = Math.abs(a.x - b.x)
      if (len > trunkLen) {
        trunkLen = len
        trunkStart = i
      }
    }
  }
  if (trunkStart < 0) return null

  const next = points.map((point) => ({ x: point.x, y: point.y }))
  const a = next[trunkStart]!
  const b = next[trunkStart + 1]!
  if (parsed.axis === 'v') {
    a.x = coord
    b.x = coord
    if (trunkStart > 0) {
      const prev = next[trunkStart - 1]!
      if (Math.abs(prev.y - a.y) < 1) {
        // horizontal into trunk — keep prev; a.x already on spine
      } else if (Math.abs(prev.x - a.x) >= 1) {
        prev.y = a.y
      }
    }
    if (trunkStart + 2 < next.length) {
      const after = next[trunkStart + 2]!
      if (Math.abs(after.y - b.y) < 1) {
        // horizontal out of trunk
      } else if (Math.abs(after.x - b.x) >= 1) {
        after.y = b.y
      }
    }
  } else {
    a.y = coord
    b.y = coord
    if (trunkStart > 0) {
      const prev = next[trunkStart - 1]!
      if (Math.abs(prev.x - a.x) < 1) {
        // vertical into trunk
      } else if (Math.abs(prev.y - a.y) >= 1) {
        prev.x = a.x
      }
    }
    if (trunkStart + 2 < next.length) {
      const after = next[trunkStart + 2]!
      if (Math.abs(after.x - b.x) < 1) {
        // vertical out of trunk
      } else if (Math.abs(after.y - b.y) >= 1) {
        after.x = b.x
      }
    }
  }
  return simplifyOrthogonal(next)
}

function parseChannelKey(channelKey: string): { axis: 'v' | 'h'; value: number } | null {
  const match = /^(v|h)(?:-edge(?:-escape)?)?:(-?\d+)$/.exec(channelKey)
  if (!match) return null
  return { axis: match[1] as 'v' | 'h', value: Number(match[2]) }
}

function snapToNearest(value: number, channels: number[]): number | null {
  if (channels.length === 0) return null
  let best = channels[0]!
  let bestDist = Math.abs(best - value)
  for (let i = 1; i < channels.length; i++) {
    const channel = channels[i]!
    const dist = Math.abs(channel - value)
    if (dist < bestDist) {
      best = channel
      bestDist = dist
    }
  }
  return best
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

type LabelBox = { x: number; y: number; w: number; h: number }

function labelBoxAt(cx: number, cy: number, text: string): LabelBox {
  const w = Math.max(LABEL_MIN_WIDTH, text.length * LABEL_CHAR_WIDTH)
  return { x: cx - w / 2, y: cy - LABEL_BOX_HEIGHT / 2, w, h: LABEL_BOX_HEIGHT }
}

function boxesOverlap(a: LabelBox, b: LabelBox, pad = 2): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  )
}

function labelHitsNodes(
  box: LabelBox,
  nodes: ArchitectureLayoutNode[],
  endpointIds: Set<string>
): boolean {
  for (const node of nodes) {
    if (endpointIds.has(node.id)) continue
    const nodeBox: LabelBox = {
      x: node.x - LABEL_NODE_PAD,
      y: node.y - LABEL_NODE_PAD,
      w: ARCH_NODE_WIDTH + LABEL_NODE_PAD * 2,
      h: ARCH_NODE_HEIGHT + LABEL_NODE_PAD * 2
    }
    if (boxesOverlap(box, nodeBox, 0)) return true
  }
  return false
}

function longestLabelSegment(
  points: ArchitectureLayoutPoint[]
): { a: ArchitectureLayoutPoint; b: ArchitectureLayoutPoint } | null {
  let best: { a: ArchitectureLayoutPoint; b: ArchitectureLayoutPoint; len: number } | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= ARCH_PORT_GAP) continue
    if (!best || len > best.len) best = { a, b, len }
  }
  if (best) return { a: best.a, b: best.b }
  if (points.length >= 4) {
    return { a: points[points.length - 3]!, b: points[points.length - 2]! }
  }
  if (points.length >= 2) {
    return { a: points[points.length - 2]!, b: points[points.length - 1]! }
  }
  return null
}

function pointAlongSegment(
  a: ArchitectureLayoutPoint,
  b: ArchitectureLayoutPoint,
  t: number
): ArchitectureLayoutPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function offsetPerpendicular(
  a: ArchitectureLayoutPoint,
  b: ArchitectureLayoutPoint,
  mid: ArchitectureLayoutPoint,
  distance: number,
  flip: boolean
): ArchitectureLayoutPoint {
  const dy = b.y - a.y
  const horizontal = Math.abs(dy) < 1
  const sign = flip ? -1 : 1
  if (horizontal) {
    return { x: mid.x, y: mid.y - sign * distance }
  }
  return { x: mid.x + sign * distance, y: mid.y }
}

/** Place edge labels on long clear segments; nudge to avoid nodes and other labels. */
function placeEdgeLabels(edges: ArchitectureLayoutEdge[], nodes: ArchitectureLayoutNode[]): void {
  const placed: LabelBox[] = []
  for (const edge of edges) {
    if (!edge.label) continue
    const segment = longestLabelSegment(edge.points)
    if (!segment) continue
    const { a, b } = segment
    const endpoints = new Set([edge.from, edge.to])
    const candidates: ArchitectureLayoutPoint[] = []
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      const mid = pointAlongSegment(a, b, t)
      for (const dist of [8, 16]) {
        candidates.push(offsetPerpendicular(a, b, mid, dist, false))
        candidates.push(offsetPerpendicular(a, b, mid, dist, true))
      }
    }

    let chosen = candidates[0] ?? pointAlongSegment(a, b, 0.5)
    for (const candidate of candidates) {
      const box = labelBoxAt(candidate.x, candidate.y, edge.label)
      if (labelHitsNodes(box, nodes, endpoints)) continue
      if (placed.some((other) => boxesOverlap(box, other))) continue
      chosen = candidate
      break
    }
    edge.labelX = chosen.x
    edge.labelY = chosen.y
    placed.push(labelBoxAt(chosen.x, chosen.y, edge.label))
  }
}
