import type { SessionTokenUsage } from './agent-types'

export const EMPTY_SESSION_TOKEN_USAGE: SessionTokenUsage = { input: 0, output: 0 }

export function snapshotSessionTokenUsage(value: unknown): SessionTokenUsage {
  if (!value || typeof value !== 'object') return { ...EMPTY_SESSION_TOKEN_USAGE }

  const tokens =
    'tokens' in value && value.tokens && typeof value.tokens === 'object'
      ? (value.tokens as Record<string, unknown>)
      : (value as Record<string, unknown>)

  return {
    input: readNonNegativeInt(tokens.input),
    output: readNonNegativeInt(tokens.output)
  }
}

export function diffSessionTokenUsage(
  before: SessionTokenUsage,
  after: SessionTokenUsage
): SessionTokenUsage {
  return {
    input: Math.max(0, after.input - before.input),
    output: Math.max(0, after.output - before.output)
  }
}

export function addSessionTokenUsage(
  base: SessionTokenUsage,
  delta: SessionTokenUsage
): SessionTokenUsage {
  return {
    input: base.input + delta.input,
    output: base.output + delta.output
  }
}

export function formatCompactTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return formatCompactScaled(value / 1000, 'k')
  return formatCompactScaled(value / 1_000_000, 'M')
}

function formatCompactScaled(scaled: number, suffix: 'k' | 'M'): string {
  const digits = scaled >= 100 ? 0 : 1
  const text = scaled.toFixed(digits).replace(/\.0$/, '')
  return `${text}${suffix}`
}

function readNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.round(value)
}
