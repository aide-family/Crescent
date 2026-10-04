export interface WhaleMonitorConfig {
  enabled: boolean
  spendBaseUrl: string
  modelsBaseUrl: string
  totalBudget: number
  refreshIntervalSeconds: number
  defaultDateRange: 'current-month' | 'current-day' | 'custom'
  startDate?: string
  endDate?: string
  position?: { x: number; y: number }
}

export interface WhaleMonitorSettings extends WhaleMonitorConfig {
  apiKeyConfigured: boolean
}

export interface WhaleUsageSnapshot {
  startDate: string
  endDate: string
  spend?: number
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  requestCount?: number
  updatedAt: string
  stale?: boolean
  error?: string
}

export interface WhaleModelsSnapshot {
  models: string[]
  updatedAt?: string
  stale?: boolean
  error?: string
}

export interface WhaleMonitorSnapshot {
  settings: WhaleMonitorSettings
  usage?: WhaleUsageSnapshot
  models: WhaleModelsSnapshot
}

export interface WhaleMonitorConfigInput extends WhaleMonitorConfig {
  apiKey?: string
  clearApiKey?: boolean
}

export const DEFAULT_WHALE_MONITOR_CONFIG: WhaleMonitorConfig = {
  enabled: true,
  spendBaseUrl: 'https://dmxwg.intra.yiducloud.cn/litellm/spend/logs/self',
  modelsBaseUrl: 'http://nova.dmxwg.yiducloud.cn/litellm/v1/models',
  totalBudget: 200,
  refreshIntervalSeconds: 120,
  defaultDateRange: 'current-month'
}
