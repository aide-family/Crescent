import { BrowserWindow, ipcMain } from 'electron'
import { readWhaleMonitorConfig, writeWhaleMonitorConfig } from './crescent-store'
import type {
  WhaleModelsSnapshot,
  WhaleMonitorConfig,
  WhaleMonitorSettings,
  WhaleMonitorSnapshot,
  WhaleUsageSnapshot
} from '../shared/whale-monitor'

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 15_000

let usageSnapshot: WhaleUsageSnapshot | undefined
let modelsSnapshot: WhaleModelsSnapshot = { models: [] }
let refreshTimer: ReturnType<typeof setInterval> | undefined
const inFlightSpend = new Map<string, Promise<WhaleUsageSnapshot>>()
let usageRequestSequence = 0
let inFlightModels: Promise<WhaleModelsSnapshot> | undefined
const activeControllers = new Set<AbortController>()

export function registerWhaleMonitorIpc(): void {
  ipcMain.handle('whale-monitor:get-snapshot', () => getWhaleMonitorSnapshot())
  ipcMain.handle('whale-monitor:save-settings', (_event, input: unknown) => {
    const current = readWhaleMonitorConfig()
    const validated = validateSettingsInput(input, current)
    const next = writeWhaleMonitorConfig({
      ...validated,
      apiKey: validated.apiKey?.trim() || current.apiKey,
      clearApiKey: validated.clearApiKey
    })
    restartWhaleMonitorScheduler()
    broadcastSnapshot()
    return toSettings(next)
  })
  ipcMain.handle('whale-monitor:refresh-usage', async (_event, range: unknown) => {
    const normalized = validateDateRange(range)
    const result = await fetchUsage(normalized.startDate, normalized.endDate)
    broadcastSnapshot()
    return result
  })
  ipcMain.handle('whale-monitor:refresh-models', async () => {
    const result = await fetchModels()
    broadcastSnapshot()
    return result
  })
  ipcMain.handle('whale-monitor:set-position', (_event, position: unknown) => {
    if (!isRecord(position)) return { ok: false }
    const x = typeof position.x === 'number' ? position.x : Number.NaN
    const y = typeof position.y === 'number' ? position.y : Number.NaN
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false }
    writeWhaleMonitorConfig({ position: { x: Math.round(x), y: Math.round(y) } })
    return { ok: true }
  })
}

function validateSettingsInput(
  value: unknown,
  current: ReturnType<typeof readWhaleMonitorConfig>
): Partial<WhaleMonitorConfig> & { apiKey?: string; clearApiKey?: boolean } {
  if (!isRecord(value)) throw new Error('Invalid whale monitor settings.')
  const spendBaseUrl = validateEndpoint(value.spendBaseUrl, 'spend')
  const modelsBaseUrl = validateEndpoint(value.modelsBaseUrl, 'models')
  const totalBudget = typeof value.totalBudget === 'number' ? value.totalBudget : Number.NaN
  const refreshIntervalSeconds =
    typeof value.refreshIntervalSeconds === 'number' ? value.refreshIntervalSeconds : Number.NaN
  if (!Number.isFinite(totalBudget) || totalBudget < 0) {
    throw new Error('Budget must be a finite number that is zero or greater.')
  }
  if (
    !Number.isInteger(refreshIntervalSeconds) ||
    refreshIntervalSeconds < 30 ||
    refreshIntervalSeconds > 3600
  ) {
    throw new Error('Refresh interval must be between 30 and 3600 seconds.')
  }
  const defaultDateRange =
    value.defaultDateRange === 'current-day' || value.defaultDateRange === 'custom'
      ? value.defaultDateRange
      : 'current-month'
  const hasStartDate = typeof value.startDate === 'string' && value.startDate.length > 0
  const hasEndDate = typeof value.endDate === 'string' && value.endDate.length > 0
  if (hasStartDate !== hasEndDate) throw new Error('Both custom dates are required.')
  const range = hasStartDate
    ? validateDateRange({ startDate: value.startDate, endDate: value.endDate })
    : undefined
  if (defaultDateRange === 'custom' && !range) {
    throw new Error('Both custom dates are required.')
  }
  if (typeof value.apiKey !== 'undefined' && typeof value.apiKey !== 'string') {
    throw new Error('API key must be text.')
  }
  if (typeof value.apiKey === 'string' && value.apiKey.length > 4096) {
    throw new Error('API key is too long.')
  }
  const position = isRecord(value.position) ? value.position : current.position
  const x = typeof position?.x === 'number' ? position.x : Number.NaN
  const y = typeof position?.y === 'number' ? position.y : Number.NaN
  if (position && (!Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error('Desktop pet position is invalid.')
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : current.enabled,
    spendBaseUrl,
    modelsBaseUrl,
    totalBudget,
    refreshIntervalSeconds,
    defaultDateRange,
    ...(range ?? {}),
    ...(position ? { position: { x: Math.round(x), y: Math.round(y) } } : {}),
    ...(typeof value.apiKey === 'string' ? { apiKey: value.apiKey } : {}),
    clearApiKey: value.clearApiKey === true
  }
}

function validateEndpoint(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error(`The ${label} endpoint URL is invalid.`)
  }
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      throw new Error('invalid')
    }
    return url.toString()
  } catch {
    throw new Error(`The ${label} endpoint must use HTTP or HTTPS and cannot contain credentials.`)
  }
}

export function startWhaleMonitorScheduler(): void {
  restartWhaleMonitorScheduler()
  const settings = readWhaleMonitorConfig()
  if (settings.enabled && settings.apiKey) {
    const range = defaultDateRange(settings)
    void fetchUsage(range.startDate, range.endDate).then(broadcastSnapshot)
    void fetchModels().then(broadcastSnapshot)
  }
}

export function stopWhaleMonitorScheduler(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = undefined
  for (const controller of activeControllers) controller.abort()
  activeControllers.clear()
}

function restartWhaleMonitorScheduler(): void {
  stopWhaleMonitorScheduler()
  const settings = readWhaleMonitorConfig()
  if (!settings.enabled || !settings.apiKey) return
  refreshTimer = setInterval(() => {
    const range = defaultDateRange(readWhaleMonitorConfig())
    void fetchUsage(range.startDate, range.endDate).then(broadcastSnapshot)
    void fetchModels().then(broadcastSnapshot)
  }, settings.refreshIntervalSeconds * 1000)
}

function getWhaleMonitorSnapshot(): WhaleMonitorSnapshot {
  return {
    settings: toSettings(readWhaleMonitorConfig()),
    usage: usageSnapshot,
    models: modelsSnapshot
  }
}

function toSettings(config: ReturnType<typeof readWhaleMonitorConfig>): WhaleMonitorSettings {
  const { apiKey, ...settings } = config
  return { ...settings, apiKeyConfigured: Boolean(apiKey) }
}

function broadcastSnapshot(): void {
  const snapshot = getWhaleMonitorSnapshot()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('whale-monitor:snapshot', snapshot)
    }
  }
}

async function fetchUsage(startDate: string, endDate: string): Promise<WhaleUsageSnapshot> {
  const key = `${startDate}:${endDate}`
  const existing = inFlightSpend.get(key)
  if (existing) return existing
  const requestSequence = ++usageRequestSequence
  const request = (async () => {
    const config = readWhaleMonitorConfig()
    let result: WhaleUsageSnapshot
    try {
      if (!config.apiKey) throw new Error('Add a LiteLLM API key in whale monitor settings.')
      const url = new URL(config.spendBaseUrl)
      url.searchParams.set('start_date', startDate)
      url.searchParams.set('end_date', endDate)
      url.searchParams.set('timezone', 'Asia/Shanghai')
      const payload = await fetchJson(url, config.apiKey)
      const summary = isRecord(payload) && isRecord(payload.summary) ? payload.summary : undefined
      if (!summary) throw new Error('The usage response did not include a summary.')
      const spend = finiteNumber(summary.spend)
      if (spend === undefined) throw new Error('The usage response had an invalid spend value.')
      result = {
        startDate,
        endDate,
        spend,
        totalTokens: finiteNumber(summary.total_tokens) ?? 0,
        promptTokens: finiteNumber(summary.prompt_tokens) ?? 0,
        completionTokens: finiteNumber(summary.completion_tokens) ?? 0,
        requestCount: finiteNumber(summary.request_count) ?? 0,
        updatedAt: new Date().toISOString()
      }
    } catch (error) {
      result = {
        ...(usageSnapshot ?? emptyUsage(startDate, endDate)),
        stale: true,
        error: safeError(error)
      }
    }
    if (requestSequence === usageRequestSequence) usageSnapshot = result
    return result
  })().finally(() => {
    inFlightSpend.delete(key)
  })
  inFlightSpend.set(key, request)
  return request
}

async function fetchModels(): Promise<WhaleModelsSnapshot> {
  if (inFlightModels) return inFlightModels
  inFlightModels = (async () => {
    const config = readWhaleMonitorConfig()
    try {
      if (!config.apiKey) throw new Error('Add a LiteLLM API key in whale monitor settings.')
      const payload = await fetchJson(new URL(config.modelsBaseUrl), config.apiKey)
      const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : undefined
      if (!data) throw new Error('The model response did not include a data list.')
      const models = data
        .map((item) => (isRecord(item) && typeof item.id === 'string' ? item.id : ''))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
      modelsSnapshot = { models, updatedAt: new Date().toISOString() }
    } catch (error) {
      modelsSnapshot = {
        ...modelsSnapshot,
        stale: true,
        error: safeError(error)
      }
    }
    return modelsSnapshot
  })().finally(() => {
    inFlightModels = undefined
  })
  return inFlightModels
}

async function fetchJson(url: URL, apiKey: string): Promise<unknown> {
  const controller = new AbortController()
  activeControllers.add(controller)
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`LiteLLM request failed (HTTP ${response.status}).`)
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_RESPONSE_BYTES)
      throw new Error('LiteLLM response exceeded the size limit.')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('LiteLLM returned an empty response.')
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('LiteLLM response exceeded the size limit.')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder().decode(bytes)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error('LiteLLM returned invalid JSON.')
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('LiteLLM request timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    activeControllers.delete(controller)
  }
}

function validateDateRange(value: unknown): { startDate: string; endDate: string } {
  const record = isRecord(value) ? value : {}
  const startDate = typeof record.startDate === 'string' ? record.startDate : ''
  const endDate = typeof record.endDate === 'string' ? record.endDate : ''
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    throw new Error('Choose a valid date range where the start is on or before the end.')
  }
  return { startDate, endDate }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function defaultDateRange(config: ReturnType<typeof readWhaleMonitorConfig>): {
  startDate: string
  endDate: string
} {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '01'
  const today = `${get('year')}-${get('month')}-${get('day')}`
  if (config.defaultDateRange === 'custom' && config.startDate && config.endDate) {
    return { startDate: config.startDate, endDate: config.endDate }
  }
  if (config.defaultDateRange === 'current-day') return { startDate: today, endDate: today }
  return {
    startDate: `${today.slice(0, 7)}-01`,
    endDate: `${today.slice(0, 7)}-${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()}`
  }
}

function emptyUsage(startDate: string, endDate: string): WhaleUsageSnapshot {
  return {
    startDate,
    endDate,
    updatedAt: ''
  }
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unable to read LiteLLM data.'
  const message = error.message.slice(0, 180)
  return message.includes('Bearer ') ? 'LiteLLM request failed.' : message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
