import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

import {
  ARCHITECTURE_KIND_ICON,
  ARCHITECTURE_KIND_TONE,
  ARCH_NODE_HEIGHT,
  ARCH_NODE_WIDTH
} from './kinds'
import type { ArchNodeData } from './layout'

const handleClass = '!size-1.5 !border-0 !bg-transparent'

function ArchNodeComponent({ data }: NodeProps<Node<ArchNodeData>>): React.JSX.Element {
  const tone = ARCHITECTURE_KIND_TONE[data.kind]
  const Icon = ARCHITECTURE_KIND_ICON[data.kind]

  return (
    <div
      className="app-arch-node flex flex-col justify-center gap-0.5 rounded-[10px] border px-3 py-2"
      style={{
        width: ARCH_NODE_WIDTH,
        height: ARCH_NODE_HEIGHT,
        background: tone.fill,
        borderColor: tone.border,
        boxShadow: `0 0 0 1px ${tone.glow}, 0 0 18px ${tone.glow}`
      }}
    >
      <Handle
        key="target-left"
        id="left"
        type="target"
        position={Position.Left}
        className={handleClass}
      />
      <Handle
        key="source-left"
        id="left"
        type="source"
        position={Position.Left}
        className={handleClass}
      />
      <Handle
        key="target-right"
        id="right"
        type="target"
        position={Position.Right}
        className={handleClass}
      />
      <Handle
        key="source-right"
        id="right"
        type="source"
        position={Position.Right}
        className={handleClass}
      />
      <Handle
        key="target-top"
        id="top"
        type="target"
        position={Position.Top}
        className={handleClass}
      />
      <Handle
        key="source-top"
        id="top"
        type="source"
        position={Position.Top}
        className={handleClass}
      />
      <Handle
        key="target-bottom"
        id="bottom"
        type="target"
        position={Position.Bottom}
        className={handleClass}
      />
      <Handle
        key="source-bottom"
        id="bottom"
        type="source"
        position={Position.Bottom}
        className={handleClass}
      />
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0" style={{ color: tone.border }} aria-hidden="true" />
        <span className="min-w-0 truncate text-[12px] font-semibold tracking-tight text-[#eef2f7]">
          {data.label}
        </span>
      </div>
      {data.subtitle ? (
        <span
          className="truncate pl-5 font-mono text-[10px] leading-tight"
          style={{ color: tone.border }}
        >
          {data.subtitle}
        </span>
      ) : null}
    </div>
  )
}

export const ArchNode = memo(ArchNodeComponent)
