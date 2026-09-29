import type { ArchitectureKind } from './architecture-spec'

export type ArchitectureKindTone = {
  fill: string
  border: string
  glow: string
}

export const ARCHITECTURE_CANVAS = '#0b0e14'
export const ARCHITECTURE_GRID = 'rgba(148,163,184,0.07)'
export const ARCHITECTURE_TEXT = '#eef2f7'

export const ARCHITECTURE_KIND_TONE: Record<ArchitectureKind, ArchitectureKindTone> = {
  client: { fill: 'rgba(148,163,184,0.12)', border: '#94a3b8', glow: 'rgba(148,163,184,0.28)' },
  frontend: { fill: 'rgba(56,189,248,0.12)', border: '#38bdf8', glow: 'rgba(56,189,248,0.32)' },
  ingress: { fill: 'rgba(245,158,11,0.12)', border: '#f59e0b', glow: 'rgba(245,158,11,0.32)' },
  service: { fill: 'rgba(52,211,153,0.12)', border: '#34d399', glow: 'rgba(52,211,153,0.32)' },
  data: { fill: 'rgba(167,139,250,0.12)', border: '#a78bfa', glow: 'rgba(167,139,250,0.32)' },
  auth: { fill: 'rgba(244,114,182,0.12)', border: '#f472b6', glow: 'rgba(244,114,182,0.32)' },
  external: {
    fill: 'rgba(148,163,184,0.10)',
    border: '#64748b',
    glow: 'rgba(100,116,139,0.28)'
  },
  queue: { fill: 'rgba(217,119,6,0.12)', border: '#d97706', glow: 'rgba(217,119,6,0.32)' }
}

export const ARCHITECTURE_KIND_ORDER: ArchitectureKind[] = [
  'client',
  'frontend',
  'ingress',
  'service',
  'data',
  'auth',
  'external',
  'queue'
]

export const ARCH_NODE_WIDTH = 172
export const ARCH_NODE_HEIGHT = 68
export const ARCH_GROUP_PAD_X = 28
export const ARCH_GROUP_PAD_Y = 40
export const ARCH_COL_GAP = 88
export const ARCH_ROW_GAP = 40
/** Outward stub from node border midpoints before the routed edge continues. */
export const ARCH_PORT_GAP = 24
