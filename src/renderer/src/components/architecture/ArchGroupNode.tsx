import { APP_THEMES } from '@renderer/lib/theme-definitions'
import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'

import type { ArchGroupData } from './layout'

function ArchGroupNodeComponent({ data }: NodeProps<Node<ArchGroupData>>): React.JSX.Element {
  const theme = APP_THEMES[data.themeId]
  const tone = theme.diagram.kinds[data.kind ?? 'ingress']

  return (
    <div
      className="app-arch-group box-border size-full rounded-xl border border-dashed"
      style={{
        borderRadius: theme.geometry.radius,
        background: theme.diagram.cluster,
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
