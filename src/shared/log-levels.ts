/**
 * System log level policy shared by the main-process logger and the settings UI.
 * `off` disables file logging entirely; `debug` records everything.
 */
export type SystemLogLevel = 'off' | 'debug' | 'info' | 'warn' | 'error'

/** UI order, from most verbose to fully disabled. */
export const SYSTEM_LOG_LEVELS: readonly SystemLogLevel[] = [
  'debug',
  'info',
  'warn',
  'error',
  'off'
]

const SYSTEM_LOG_LEVEL_RANK: Record<SystemLogLevel, number> = {
  off: 0,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

export function normalizeSystemLogLevel(
  value: unknown,
  fallback: SystemLogLevel = 'info'
): SystemLogLevel {
  const candidate = String(value ?? '')
    .trim()
    .toLowerCase()
  return (SYSTEM_LOG_LEVELS as readonly string[]).includes(candidate)
    ? (candidate as SystemLogLevel)
    : fallback
}

/** True when a message at `level` should be recorded under `threshold`. */
export function shouldRecordLogLevel(level: SystemLogLevel, threshold: SystemLogLevel): boolean {
  if (threshold === 'off') return false
  if (level === 'off') return false
  return SYSTEM_LOG_LEVEL_RANK[level] >= SYSTEM_LOG_LEVEL_RANK[threshold]
}
