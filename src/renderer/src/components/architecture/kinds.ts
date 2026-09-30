import {
  CloudIcon,
  DatabaseIcon,
  GlobeIcon,
  LayersIcon,
  MonitorIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon,
  type LucideIcon
} from 'lucide-react'

import type { ArchitectureKind } from '../../../../shared/architecture-spec'
import {
  ARCHITECTURE_KIND_ORDER,
  ARCHITECTURE_KIND_TONE,
  ARCH_COL_GAP,
  ARCH_GROUP_PAD_X,
  ARCH_GROUP_PAD_Y,
  ARCH_NODE_HEIGHT,
  ARCH_NODE_WIDTH,
  ARCH_ROW_GAP,
  type ArchitectureKindTone
} from '../../../../shared/architecture-theme'

export type DiagramKindTone = ArchitectureKindTone

export {
  ARCHITECTURE_KIND_ORDER,
  ARCHITECTURE_KIND_TONE,
  ARCH_COL_GAP,
  ARCH_GROUP_PAD_X,
  ARCH_GROUP_PAD_Y,
  ARCH_NODE_HEIGHT,
  ARCH_NODE_WIDTH,
  ARCH_ROW_GAP
}

export const ARCHITECTURE_KIND_ICON: Record<ArchitectureKind, LucideIcon> = {
  client: UserIcon,
  frontend: MonitorIcon,
  ingress: CloudIcon,
  service: ServerIcon,
  data: DatabaseIcon,
  auth: ShieldIcon,
  external: GlobeIcon,
  queue: LayersIcon
}
