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
  const color = data?.color ?? 'var(--app-markdown-muted)'
  const dashed = data?.dashed === true
  const animate = data?.animate === true && !dashed
  const label = data?.label
  const labelX = data?.labelX
  const labelY = data?.labelY
  const hasLabelAnchor = labelX !== undefined && labelY !== undefined

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
      {label && hasLabelAnchor ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded px-1.5 py-0.5 font-mono text-[10px] leading-none"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              color,
              borderRadius: data?.radius,
              background: data?.canvas,
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
