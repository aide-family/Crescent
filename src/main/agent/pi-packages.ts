import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

import type { AgentExtensionOption, AgentPiPackageSearchResult } from './types'
import { getCrescentPiAgentDir } from './pi-paths'
import { loadPiCodingAgent } from './pi-sdk'
import { normalizeDisabledExtensions } from './extensions'

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search'
const MAX_CATALOG_RESULTS = 24
const CATALOG_FETCH_TIMEOUT_MS = 12_000
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i

export function buildPiPackageSearchUrl(query: string): string {
  const text = ['keywords:pi-package', query.trim()].filter(Boolean).join(' ')
  const url = new URL(NPM_SEARCH_URL)
  url.searchParams.set('text', text)
  url.searchParams.set('size', String(MAX_CATALOG_RESULTS))
  return url.toString()
}

export function toNpmPackageSource(input: string): string {
  const trimmed = input.trim()
  const raw = trimmed.startsWith('npm:') ? trimmed.slice(4).trim() : trimmed
  const name = stripNpmVersion(raw)
  if (!NPM_PACKAGE_NAME.test(name) || name.includes('..')) {
    throw new Error('Invalid npm package name.')
  }
  return `npm:${name}`
}

export function isNpmPackageSource(value: string): boolean {
  return value.trim().startsWith('npm:')
}

export function readConfiguredPiPackageSources(agentDir = getCrescentPiAgentDir()): string[] {
  const settingsPath = join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      packages?: unknown
    }
    return normalizePackageSources(parsed.packages)
  } catch {
    return []
  }
}

export function listPiPackageExtensions(
  options: {
    disabledExtensions?: string[]
    agentDir?: string
  } = {}
): AgentExtensionOption[] {
  const agentDir = options.agentDir ?? getCrescentPiAgentDir()
  const disabled = new Set(normalizeDisabledExtensions(options.disabledExtensions))
  return readConfiguredPiPackageSources(agentDir).map((source) => {
    const name = source.slice('npm:'.length)
    const installedPath = join(agentDir, 'npm', 'node_modules', name)
    return {
      id: source,
      name,
      path: source,
      kind: 'package' as const,
      enabled: !disabled.has(source) && !disabled.has(name),
      tools: [],
      commands: [],
      source,
      description: existsSync(installedPath) ? readPackageDescription(installedPath) : undefined
    }
  })
}

export function computePiPackageFingerprint(agentDir = getCrescentPiAgentDir()): string {
  const sources = readConfiguredPiPackageSources(agentDir)
  const stamps = sources.map((source) => {
    const name = source.startsWith('npm:') ? source.slice(4) : source
    const installedPath = join(agentDir, 'npm', 'node_modules', name)
    if (!existsSync(installedPath)) return `${source}:missing`
    try {
      const stats = statSync(installedPath)
      return `${source}:${stats.mtimeMs}`
    } catch {
      return `${source}:missing`
    }
  })
  return stamps.join(',')
}

export async function searchPiPackageCatalog(query: string): Promise<AgentPiPackageSearchResult[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(buildPiPackageSearchUrl(query), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Crescent'
      }
    })
    if (!response.ok) {
      throw new Error(`Pi package search failed: ${response.status} ${response.statusText}`)
    }
    return normalizeNpmSearchResults(await response.json())
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Pi package search timed out.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function normalizeNpmSearchResults(payload: unknown): AgentPiPackageSearchResult[] {
  if (!payload || typeof payload !== 'object' || !('objects' in payload)) return []
  const objects = (payload as { objects?: unknown }).objects
  if (!Array.isArray(objects)) return []

  const results: AgentPiPackageSearchResult[] = []
  for (const entry of objects) {
    const pkg =
      entry && typeof entry === 'object' && 'package' in entry
        ? (entry as { package?: unknown }).package
        : undefined
    if (!pkg || typeof pkg !== 'object') continue
    const record = pkg as {
      name?: unknown
      version?: unknown
      description?: unknown
      keywords?: unknown
      links?: { npm?: unknown }
      publisher?: { username?: unknown }
    }
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name || !NPM_PACKAGE_NAME.test(name)) continue
    const downloads =
      entry && typeof entry === 'object' && 'downloads' in entry
        ? (entry as { downloads?: { monthly?: unknown } }).downloads?.monthly
        : undefined
    const keywords = Array.isArray(record.keywords)
      ? record.keywords.filter((item): item is string => typeof item === 'string')
      : []
    results.push({
      id: `npm:${name}`,
      name,
      description: typeof record.description === 'string' ? record.description : '',
      version: typeof record.version === 'string' ? record.version : '',
      source: `npm:${name}`,
      url:
        typeof record.links?.npm === 'string'
          ? record.links.npm
          : `https://www.npmjs.com/package/${name}`,
      downloads: typeof downloads === 'number' ? downloads : undefined,
      publisher: typeof record.publisher?.username === 'string' ? record.publisher.username : '',
      types: packageTypesFromKeywords(keywords)
    })
  }
  return results
}

export async function installPiPackage(input: { source: string; cwd: string }): Promise<void> {
  const source = toNpmPackageSource(input.source)
  const { packageManager } = await createCrescentPackageManager(input.cwd)
  await packageManager.installAndPersist(source)
}

export async function removePiPackage(input: { source: string; cwd: string }): Promise<void> {
  const source = toNpmPackageSource(input.source)
  const { packageManager } = await createCrescentPackageManager(input.cwd)
  await packageManager.removeAndPersist(source)
}

export async function listEnabledPiPackageExtensionPaths(input: {
  cwd: string
  disabledExtensions?: string[]
}): Promise<string[]> {
  const disabled = new Set(normalizeDisabledExtensions(input.disabledExtensions))
  const { packageManager } = await createCrescentPackageManager(input.cwd)
  const resolved = await packageManager.resolve()
  return resolved.extensions
    .filter((resource) => resource.enabled)
    .filter((resource) => {
      const source = resource.metadata.source?.trim() ?? ''
      const id = source.startsWith('npm:') ? source : source ? `npm:${source}` : ''
      if (id && (disabled.has(id) || disabled.has(id.slice(4)))) return false
      return true
    })
    .map((resource) => resource.path)
}

export function readPiPackageContent(source: string, agentDir = getCrescentPiAgentDir()): string {
  const npmSource = toNpmPackageSource(source)
  const name = npmSource.slice('npm:'.length)
  const installedPath = join(agentDir, 'npm', 'node_modules', name)
  const packageJsonPath = join(installedPath, 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error('Installed package was not found.')
  }
  return readFileSync(packageJsonPath, 'utf8').slice(0, 16_000)
}

export async function createCrescentSettingsManager(cwd: string): Promise<{
  settingsManager: ReturnType<
    (typeof import('@earendil-works/pi-coding-agent'))['SettingsManager']['create']
  >
  agentDir: string
}> {
  const pi = await loadPiCodingAgent()
  const agentDir = getCrescentPiAgentDir()
  const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: false })
  settingsManager.setProjectTrusted(false)
  settingsManager.applyOverrides({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 }
  })
  return { settingsManager, agentDir }
}

async function createCrescentPackageManager(cwd: string): Promise<{
  packageManager: InstanceType<
    (typeof import('@earendil-works/pi-coding-agent'))['DefaultPackageManager']
  >
}> {
  const pi = await loadPiCodingAgent()
  const { settingsManager, agentDir } = await createCrescentSettingsManager(cwd)
  return {
    packageManager: new pi.DefaultPackageManager({
      cwd,
      agentDir,
      settingsManager
    })
  }
}

function stripNpmVersion(name: string): string {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/')
    if (slash < 0) throw new Error('Invalid npm package name.')
    const scope = name.slice(0, slash)
    const rest = name.slice(slash + 1)
    return `${scope}/${rest.split('@')[0]}`
  }
  return name.split('@')[0] ?? name
}

function normalizePackageSources(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const sources: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      sources.push(entry.trim())
      continue
    }
    if (entry && typeof entry === 'object' && 'source' in entry) {
      const source = String((entry as { source?: unknown }).source ?? '').trim()
      if (source) sources.push(source)
    }
  }
  return [...new Set(sources)]
}

function packageTypesFromKeywords(keywords: string[]): string[] {
  const types = ['extension', 'skill', 'theme', 'prompt']
  return types.filter((type) => keywords.some((keyword) => keyword.toLowerCase() === type))
}

function readPackageDescription(installedPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(installedPath, 'package.json'), 'utf8')) as {
      description?: unknown
    }
    return typeof parsed.description === 'string' ? parsed.description : undefined
  } catch {
    return undefined
  }
}
