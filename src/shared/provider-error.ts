/**
 * Classify provider / model API failures so Crescent can treat quota exhaustion
 * differently from transient rate limits (blind exponential retry).
 */

export type ProviderErrorKind = 'quota_exceeded' | 'rate_limit' | 'transient' | 'unknown'

export interface ClassifiedProviderError {
  kind: ProviderErrorKind
  /** Best-effort provider label extracted from message / JSON. */
  provider?: string
  /** Parsed Retry-After / reset delay when present. */
  retryAfterMs?: number
  rawMessage: string
}

const QUOTA_CODE_PATTERN =
  /\b(AccountQuotaExceeded|InsufficientQuota|insufficient_quota|QuotaExceeded|quota_exceeded|FreeUsageLimitError|GoUsageLimitError)\b/i

const QUOTA_TEXT_PATTERN =
  /quota\s*exceeded|insufficient\s*quota|out of (?:budget|quota)|usage limit reached|billing|账户配额|配额已用尽|额度不足/i

const TRANSIENT_429_WITHOUT_QUOTA =
  /\b(rate.?limit|too many requests|overloaded|ResourceExhausted)\b/i

/**
 * Classify an error message / JSON body from a model provider.
 * Quota exhaustion must not be blindly retried; transient 429/5xx may be.
 */
export function classifyProviderError(message: string): ClassifiedProviderError {
  const rawMessage = String(message ?? '')
  const retryAfterMs = parseRetryAfterMs(rawMessage)
  const provider = parseProviderHint(rawMessage)

  if (QUOTA_CODE_PATTERN.test(rawMessage) || QUOTA_TEXT_PATTERN.test(rawMessage)) {
    return { kind: 'quota_exceeded', provider, retryAfterMs, rawMessage }
  }

  if (/\b429\b/.test(rawMessage) || TRANSIENT_429_WITHOUT_QUOTA.test(rawMessage)) {
    return { kind: 'rate_limit', provider, retryAfterMs, rawMessage }
  }

  if (
    /\b(500|502|503|504|524)\b/.test(rawMessage) ||
    /server.?error|service.?unavailable/i.test(rawMessage)
  ) {
    return { kind: 'transient', provider, retryAfterMs, rawMessage }
  }

  return { kind: 'unknown', provider, retryAfterMs, rawMessage }
}

export function isQuotaExhaustedError(message: string): boolean {
  return classifyProviderError(message).kind === 'quota_exceeded'
}

/** Outer / blind retries should not continue for account quota exhaustion. */
export function shouldBlindRetryProviderError(message: string): boolean {
  const kind = classifyProviderError(message).kind
  return kind === 'rate_limit' || kind === 'transient'
}

/** Map classifier output onto AgentEvent.error.kind (IPC additive field). */
export function toAgentErrorKind(kind: ProviderErrorKind): 'quota' | 'transient' | 'other' {
  if (kind === 'quota_exceeded') return 'quota'
  if (kind === 'rate_limit' || kind === 'transient') return 'transient'
  return 'other'
}

export function buildQuotaResetHint(
  retryAfterMs: number | undefined,
  locale: 'zh' | 'en' = 'en'
): string {
  return formatRetryAfterLabel(retryAfterMs, locale)
}

export function parseRetryAfterMs(message: string): number | undefined {
  const header = message.match(/retry-after(?:-ms)?\s*[:=]\s*["']?(\d+)/i)
  if (header) {
    const value = Number(header[1])
    if (!Number.isFinite(value) || value <= 0) return undefined
    // Heuristic: values under 1000 without -ms are seconds (HTTP Retry-After).
    if (/retry-after-ms/i.test(header[0]) || value >= 1000) return Math.round(value)
    return Math.round(value * 1000)
  }

  const jsonMs = message.match(/"retry(?:After|AfterMs|_after|_after_ms)"\s*:\s*(\d+)/i)
  if (jsonMs) {
    const value = Number(jsonMs[1])
    if (!Number.isFinite(value) || value <= 0) return undefined
    return value < 1000 ? Math.round(value * 1000) : Math.round(value)
  }

  const minutes = message.match(/(?:in|after|within)\s+(\d+)\s*(?:minutes?|mins?|分钟)/i)
  if (minutes) {
    const value = Number(minutes[1])
    if (Number.isFinite(value) && value > 0) return Math.round(value * 60_000)
  }

  return undefined
}

export function formatRetryAfterLabel(
  retryAfterMs: number | undefined,
  locale: 'zh' | 'en'
): string {
  if (retryAfterMs == null || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return locale === 'zh' ? '稍后' : 'shortly'
  }
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return locale === 'zh' ? `约 ${minutes} 分钟后` : `in about ${minutes} min`
}

/** Short status line while waiting (no raw JSON). */
export function formatQuotaWaitingStatus(
  classified: ClassifiedProviderError,
  locale: 'zh' | 'en'
): string {
  const reset = formatRetryAfterLabel(classified.retryAfterMs, locale)
  return locale === 'zh' ? `等待配额恢复… 预计 ${reset}` : `Waiting for quota reset… ${reset}`
}

/** Collapse huge JSON bodies for transient Retrying status lines. */
export function summarizeProviderErrorForStatus(message: string, maxLen = 120): string {
  const trimmed = message.trim().replace(/\s+/g, ' ')
  if (isQuotaExhaustedError(trimmed)) {
    return 'AccountQuotaExceeded'
  }
  const code = trimmed.match(/"code"\s*:\s*"([^"]+)"/i)?.[1]
  const type = trimmed.match(/"type"\s*:\s*"([^"]+)"/i)?.[1]
  const status = trimmed.match(/\b([45]\d\d)\b/)?.[1]
  const parts = [status, type || code].filter(Boolean)
  if (parts.length > 0) {
    const summary = parts.join(' ')
    return summary.length > maxLen ? `${summary.slice(0, maxLen - 1)}…` : summary
  }
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen - 1)}…`
}

function parseProviderHint(message: string): string | undefined {
  const fromPath = message.match(/\b(?:Using|provider)[/:\s]+([a-z0-9._-]+)/i)
  if (fromPath?.[1]) return fromPath[1]
  const fromJson = message.match(/"provider"\s*:\s*"([^"]+)"/i)
  if (fromJson?.[1]) return fromJson[1]
  if (/deepseek|方舟|ark/i.test(message)) return 'DeepSeek'
  if (/openai/i.test(message)) return 'OpenAI'
  if (/anthropic|claude/i.test(message)) return 'Anthropic'
  return undefined
}
