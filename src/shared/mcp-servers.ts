import type { AgentMcpServerConfig, AgentMcpTransport } from './agent-types'
import { normalizeToolNameList } from './tool-policy'

export type McpServersJsonErrorCode =
  | 'empty'
  | 'invalid'
  | 'missing-servers'
  | 'need-url-or-command'

export type ParseMcpServersResult =
  | { ok: true; servers: AgentMcpServerConfig[] }
  | { ok: false; error: McpServersJsonErrorCode }

export type ParseCursorServerEntryResult =
  | { ok: true; patch: CursorServerPatch }
  | { ok: false; error: McpServersJsonErrorCode }

export interface CursorServerPatch {
  transport: AgentMcpTransport
  command: string
  args: string[]
  env: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export function sanitizeMcpServerId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isMcpServerComplete(server: AgentMcpServerConfig): boolean {
  if (server.transport === 'http') return Boolean(server.url?.trim())
  return Boolean(server.command.trim())
}

export function summarizeMcpServerEndpoint(server: AgentMcpServerConfig): string {
  if (server.transport === 'http') return redactMcpUrl(server.url?.trim() ?? '') || '-'
  return [server.command, ...server.args].filter(Boolean).join(' ') || '-'
}

export function redactMcpUrl(url: string): string {
  if (!url) return url
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|password|auth/i.test(key)) {
        parsed.searchParams.set(key, '***')
      }
    }
    return parsed.toString()
  } catch {
    return url.replace(/([?&](?:key|token|secret|password|auth)[^=]*=)[^&]*/gi, '$1***')
  }
}

export function parseMcpServersJson(text: string): ParseMcpServersResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'invalid' }
  }

  const map = extractMcpServersMap(parsed)
  if (!map) {
    return { ok: false, error: 'missing-servers' }
  }

  const servers: AgentMcpServerConfig[] = []
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(map)) {
    const server = normalizeMcpServer({ ...(isRecord(value) ? value : {}), id: key, name: key })
    if (!server || seen.has(server.id)) continue
    seen.add(server.id)
    servers.push(server)
  }

  if (servers.length === 0) {
    return { ok: false, error: 'missing-servers' }
  }

  return { ok: true, servers }
}

export function parseCursorServerEntry(text: string): ParseCursorServerEntryResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'invalid' }
  }

  const record = unwrapSingleCursorEntry(parsed)
  if (!record) {
    return { ok: false, error: 'need-url-or-command' }
  }

  const patch = cursorPatchFromRecord(record)
  if (!patch) {
    return { ok: false, error: 'need-url-or-command' }
  }
  return { ok: true, patch }
}

export function applyCursorServerPatch(
  server: AgentMcpServerConfig,
  patch: CursorServerPatch
): AgentMcpServerConfig {
  return {
    ...server,
    transport: patch.transport,
    command: patch.command,
    args: patch.args,
    env: patch.env,
    ...(patch.url ? { url: patch.url } : { url: undefined }),
    ...(patch.headers && Object.keys(patch.headers).length
      ? { headers: patch.headers }
      : { headers: undefined })
  }
}

export function mergeMcpServers(
  existing: AgentMcpServerConfig[],
  incoming: AgentMcpServerConfig[]
): AgentMcpServerConfig[] {
  const byId = new Map(existing.map((server) => [server.id, server]))
  const order = existing.map((server) => server.id)

  for (const next of incoming) {
    const prev = byId.get(next.id)
    if (prev) {
      byId.set(next.id, {
        ...next,
        enabled: prev.enabled,
        toolAllowList: next.toolAllowList ?? prev.toolAllowList,
        toolDenyList: next.toolDenyList ?? prev.toolDenyList
      })
    } else {
      byId.set(next.id, next)
      order.push(next.id)
    }
  }

  return order
    .map((id) => byId.get(id))
    .filter((server): server is AgentMcpServerConfig => Boolean(server))
}

export function deleteMcpServer(
  servers: AgentMcpServerConfig[],
  id: string
): AgentMcpServerConfig[] {
  return servers.filter((server) => server.id !== id)
}

export function toCursorServerEntry(server: AgentMcpServerConfig): Record<string, unknown> {
  if (server.transport === 'http') {
    const entry: Record<string, unknown> = { url: server.url ?? '' }
    if (server.headers && Object.keys(server.headers).length) {
      entry.headers = server.headers
    }
    return entry
  }

  const entry: Record<string, unknown> = { command: server.command }
  if (server.args.length) entry.args = server.args
  if (Object.keys(server.env).length) entry.env = server.env
  return entry
}

export function toCursorMcpServersJson(servers: AgentMcpServerConfig[], space = 2): string {
  const mcpServers: Record<string, unknown> = {}
  for (const server of servers) {
    mcpServers[server.name || server.id] = toCursorServerEntry(server)
  }
  return JSON.stringify({ mcpServers }, null, space)
}

export function normalizeMcpServers(value: unknown): AgentMcpServerConfig[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const servers: AgentMcpServerConfig[] = []
  for (const item of value) {
    const server = normalizeMcpServer(item)
    if (!server || seen.has(server.id)) continue
    seen.add(server.id)
    servers.push(server)
  }
  return servers
}

export function normalizeMcpServer(value: unknown): AgentMcpServerConfig | undefined {
  const record = isRecord(value) ? value : {}
  const rawName = String(record.name || record.id || '').trim()
  const id = sanitizeMcpServerId(String(record.id || rawName || '').trim())
  if (!id) return undefined

  const url = String(record.url ?? '').trim()
  const command = String(record.command ?? '').trim()
  const transport: AgentMcpTransport = record.transport === 'http' || url ? 'http' : 'stdio'
  const headers = normalizeStringMap(record.headers)

  return {
    id,
    name: rawName || id,
    transport,
    command,
    args: normalizeStringList(record.args),
    env: normalizeStringMap(record.env),
    ...(url ? { url } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    enabled: record.enabled !== false,
    ...(normalizeToolNameList(record.toolAllowList).length
      ? { toolAllowList: normalizeToolNameList(record.toolAllowList) }
      : {}),
    ...(normalizeToolNameList(record.toolDenyList).length
      ? { toolDenyList: normalizeToolNameList(record.toolDenyList) }
      : {})
  }
}

export function hostedMcpToolFingerprint(servers: AgentMcpServerConfig[]): string {
  const payload = servers
    .filter((server) => server.enabled)
    .map((server) => ({
      id: server.id,
      transport: server.transport,
      url: server.url ?? '',
      headers: server.headers ?? {},
      command: server.command,
      args: server.args,
      env: server.env,
      allow: server.toolAllowList ?? [],
      deny: server.toolDenyList ?? []
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return stableHash(JSON.stringify(payload))
}

function extractMcpServersMap(parsed: unknown): Record<string, unknown> | undefined {
  if (!isRecord(parsed)) return undefined
  if (isRecord(parsed.mcpServers)) return parsed.mcpServers

  const values = Object.values(parsed)
  if (
    values.length > 0 &&
    values.every((value) => isRecord(value) && (hasText(value.url) || hasText(value.command)))
  ) {
    return parsed
  }
  return undefined
}

function unwrapSingleCursorEntry(parsed: unknown): Record<string, unknown> | undefined {
  if (!isRecord(parsed)) return undefined
  if (isRecord(parsed.mcpServers)) {
    const entries = Object.values(parsed.mcpServers)
    if (entries.length === 1 && isRecord(entries[0])) return entries[0]
    return undefined
  }
  return parsed
}

function cursorPatchFromRecord(record: Record<string, unknown>): CursorServerPatch | undefined {
  const url = String(record.url ?? '').trim()
  const command = String(record.command ?? '').trim()
  if (!url && !command) return undefined
  const headers = normalizeStringMap(record.headers)
  return {
    transport: url ? 'http' : 'stdio',
    command,
    args: normalizeStringList(record.args),
    env: normalizeStringMap(record.env),
    ...(url ? { url } : {}),
    ...(Object.keys(headers).length ? { headers } : {})
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, mapValue]) => [key.trim(), String(mapValue ?? '')] as const)
      .filter(([key]) => Boolean(key))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function stableHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(16)
}
