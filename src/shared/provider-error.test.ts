import { describe, expect, it } from 'vitest'

import {
  buildQuotaResetHint,
  classifyProviderError,
  formatQuotaWaitingStatus,
  isQuotaExhaustedError,
  parseRetryAfterMs,
  shouldBlindRetryProviderError,
  summarizeProviderErrorForStatus,
  toAgentErrorKind
} from './provider-error'

describe('classifyProviderError', () => {
  it('treats AccountQuotaExceeded 429 as quota_exceeded (not blind retry)', () => {
    const message =
      '429: {"code":"AccountQuotaExceeded","message":"You have reached your API usage limit","type":"Limit"}'
    const classified = classifyProviderError(message)
    expect(classified.kind).toBe('quota_exceeded')
    expect(isQuotaExhaustedError(message)).toBe(true)
    expect(shouldBlindRetryProviderError(message)).toBe(false)
    expect(toAgentErrorKind(classified.kind)).toBe('quota')
  })

  it('treats spaced "quota exceeded" and insufficient_quota as quota', () => {
    expect(classifyProviderError('Error: quota exceeded for this account').kind).toBe(
      'quota_exceeded'
    )
    expect(classifyProviderError('{"code":"insufficient_quota"}').kind).toBe('quota_exceeded')
    expect(shouldBlindRetryProviderError('insufficient_quota')).toBe(false)
  })

  it('keeps ordinary rate-limit 429 as retryable transient', () => {
    const message = '429 rate limit: Too Many Requests'
    const classified = classifyProviderError(message)
    expect(classified.kind).toBe('rate_limit')
    expect(shouldBlindRetryProviderError(message)).toBe(true)
    expect(toAgentErrorKind(classified.kind)).toBe('transient')
  })

  it('keeps rate_limit_exceeded JSON 429 as retryable', () => {
    const message = '429: {"message":"Too Many Requests","type":"rate_limit_exceeded"}'
    expect(classifyProviderError(message).kind).toBe('rate_limit')
    expect(shouldBlindRetryProviderError(message)).toBe(true)
  })

  it('treats 5xx as transient retryable', () => {
    expect(classifyProviderError('503: service unavailable').kind).toBe('transient')
    expect(shouldBlindRetryProviderError('502 Bad Gateway')).toBe(true)
  })

  it('parses Retry-After seconds and formats waiting status', () => {
    const message = '429 AccountQuotaExceeded retry-after: 300'
    expect(parseRetryAfterMs(message)).toBe(300_000)
    const classified = classifyProviderError(message)
    expect(formatQuotaWaitingStatus(classified, 'zh')).toContain('等待配额恢复')
    expect(formatQuotaWaitingStatus(classified, 'en')).toContain('Waiting for quota')
    expect(buildQuotaResetHint(300_000, 'zh')).toContain('分钟')
  })

  it('summarizes JSON for status without dumping the body', () => {
    const summary = summarizeProviderErrorForStatus(
      'Retrying (1/2): 429: {"code":"AccountQuotaExceeded","message":"long body…"}'
    )
    expect(summary).toBe('AccountQuotaExceeded')
    expect(summary).not.toContain('{')
  })
})
