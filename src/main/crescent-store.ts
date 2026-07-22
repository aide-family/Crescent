import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

import {
  appendOperationRecordToDb,
  readCommandWhitelistFromDb,
  readCrescentDbFlag,
  readCrescentMemoryFromDb,
  writeCommandWhitelistToDb,
  writeCrescentDbFlag,
  writeCrescentMemoryToDb
} from './crescent-sqlite'
import { getCrescentConfigPath, getCrescentMemoryPath } from './crescent-paths'
import type {
  AgentConfig,
  AgentLongTermMemory,
  AgentMemoryRecord,
  AgentMcpServerConfig,
  AgentProviderConfig,
  AgentProviderModelConfig,
  ConnectionConfig,
  ConnectionInput,
  OperationRecord
} from './agent/types'

export {
  getCrescentDir,
  getCrescentConfigPath,
  getCrescentMemoryPath,
  getCrescentSystemSkillsDir,
  getCrescentWikiDir
} from './crescent-paths'

export interface CrescentConfigFile {
  agent: AgentConfig
  connections: ConnectionConfig[]
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
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: defaultCommandWhitelist,
  openApiBaseUrl: '',
  openApiDocument: '',
  skillRoot: '~/.agents/skills',
  mcpServers: []
}

export const defaultMemoryFile: CrescentMemoryFile = {
  shortTerm: [],
  longTerm: {
    preferences: [],
    notes: [],
    operations: []
  }
}

export function readCrescentConfig(): CrescentConfigFile {
  return normalizeConfigFile(readJsonFile(getCrescentConfigPath(), {}))
}

export function writeCrescentConfig(config: CrescentConfigFile): CrescentConfigFile {
  const normalized = normalizeConfigFile(config)
  writeJsonFile(getCrescentConfigPath(), stripDbBackedConfig(normalized))

  return normalized
}

export function readAgentConfig(): AgentConfig {
  const config = readCrescentConfig()
  const legacyWhitelist = config.agent.commandWhitelist

  migrateCommandWhitelistIfNeeded(legacyWhitelist)

  return {
    ...config.agent,
    commandWhitelist: readCommandWhitelistFromDb()
  }
}

export function writeAgentConfig(config: AgentConfig): AgentConfig {
  const current = readCrescentConfig()
  const normalized = normalizeAgentConfig(config)
  const commandWhitelist = writeCommandWhitelistToDb(normalized.commandWhitelist)

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

  writeCrescentConfig({ ...current, connections })
  return connection
}

export function deleteCustomConnection(id: string): void {
  const current = readCrescentConfig()
  writeCrescentConfig({
    ...current,
    connections: current.connections.filter((connection) => connection.id !== id)
  })
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
  const provider =
    providers.find((candidate) => candidate.id === requestedProviderId) ??
    providers.find((candidate) => candidate.models.some((model) => model.id === requestedModel)) ??
    providers[0]
  const defaultModel = provider?.models[0]?.id ?? providers[0]?.models[0]?.id ?? ''
  const modelOk = Boolean(provider?.models.some((candidate) => candidate.id === requestedModel))

  return {
    providers,
    providerId: provider?.id,
    model: modelOk ? requestedModel : defaultModel,
    agentMode: config.agentMode === 'plan-execute' ? 'plan-execute' : 'react',
    maxActiveTools: clampNumber(config.maxActiveTools, 1, 12, defaultAgentConfig.maxActiveTools),
    commandWhitelist: normalizeStringList(
      config.commandWhitelist ?? defaultAgentConfig.commandWhitelist
    ),
    openApiBaseUrl: String(config.openApiBaseUrl ?? ''),
    openApiDocument: String(config.openApiDocument ?? ''),
    skillRoot: normalizeSkillRoot(config.skillRoot),
    mcpServers: normalizeMcpServers(config.mcpServers)
  }
}

function normalizeSkillRoot(value: unknown): string {
  const skillRoot = String(value ?? '').trim()

  return skillRoot || defaultAgentConfig.skillRoot
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => String(item).trim()).filter(Boolean)
}

function normalizeMcpServers(value: unknown): AgentMcpServerConfig[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  return value.map(normalizeMcpServer).filter((server) => {
    if (!server.id || seen.has(server.id)) return false
    seen.add(server.id)
    return true
  })
}

function normalizeMcpServer(value: unknown): AgentMcpServerConfig {
  const record = isRecord(value) ? value : {}
  const name = String(record.name || record.id || '').trim()
  const id = sanitizeConfigId(String(record.id || name || '').trim())

  return {
    id,
    name: name || id,
    transport: 'stdio',
    command: String(record.command || '').trim(),
    args: normalizeStringList(record.args),
    env: normalizeStringMap(record.env),
    enabled: record.enabled !== false
  }
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, mapValue]) => [key.trim(), String(mapValue ?? '')] as const)
      .filter(([key]) => Boolean(key))
  )
}

function sanitizeConfigId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    connections: Array.isArray(record.connections)
      ? record.connections.map(normalizeConnection).filter((connection) => connection.host)
      : []
  }
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
      : undefined
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
