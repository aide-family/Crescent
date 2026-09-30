import { MarkerType, type Edge, type Node } from '@xyflow/react'

import {
  layoutArchitecture,
  type ArchPortSide,
  type ArchitectureLayoutEdge
} from '../../../../shared/architecture-layout'
import type { ArchitectureKind, ArchitectureSpec } from '../../../../shared/architecture-spec'
import { ARCH_NODE_HEIGHT, ARCH_NODE_WIDTH } from './kinds'

export type ArchNodeData = {
  label: string
  subtitle?: string
  kind: ArchitectureKind
}

export type ArchGroupData = {
  label: string
  kind?: ArchitectureKind
}

export type ArchEdgeData = {
  color: string
  dashed: boolean
  animate: boolean
  label?: string
  /** Precomputed orthogonal path in flow absolute coordinates (avoids node cards). */
  path: string
  points: Array<{ x: number; y: number }>
}

export type ArchitectureFlowGraph = {
  nodes: Node[]
  edges: Edge[]
}

const PORT_TO_HANDLE: Record<ArchPortSide, string> = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom'
}

/** Layer nodes left-to-right from shared layout; wrap group members in parent frames. */
export function buildArchitectureFlowGraph(spec: ArchitectureSpec): ArchitectureFlowGraph {
  const layout = layoutArchitecture(spec, { titleOffset: 0 })
  const groupById = new Map(layout.groups.map((group) => [group.id, group] as const))

  const nodes: Node[] = []

  for (const group of layout.groups) {
    nodes.push({
      id: `group:${group.id}`,
      type: 'archGroup',
      position: { x: group.x, y: group.y },
      data: { label: group.label, kind: group.kind } satisfies ArchGroupData,
      style: { width: group.width, height: group.height },
      selectable: false,
      draggable: false,
      zIndex: 0
    })
  }

  for (const node of layout.nodes) {
    const parentGroup = node.group ? groupById.get(node.group) : undefined
    const position = parentGroup
      ? { x: node.x - parentGroup.x, y: node.y - parentGroup.y }
      : { x: node.x, y: node.y }
    nodes.push({
      id: node.id,
      type: 'archNode',
      position,
      parentId: node.group ? `group:${node.group}` : undefined,
      extent: node.group ? 'parent' : undefined,
      data: {
        label: node.label,
        ...(node.subtitle ? { subtitle: node.subtitle } : {}),
        kind: node.kind
      } satisfies ArchNodeData,
      draggable: false,
      zIndex: 1,
      style: { width: ARCH_NODE_WIDTH, height: ARCH_NODE_HEIGHT }
    })
  }

  const edges: Edge[] = layout.edges.map((edge) => toFlowEdge(edge))

  return { nodes, edges }
}

function toFlowEdge(edge: ArchitectureLayoutEdge): Edge {
  return {
    id: `e-${edge.from}-${edge.to}-${edge.index}`,
    source: edge.from,
    target: edge.to,
    sourceHandle: PORT_TO_HANDLE[edge.sourcePort],
    targetHandle: PORT_TO_HANDLE[edge.targetPort],
    type: 'archEdge',
    label: edge.label,
    data: {
      color: edge.color,
      dashed: edge.dashed,
      animate: !edge.dashed,
      ...(edge.label ? { label: edge.label } : {}),
      path: edge.d,
      points: edge.points
    } satisfies ArchEdgeData,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.color,
      width: 18,
      height: 18
    }
  }
}
