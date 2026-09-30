export const ARCHITECTURE_KINDS = [
  'client',
  'frontend',
  'ingress',
  'service',
  'data',
  'auth',
  'external',
  'queue'
] as const

export type ArchitectureKind = (typeof ARCHITECTURE_KINDS)[number]

export type ArchitectureEdgeStyle = 'solid' | 'dashed'

export interface ArchitectureNode {
  id: string
  label: string
  subtitle?: string
  kind: ArchitectureKind
  group?: string
}

export interface ArchitectureEdge {
  from: string
  to: string
  label?: string
  style?: ArchitectureEdgeStyle
}

export interface ArchitectureGroup {
  id: string
  label: string
  kind?: ArchitectureKind
}

export interface ArchitectureSpec {
  title?: string
  nodes: ArchitectureNode[]
  edges: ArchitectureEdge[]
  groups?: ArchitectureGroup[]
}

const NODE_MIN = 1
const NODE_MAX = 32
const EDGE_MAX = 48
const GROUP_MAX = 8
const TITLE_MAX = 80
const ID_MAX = 48
const LABEL_MAX = 48
const SUBTITLE_MAX = 64
const EDGE_LABEL_MAX = 40
const GROUP_LABEL_MAX = 64

export const ARCHITECTURE_SPEC_EXAMPLE: ArchitectureSpec = {
  title: 'Sample Web App',
  nodes: [
    { id: 'users', label: 'Users', subtitle: 'Browser / Mobile', kind: 'client' },
    { id: 'cdn', label: 'CloudFront', subtitle: 'CDN', kind: 'ingress', group: 'aws' },
    { id: 'api', label: 'API Server', subtitle: 'FastAPI :8000', kind: 'service', group: 'aws' },
    { id: 'db', label: 'PostgreSQL', kind: 'data', group: 'aws' },
    { id: 'auth', label: 'Auth Provider', subtitle: 'OAuth 2.0', kind: 'auth' }
  ],
  edges: [
    { from: 'users', to: 'cdn', label: 'HTTPS' },
    { from: 'cdn', to: 'api', label: 'TLS' },
    { from: 'api', to: 'db', label: 'SQL' },
    { from: 'users', to: 'auth', label: 'JWT + PKCE', style: 'dashed' },
    { from: 'auth', to: 'api', label: 'verify', style: 'dashed' }
  ],
  groups: [{ id: 'aws', label: 'AWS Region: us-west-2', kind: 'ingress' }]
}

export function formatArchitectureSpecExample(): string {
  return JSON.stringify(ARCHITECTURE_SPEC_EXAMPLE)
}

export function isArchitectureCodeLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'architecture'
}

/** Parse a ```architecture fence body. Returns null when the payload cannot be drawn. */
export function parseArchitectureSpec(source: string): ArchitectureSpec | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  if (!Array.isArray(parsed.nodes)) return null
  if (parsed.nodes.length < NODE_MIN || parsed.nodes.length > NODE_MAX) return null

  const nodes: ArchitectureNode[] = []
  const nodeIds = new Set<string>()
  for (const entry of parsed.nodes) {
    const node = parseNode(entry)
    if (!node) return null
    if (nodeIds.has(node.id)) return null
    nodeIds.add(node.id)
    nodes.push(node)
  }

  if (!Array.isArray(parsed.edges)) return null
  if (parsed.edges.length > EDGE_MAX) return null
  const edges: ArchitectureEdge[] = []
  for (const entry of parsed.edges) {
    const edge = parseEdge(entry, nodeIds)
    if (!edge) return null
    edges.push(edge)
  }

  let groups: ArchitectureGroup[] | undefined
  if (parsed.groups != null) {
    if (!Array.isArray(parsed.groups) || parsed.groups.length > GROUP_MAX) return null
    groups = []
    const groupIds = new Set<string>()
    for (const entry of parsed.groups) {
      const group = parseGroup(entry)
      if (!group) return null
      if (groupIds.has(group.id)) return null
      groupIds.add(group.id)
      groups.push(group)
    }
    for (const node of nodes) {
      if (node.group && !groupIds.has(node.group)) return null
    }
  } else {
    for (const node of nodes) {
      if (node.group) return null
    }
  }

  const title = readOptionalText(parsed.title, TITLE_MAX)
  if (title === undefined) return null

  return {
    ...(title ? { title } : {}),
    nodes,
    edges,
    ...(groups && groups.length > 0 ? { groups } : {})
  }
}

function parseNode(entry: unknown): ArchitectureNode | null {
  if (!isRecord(entry)) return null
  const id = readRequiredId(entry.id)
  if (!id) return null
  if (typeof entry.label !== 'string') return null
  const label = entry.label.trim()
  if (!label || label.length > LABEL_MAX) return null
  if (!isArchitectureKind(entry.kind)) return null
  const subtitle = readOptionalText(entry.subtitle, SUBTITLE_MAX)
  if (subtitle === undefined) return null
  const group = readOptionalText(entry.group, ID_MAX)
  if (group === undefined) return null
  return {
    id,
    label,
    kind: entry.kind,
    ...(subtitle ? { subtitle } : {}),
    ...(group ? { group } : {})
  }
}

function parseEdge(entry: unknown, nodeIds: Set<string>): ArchitectureEdge | null {
  if (!isRecord(entry)) return null
  const from = readRequiredId(entry.from)
  const to = readRequiredId(entry.to)
  if (!from || !to) return null
  if (!nodeIds.has(from) || !nodeIds.has(to)) return null
  if (from === to) return null
  const label = readOptionalText(entry.label, EDGE_LABEL_MAX)
  if (label === undefined) return null
  let style: ArchitectureEdgeStyle | undefined
  if (entry.style != null) {
    if (entry.style !== 'solid' && entry.style !== 'dashed') return null
    style = entry.style
  }
  return {
    from,
    to,
    ...(label ? { label } : {}),
    ...(style && style !== 'solid' ? { style } : {})
  }
}

function parseGroup(entry: unknown): ArchitectureGroup | null {
  if (!isRecord(entry)) return null
  const id = readRequiredId(entry.id)
  if (!id) return null
  if (typeof entry.label !== 'string') return null
  const label = entry.label.trim()
  if (!label || label.length > GROUP_LABEL_MAX) return null
  if (entry.kind != null && !isArchitectureKind(entry.kind)) return null
  return {
    id,
    label,
    ...(entry.kind ? { kind: entry.kind } : {})
  }
}

function readRequiredId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!id || id.length > ID_MAX) return null
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return null
  return id
}

/** Missing or blank optional text is omitted. A wrong type or over-long value fails the spec. */
function readOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value == null) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return null
  if (text.length > maxLength) return undefined
  return text
}

function isArchitectureKind(value: unknown): value is ArchitectureKind {
  return typeof value === 'string' && (ARCHITECTURE_KINDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
