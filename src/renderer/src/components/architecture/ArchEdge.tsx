import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react'

import type { ArchEdgeData } from './layout'

function ArchEdgeComponent({
  id,
  markerEnd,
  data,
  style
}: EdgeProps<Edge<ArchEdgeData>>): React.JSX.Element {
  const path = data?.path ?? ''
  const color = data?.color ?? '#8fa7b8'
  const dashed = data?.dashed === true
  const animate = data?.animate === true && !dashed
  const label = data?.label
  const points = data?.points ?? []
  const mid = points.length >= 2 ? points[Math.floor(points.length / 2)]! : null
  const labelX = mid?.x ?? 0
  const labelY = mid?.y ?? 0

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={animate ? 'app-arch-edge-flow' : undefined}
        style={{
          ...style,
          stroke: color,
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          ...(dashed ? { strokeDasharray: '6 6' } : {})
        }}
      />
      {label && mid ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded px-1.5 py-0.5 font-mono text-[10px] leading-none"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              color,
              background: 'rgba(11,14,20,0.88)',
              border: `1px solid ${color}55`
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const ArchEdge = memo(ArchEdgeComponent)
