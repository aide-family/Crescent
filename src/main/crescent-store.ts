import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'

import {
  appendOperationRecordToDb,
  readCommandWhitelistFromDb,
  readCrescentDbFlag,
  readCrescentMemoryFromDb,
  writeCommandWhitelistToDb,
  writeCrescentDbFlag,
  writeCrescentMemoryToDb
} from './crescent-sqlite'
import {
  CRESCENT_USER_SKILLS_TILDE,
  GLOBAL_AGENT_SKILLS_TILDE,
  getCrescentConfigPath,
  getCrescentMemoryPath
} from './crescent-paths'
import {
  normalizeOpenApiProfiles,
  projectOpenApiProfileFields,
  resolveActiveOpenApiProfile
} from '../shared/openapi-profiles'
import { selectEnabledAgentProvider } from '../shared/agent-providers'
import { normalizeMcpServers } from '../shared/mcp-servers'
import { DEFAULT_AGENT_STYLE, normalizeAgentStyle } from '../shared/agent-style'
import { normalizeSystemLogLevel } from '../shared/log-levels'
import { validateClusterHostRegex } from '../shared/connection-state'
import type {
  AgentConfig,
  AgentLongTermMemory,
  AgentMemoryRecord,
  AgentProviderConfig,
  AgentProviderModelConfig,
  ConnectionConfig,
  ConnectionInput,
  OperationRecord
} from './agent/types'
import { DEFAULT_WHALE_MONITOR_CONFIG, type WhaleMonitorConfig } from '../shared/whale-monitor'
import {
  normalizeConnectionListMeta,
  reorderInMeta,
  toggleFavoriteInMeta,
  type ConnectionListMeta,
  type ConnectionReorderAction
} from '../shared/connection-list'

export {
  getCrescentDir,
  getCrescentConfigPath,
  getCrescentMemoryPath,
  getCrescentWikiDir
} from './crescent-paths'

export interface CrescentConfigFile {
  agent: AgentConfig
  connections: ConnectionConfig[]
  /** Local Markdown directory used by the Crescent knowledge base. */
  wikiDirectory?: string
  whaleMonitor?: WhaleMonitorConfig & { apiKey?: string }
  /** Soft default for connection routing after a successful SSH login. */
  lastUsedConnectionId?: string
  /** Favorite + manual order for custom and ssh-config hosts (ids only). */
  connectionList?: ConnectionListMeta
}

export interface CrescentMemoryFile {
  shortTerm: AgentMemoryRecord[]
  longTerm: AgentLongTermMemory
}

export const defaultCommandWhitelist: string[] = []

export const defaultAgentConfig: AgentConfig = {
  providers: [],
  providerId: undefined,
  model: '',
  workspaceCwd: undefined,
  agentStyle: DEFAULT_AGENT_STYLE,
  showAgentThinking: undefined,
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: defaultCommandWhitelist,
  openApiProfiles: [],
  openApiProfileId: undefined,
  openApiBaseUrl: '',
  openApiDocument: '',
  openApiTimeoutMs: 30_000,
  openApiMaxRetries: 2,
  openApiRetryBackoffMs: 300,
  skillRoot: CRESCENT_USER_SKILLS_TILDE,
  loadGlobalAgentSkills: false,
  mcpServers: [],
  logLevel: 'info'
}

export const defaultMemoryFile: CrescentMemoryFile = {
  shortTerm: [],
  longTerm: {
    preferences: [],
    notes: [],
    operations: []
  }
}

/**
 * Secrets are encrypted at rest with Electron safeStorage (OS keychain / DPAPI)
 * before hitting `config.json`. Legacy plaintext values are transparently read
 * back and re-encrypted on the next write.
 */
const SECRET_ENCRYPTED_PREFIX = 'crescent-enc:v1:'

function encryptSecret(value: string | undefined): string | undefined {
  if (!value || value.startsWith(SECRET_ENCRYPTED_PREFIX)) return value
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return SECRET_ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch {
    // safeStorage not ready / unavailable: fall back to legacy plaintext so
    // connections keep working in headless or keyring-less environments.
  }
  return value
}

function decryptSecret(value: string | undefined): string | undefined {
  if (!value || !value.startsWith(SECRET_ENCRYPTED_PREFIX)) return value
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined
    return safeStorage.decryptString(
      Buffer.from(value.slice(SECRET_ENCRYPTED_PREFIX.length), 'base64')
    )
  } catch {
    console.warn('[crescent-store] failed to decrypt a stored secret; the value will be dropped.')
    return undefined
  }
}

function mapSecretRecord(
  record: Record<string, string>,
  transform: (value: string | undefined) => string | undefined
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    next[key] = transform(value) ?? ''
  }
  return next
}

function encryptConfigFileSecrets(config: CrescentConfigFile): CrescentConfigFile {
  return {
    ...config,
    ...(config.whaleMonitor
      ? {
          whaleMonitor: {
            ...config.whaleMonitor,
            apiKey: encryptSecret(config.whaleMonitor.apiKey)
          }
        }
      : {}),
    agent: {
      ...config.agent,
      providers: (config.agent.providers ?? []).map((provider) => ({
        ...provider,
        apiKey: encryptSecret(provider.apiKey) ?? ''
      })),
      mcpServers: (config.agent.mcpServers ?? []).map((server) => ({
        ...server,
        env: mapSecretRecord(server.env, encryptSecret),
        ...(server.headers ? { headers: mapSecretRecord(server.headers, encryptSecret) } : {})
      }))
    },
    connections: config.connections.map((connection) => ({
      ...connection,
      password: encryptSecret(connection.password),
      rootPassword: encryptSecret(connection.rootPassword)
    }))
  }
}

function decryptConfigFileSecrets(config: CrescentConfigFile): CrescentConfigFile {
  return {
    ...config,
    ...(config.whaleMonitor
      ? {
          whaleMonitor: {
            ...config.whaleMonitor,
            apiKey: decryptSecret(config.whaleMonitor.apiKey)
          }
        }
      : {}),
    agent: {
      ...config.agent,
      providers: (config.agent.providers ?? []).map((provider) => ({
        ...provider,
        apiKey: decryptSecret(provider.apiKey) ?? ''
      })),
      mcpServers: (config.agent.mcpServers ?? []).map((server) => ({
        ...server,
        env: mapSecretRecord(server.env, decryptSecret),
        ...(server.headers ? { headers: mapSecretRecord(server.headers, decryptSecret) } : {})
      }))
    },
    connections: config.connections.map((connection) => ({
      ...connection,
      password: decryptSecret(connection.password),
      rootPassword: decryptSecret(connection.rootPassword)
    }))
  }
}

export function readCrescentConfig(): CrescentConfigFile {
  return decryptConfigFileSecrets(normalizeConfigFile(readJsonFile(getCrescentConfigPath(), {})))
}

export function writeCrescentConfig(config: CrescentConfigFile): CrescentConfigFile {
  const normalized = normalizeConfigFile(config)
  writeJsonFile(getCrescentConfigPath(), encryptConfigFileSecrets(stripDbBackedConfig(normalized)))

  return normalized
}

export function readWhaleMonitorConfig(): WhaleMonitorConfig & { apiKey?: string } {
  return readCrescentConfig().whaleMonitor ?? { ...DEFAULT_WHALE_MONITOR_CONFIG }
}

export function writeWhaleMonitorConfig(
  input: Partial<WhaleMonitorConfig> & { apiKey?: string; clearApiKey?: boolean }
): WhaleMonitorConfig & { apiKey?: string } {
  const current = readWhaleMonitorConfig()
  const apiKey = input.clearApiKey ? undefined : input.apiKey?.trim() || current.apiKey
  const next = normalizeWhaleMonitorConfig({ ...current, ...input, apiKey })
  writeCrescentConfig({ ...readCrescentConfig(), whaleMonitor: next })
  return next
}

export function readWikiDirectory(): string | undefined {
  return readCrescentConfig().wikiDirectory
}

export function writeWikiDirectory(directory: string | undefined): void {
  const config = readCrescentConfig()
  writeCrescentConfig({ ...config, wikiDirectory: normalizeWikiDirectory(directory) })
}

export function readAgentConfig(): AgentConfig {
  const config = readCrescentConfig()
  const legacyWhitelist = config.agent.commandWhitelist

  migrateCommandWhitelistIfNeeded(legacyWhitelist ?? [])

  return {
    ...config.agent,
    commandWhitelist: readCommandWhitelistFromDb()
  }
}

export function writeAgentConfig(config: AgentConfig): AgentConfig {
  const current = readCrescentConfig()
  const normalized = normalizeAgentConfig(config)
  const commandWhitelist = writeCommandWhitelistToDb(normalized.commandWhitelist ?? [])

  writeCrescentDbFlag('command_whitelist_migrated', true)
  const next = writeCrescentConfig({
    ...current,
    agent: {
      ...normalized,
      commandWhitelist: []
    }
  })

  return {
    ...next.agent,
    commandWhitelist
  }
}

export function readCustomConnections(): ConnectionConfig[] {
  return readCrescentConfig().connections
}

export function upsertCustomConnection(input: ConnectionInput): ConnectionConfig {
  const current = readCrescentConfig()
  const id = input.id?.trim() || `custom-${randomUUID()}`
  const connection = normalizeConnection({ ...input, id, source: 'custom' })
  const connections = [
    ...current.connections.filter((candidate) => candidate.id !== id),
    connection
  ].sort((left, right) => left.name.localeCompare(right.name))
  const meta = current.connectionList ?? { favoriteIds: [], orderIds: [] }
  const alreadyPlaced = meta.favoriteIds.includes(id) || meta.orderIds.includes(id)
  const connectionList = alreadyPlaced
    ? meta
    : {
        favoriteIds: meta.favoriteIds,
        orderIds: [...meta.orderIds.filter((entry) => entry !== id), id]
      }

  writeCrescentConfig({ ...current, connections, connectionList })
  return connection
}

export function deleteCustomConnection(id: string): void {
  const current = readCrescentConfig()
  const meta = current.connectionList ?? { favoriteIds: [], orderIds: [] }
  writeCrescentConfig({
    ...current,
    connections: current.connections.filter((connection) => connection.id !== id),
    lastUsedConnectionId:
      current.lastUsedConnectionId === id ? undefined : current.lastUsedConnectionId,
    connectionList: {
      favoriteIds: meta.favoriteIds.filter((entry) => entry !== id),
      orderIds: meta.orderIds.filter((entry) => entry !== id)
    }
  })
}

export function readConnectionListMeta(): ConnectionListMeta {
  return normalizeConnectionListMeta(readCrescentConfig().connectionList)
}

export function writeConnectionListMeta(meta: ConnectionListMeta): ConnectionListMeta {
  const current = readCrescentConfig()
  const next = normalizeConnectionListMeta(meta)
  writeCrescentConfig({
    ...current,
    connectionList: next
  })
  return next
}

/** Toggle favorite for a connection id; returns updated meta. */
export function toggleConnectionFavorite(
  connectionId: string,
  knownIds: Iterable<string>
): ConnectionListMeta {
  const current = readCrescentConfig()
  const next = toggleFavoriteInMeta(
    current.connectionList ?? { favoriteIds: [], orderIds: [] },
    connectionId,
    knownIds
  )
  writeCrescentConfig({ ...current, connectionList: next })
  return next
}

/** Reorder within favorites or non-favorites; returns updated meta. */
export function reorderConnection(
  connectionId: string,
  action: ConnectionReorderAction,
  knownIds: Iterable<string>
): ConnectionListMeta {
  const current = readCrescentConfig()
  const next = reorderInMeta(
    current.connectionList ?? { favoriteIds: [], orderIds: [] },
    connectionId,
    action,
    knownIds
  )
  writeCrescentConfig({ ...current, connectionList: next })
  return next
}

export function readLastUsedConnectionId(): string | undefined {
  return readCrescentConfig().lastUsedConnectionId
}

export function writeLastUsedConnectionId(connectionId: string | undefined): void {
  const current = readCrescentConfig()
  const trimmed = normalizeLastUsedConnectionId(connectionId)
  if (current.lastUsedConnectionId === trimmed) return
  writeCrescentConfig({
    ...current,
    lastUsedConnectionId: trimmed
  })
}

/** Normalize optional last-used connection id from config / IPC input. */
export function normalizeLastUsedConnectionId(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim()
  return trimmed || undefined
}

export function readCrescentMemory(): CrescentMemoryFile {
  migrateMemoryIfNeeded()

  return readCrescentMemoryFromDb()
}

export function writeCrescentMemory(memory: CrescentMemoryFile): CrescentMemoryFile {
  writeCrescentDbFlag('memory_migrated', true)

  return writeCrescentMemoryToDb(normalizeMemoryFile(memory))
}

export function appendOperationRecord(
  record: Omit<OperationRecord, 'id' | 'createdAt'>
): OperationRecord {
  const operation: OperationRecord = {
    id: `op-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...record
  }

  migrateMemoryIfNeeded()
  appendOperationRecordToDb(operation)

  return operation
}

export function normalizeAgentConfig(config: Partial<AgentConfig>): AgentConfig {
  const providers = normalizeAgentProviders(config)
  const requestedProviderId = String(config.providerId ?? '').trim()
  const requestedModel = String(config.model ?? '').trim()
  const selection = selectEnabledAgentProvider(providers, requestedProviderId, requestedModel)
  const openApi = normalizeOpenApiProfiles(config)
  const activeOpenApiProfile = resolveActiveOpenApiProfile({
    ...config,
    openApiProfiles: openApi.openApiProfiles,
    openApiProfileId: openApi.openApiProfileId,
    openApiBaseUrl: String(config.openApiBaseUrl ?? ''),
    openApiDocument: String(config.openApiDocument ?? ''),
    openApiTimeoutMs: Number(config.openApiTimeoutMs ?? defaultAgentConfig.openApiTimeoutMs),
    openApiMaxRetries: Number(config.openApiMaxRetries ?? defaultAgentConfig.openApiMaxRetries),
    openApiRetryBackoffMs: Number(
      config.openApiRetryBackoffMs ?? defaultAgentConfig.openApiRetryBackoffMs
    )
  })
  const openApiFields = projectOpenApiProfileFields(activeOpenApiProfile)

  return {
    providers,
    providerId: selection.providerId,
    model: selection.model,
    workspaceCwd: String(config.workspaceCwd ?? '').trim() || undefined,
    agentStyle: normalizeAgentStyle(config.agentStyle),
    showAgentThinking:
      typeof config.showAgentThinking === 'boolean' ? config.showAgentThinking : undefined,
    agentMode: config.agentMode === 'plan-execute' ? 'plan-execute' : 'react',
    maxActiveTools: clampNumber(
      config.maxActiveTools,
      1,
      12,
      defaultAgentConfig.maxActiveTools ?? 5
    ),
    commandWhitelist: normalizeStringList(
      config.commandWhitelist ?? defaultAgentConfig.commandWhitelist
    ),
    openApiProfiles: openApi.openApiProfiles,
    openApiProfileId: openApi.openApiProfileId,
    ...openApiFields,
    skillRoot: normalizeSkillRoot(config.skillRoot),
    loadGlobalAgentSkills: normalizeLoadGlobalAgentSkills(config),
    mcpServers: normalizeMcpServers(config.mcpServers),
    logLevel: normalizeSystemLogLevel(config.logLevel)
  }
}

function normalizeSkillRoot(value: unknown): string {
  const skillRoot = String(value ?? '').trim()
  if (!skillRoot || skillRoot === GLOBAL_AGENT_SKILLS_TILDE) {
    return CRESCENT_USER_SKILLS_TILDE
  }
  return skillRoot
}

function normalizeLoadGlobalAgentSkills(config: Partial<AgentConfig>): boolean {
  if (typeof config.loadGlobalAgentSkills === 'boolean') return config.loadGlobalAgentSkills
  return String(config.skillRoot ?? '').trim() === GLOBAL_AGENT_SKILLS_TILDE
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => String(item).trim()).filter(Boolean)
}

function normalizeAgentProviders(config: Partial<AgentConfig>): AgentProviderConfig[] {
  if (Array.isArray(config.providers)) {
    const providers = dedupeAgentProviders(
      config.providers.map(normalizeAgentProvider).filter((provider) => provider.id)
    )
    return providers
  }

  const legacyBaseUrl = config.openAiBaseUrl?.trim()
  const legacyApiKey = config.openAiApiKey?.trim()
  if (legacyBaseUrl || legacyApiKey || config.model?.trim()) {
    return [
      normalizeAgentProvider({
        id: 'custom',
        name: 'Custom',
        baseUrl: legacyBaseUrl ?? '',
        apiKey: legacyApiKey ?? '',
        models: config.model?.trim() ? [{ id: config.model.trim(), name: config.model.trim() }] : []
      })
    ].filter((provider) => provider.id)
  }

  return []
}

function dedupeAgentProviders(providers: AgentProviderConfig[]): AgentProviderConfig[] {
  const seen = new Set<string>()
  return providers.filter((provider) => {
    if (seen.has(provider.id)) return false
    seen.add(provider.id)
    return true
  })
}

function normalizeAgentProvider(value: unknown): AgentProviderConfig {
  const record = isRecord(value) ? value : {}
  const id = String(record.id || record.name || '').trim()
  const models = Array.isArray(record.models)
    ? record.models.map(normalizeAgentProviderModel).filter((model) => model.id)
    : []

  return {
    id,
    name: String(record.name || id),
    baseUrl: String(record.baseUrl || ''),
    apiKey: record.apiKey ? String(record.apiKey) : '',
    enabled: record.enabled !== false,
    models
  }
}

function normalizeAgentProviderModel(value: unknown): AgentProviderModelConfig {
  if (typeof value === 'string') return { id: value.trim(), name: value.trim(), reasoning: false }

  const record = isRecord(value) ? value : {}
  const id = String(record.id || record.name || '').trim()

  return {
    id,
    name: String(record.name || id),
    reasoning: Boolean(record.reasoning)
  }
}

function normalizeConfigFile(value: unknown): CrescentConfigFile {
  const record = isRecord(value) ? value : {}

  return {
    agent: normalizeAgentConfig(isRecord(record.agent) ? record.agent : {}),
    whaleMonitor: normalizeWhaleMonitorConfig(record.whaleMonitor),
    connections: Array.isArray(record.connections)
      ? record.connections.map(normalizeConnection).filter((connection) => connection.host)
      : [],
    wikiDirectory: normalizeWikiDirectory(record.wikiDirectory),
    lastUsedConnectionId: normalizeLastUsedConnectionId(record.lastUsedConnectionId),
    connectionList: normalizeConnectionListMeta(record.connectionList)
  }
}

function normalizeWikiDirectory(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const directory = resolve(value.trim())
  return isAbsolute(directory) ? directory : undefined
}

function normalizeWhaleMonitorConfig(value: unknown): WhaleMonitorConfig & { apiKey?: string } {
  const record = isRecord(value) ? value : {}
  const defaults = DEFAULT_WHALE_MONITOR_CONFIG
  const budget = Number(record.totalBudget)
  const interval = Number(record.refreshIntervalSeconds)
  const position = isRecord(record.position) ? record.position : undefined
  const x = Number(position?.x)
  const y = Number(position?.y)
  const startDate = typeof record.startDate === 'string' ? record.startDate : undefined
  const endDate = typeof record.endDate === 'string' ? record.endDate : undefined

  return {
    enabled: record.enabled !== false,
    spendBaseUrl: normalizeMonitorUrl(record.spendBaseUrl, defaults.spendBaseUrl),
    modelsBaseUrl: normalizeMonitorUrl(record.modelsBaseUrl, defaults.modelsBaseUrl),
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
    totalBudget: Number.isFinite(budget) && budget >= 0 ? budget : defaults.totalBudget,
    refreshIntervalSeconds: Number.isFinite(interval)
      ? Math.min(3600, Math.max(30, Math.round(interval)))
      : defaults.refreshIntervalSeconds,
    defaultDateRange:
      record.defaultDateRange === 'current-day' || record.defaultDateRange === 'custom'
        ? record.defaultDateRange
        : 'current-month',
    ...(isValidMonitorDate(startDate) ? { startDate } : {}),
    ...(isValidMonitorDate(endDate) ? { endDate } : {}),
    ...(Number.isFinite(x) && Number.isFinite(y) ? { position: { x, y } } : {})
  }
}

function normalizeMonitorUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  try {
    const parsed = new URL(value.trim())
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return fallback
    }
    return parsed.toString()
  } catch {
    return fallback
  }
}

function isValidMonitorDate(value: string | undefined): value is string {
  return Boolean(
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  )
}

function stripDbBackedConfig(config: CrescentConfigFile): CrescentConfigFile {
  const agent = { ...config.agent } as Partial<AgentConfig>
  delete agent.commandWhitelist

  return {
    ...config,
    agent: agent as AgentConfig
  }
}

function migrateCommandWhitelistIfNeeded(legacyWhitelist: string[]): void {
  if (readCrescentDbFlag('command_whitelist_migrated')) return

  if (legacyWhitelist.length > 0 && readCommandWhitelistFromDb().length === 0) {
    writeCommandWhitelistToDb(legacyWhitelist)
  }
  writeCrescentDbFlag('command_whitelist_migrated', true)
  writeCrescentConfig({
    ...readCrescentConfig(),
    agent: {
      ...readCrescentConfig().agent,
      commandWhitelist: []
    }
  })
}

function migrateMemoryIfNeeded(): void {
  if (readCrescentDbFlag('memory_migrated')) return

  const legacyMemory = normalizeMemoryFile(readJsonFile(getCrescentMemoryPath(), {}))
  const currentMemory = readCrescentMemoryFromDb()
  const hasCurrentMemory =
    currentMemory.shortTerm.length > 0 ||
    currentMemory.longTerm.preferences.length > 0 ||
    currentMemory.longTerm.notes.length > 0 ||
    currentMemory.longTerm.operations.length > 0

  if (!hasCurrentMemory) {
    writeCrescentMemoryToDb(legacyMemory, { replaceOperations: true })
  }
  writeCrescentDbFlag('memory_migrated', true)
}

function normalizeMemoryFile(value: unknown): CrescentMemoryFile {
  const record = isRecord(value) ? value : {}
  const longTerm = isRecord(record.longTerm) ? record.longTerm : {}

  return {
    shortTerm: Array.isArray(record.shortTerm)
      ? record.shortTerm.filter(isMemoryRecord).slice(-100)
      : [],
    longTerm: {
      preferences: Array.isArray(longTerm.preferences)
        ? longTerm.preferences.map(String).slice(-100)
        : [],
      notes: Array.isArray(longTerm.notes) ? longTerm.notes.map(String).slice(-100) : [],
      operations: Array.isArray(longTerm.operations)
        ? longTerm.operations.filter(isOperationRecord).slice(0, 500)
        : []
    }
  }
}

function normalizeConnection(value: unknown): ConnectionConfig {
  const record = isRecord(value) ? value : {}
  const port = Number(record.port)

  return {
    id: String(record.id || `custom-${randomUUID()}`),
    source: record.source === 'ssh-config' ? 'ssh-config' : 'custom',
    name: String(record.name || record.host || ''),
    host: String(record.host || ''),
    user: record.user ? String(record.user) : undefined,
    password: record.password ? String(record.password) : undefined,
    passwordEnvVar: record.passwordEnvVar ? String(record.passwordEnvVar).trim() : undefined,
    rootPassword: record.rootPassword ? String(record.rootPassword) : undefined,
    port: Number.isFinite(port) && port > 0 ? Math.round(port) : undefined,
    identityFile: record.identityFile ? String(record.identityFile) : undefined,
    sshOptions: Array.isArray(record.sshOptions)
      ? record.sshOptions
          .map(String)
          .map((line) => line.trim())
          .filter(Boolean)
      : undefined,
    description: record.description ? String(record.description) : undefined,
    actions: Array.isArray(record.actions)
      ? record.actions.map(String).filter((line) => line.trim())
      : undefined,
    clusterHostRegex: (() => {
      const validated = validateClusterHostRegex(
        record.clusterHostRegex ? String(record.clusterHostRegex) : undefined
      )
      return validated.ok ? validated.value : undefined
    })()
  }
}

function readJsonFile(path: string, fallback: unknown): unknown {
  ensureParentDir(path)
  if (!existsSync(path)) return fallback

  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(path: string, value: unknown): void {
  ensureParentDir(path)
  const tmpPath = `${path}.tmp`

  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, path)
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isMemoryRecord(value: unknown): value is AgentMemoryRecord {
  return (
    isRecord(value) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'string'
  )
}

function isOperationRecord(value: unknown): value is OperationRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.status === 'success' || value.status === 'error') &&
    typeof value.summary === 'string'
  )
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}
