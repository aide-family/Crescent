import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

import { defaultOpenClawLikeConfig } from './agent/openclaw-config'
import type {
  AgentConfig,
  AgentLongTermMemory,
  AgentMemoryRecord,
  ConnectionConfig,
  ConnectionInput,
  OperationRecord
} from './agent/types'

export interface CrescentConfigFile {
  agent: AgentConfig
  connections: ConnectionConfig[]
}

export interface CrescentMemoryFile {
  shortTerm: AgentMemoryRecord[]
  longTerm: AgentLongTermMemory
}

export const defaultAgentConfig: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: defaultOpenClawLikeConfig.agents.defaults.model.primary,
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: '',
  openApiDocument: ''
}

export const defaultMemoryFile: CrescentMemoryFile = {
  shortTerm: [],
  longTerm: {
    preferences: [],
    notes: [],
    operations: []
  }
}

export function getCrescentDir(): string {
  return join(homedir(), '.crescent')
}

export function getCrescentConfigPath(): string {
  return join(getCrescentDir(), 'config.json')
}

export function getCrescentMemoryPath(): string {
  return join(getCrescentDir(), 'memory.json')
}

export function readCrescentConfig(): CrescentConfigFile {
  return normalizeConfigFile(readJsonFile(getCrescentConfigPath(), {}))
}

export function writeCrescentConfig(config: CrescentConfigFile): CrescentConfigFile {
  const normalized = normalizeConfigFile(config)
  writeJsonFile(getCrescentConfigPath(), normalized)

  return normalized
}

export function readAgentConfig(): AgentConfig {
  return readCrescentConfig().agent
}

export function writeAgentConfig(config: AgentConfig): AgentConfig {
  const current = readCrescentConfig()
  const next = writeCrescentConfig({ ...current, agent: normalizeAgentConfig(config) })

  return next.agent
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
  return normalizeMemoryFile(readJsonFile(getCrescentMemoryPath(), {}))
}

export function writeCrescentMemory(memory: CrescentMemoryFile): CrescentMemoryFile {
  const normalized = normalizeMemoryFile(memory)
  writeJsonFile(getCrescentMemoryPath(), normalized)

  return normalized
}

export function appendOperationRecord(
  record: Omit<OperationRecord, 'id' | 'createdAt'>
): OperationRecord {
  const memory = readCrescentMemory()
  const operation: OperationRecord = {
    id: `op-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...record
  }

  writeCrescentMemory({
    ...memory,
    longTerm: {
      ...memory.longTerm,
      operations: [operation, ...memory.longTerm.operations].slice(0, 500)
    }
  })

  return operation
}

export function normalizeAgentConfig(config: Partial<AgentConfig>): AgentConfig {
  return {
    openAiApiKey: String(config.openAiApiKey ?? ''),
    openAiBaseUrl: String(config.openAiBaseUrl ?? ''),
    model: String(config.model ?? defaultAgentConfig.model),
    agentMode: config.agentMode === 'plan-execute' ? 'plan-execute' : 'react',
    maxActiveTools: clampNumber(config.maxActiveTools, 1, 12, defaultAgentConfig.maxActiveTools),
    openApiBaseUrl: String(config.openApiBaseUrl ?? ''),
    openApiDocument: String(config.openApiDocument ?? '')
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
