import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'

import { ARCHITECTURE_KIND_TONE } from './kinds'
import type { ArchGroupData } from './layout'

function ArchGroupNodeComponent({ data }: NodeProps<Node<ArchGroupData>>): React.JSX.Element {
  const tone = ARCHITECTURE_KIND_TONE[data.kind ?? 'ingress']

  return (
    <div
      className="app-arch-group box-border size-full rounded-xl border border-dashed"
      style={{
        background: 'rgba(18,22,31,0.45)',
        borderColor: tone.border
      }}
    >
      <div
        className="px-3 pt-2 font-mono text-[11px] font-medium tracking-wide"
        style={{ color: tone.border }}
      >
        {data.label}
      </div>
    </div>
  )
}

export const ArchGroupNode = memo(ArchGroupNodeComponent)
