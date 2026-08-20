import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

import { getCrescentLogsDir } from './crescent-paths'
import {
  normalizeSystemLogLevel,
  shouldRecordLogLevel,
  type SystemLogLevel
} from '../shared/log-levels'

export type { SystemLogLevel } from '../shared/log-levels'

const LOG_PREFIX = 'crescent-'
const LOG_SUFFIX = '.log'
const LOG_FILE_NAME_RE = /^crescent-(\d{4}-\d{2}-\d{2})\.log$/
/** Keep today plus the previous two daily files; anything older is removed. */
const RETENTION_DAYS = 3

let currentDay = ''
let currentFilePath = ''
let logThreshold: SystemLogLevel = 'info'

/** Change the minimum level recorded to the daily log file (runtime switch). */
export function setSystemLogLevel(level: SystemLogLevel): void {
  const next = normalizeSystemLogLevel(level, logThreshold)
  if (next === logThreshold) return
  logThreshold = next
  if (shouldRecordLogLevel('info', logThreshold)) {
    writeSystemLog('info', `system log level changed to ${next}`)
  }
}

export function getSystemLogLevel(): SystemLogLevel {
  return logThreshold
}

function dayStamp(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLogLine(level: SystemLogLevel, message: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`
}

/**
 * Remove daily log files older than the retention window. Returns how many
 * files were deleted. Safe to call on every rotation; never throws.
 */
export function cleanupExpiredLogs(dir = getCrescentLogsDir()): number {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (RETENTION_DAYS - 1))
  cutoff.setHours(0, 0, 0, 0)
  const cutoffMs = cutoff.getTime()

  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }

  let removed = 0
  for (const entry of entries) {
    const match = LOG_FILE_NAME_RE.exec(entry)
    if (!match) continue
    const fileDate = new Date(`${match[1]}T00:00:00`)
    if (Number.isNaN(fileDate.getTime())) continue
    if (fileDate.getTime() >= cutoffMs) continue
    try {
      rmSync(join(dir, entry), { force: true })
      removed += 1
    } catch {
      // A locked/read-only file must not block rotation.
    }
  }
  return removed
}

/** Append one line to today's log file, creating/rotating files as needed. */
export function writeSystemLog(level: SystemLogLevel, message: string): void {
  try {
    const dir = getCrescentLogsDir()
    mkdirSync(dir, { recursive: true })
    const day = dayStamp()
    if (day !== currentDay) {
      currentDay = day
      currentFilePath = join(dir, `${LOG_PREFIX}${day}${LOG_SUFFIX}`)
      cleanupExpiredLogs(dir)
    }
    appendFileSync(currentFilePath, formatLogLine(level, message), 'utf8')
  } catch {
    // Logging must never take the app down.
  }
}

/** Path of the current daily log file (empty until the first write). */
export function getCurrentLogFilePath(): string {
  return currentFilePath
}

/**
 * Install the system logger: mirror every main-process console call into
 * `~/.crescent/logs/crescent-YYYY-MM-DD.log` and capture fatal process errors.
 * Call once at startup, before other modules start logging.
 */
export function initSystemLogging(): void {
  const envLevel = process.env.CRESCENT_LOG_LEVEL?.trim()
  if (envLevel) {
    logThreshold = normalizeSystemLogLevel(envLevel)
  }

  const originalConsole = {
    debug: console.debug.bind(console),
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  const capture =
    (level: SystemLogLevel, original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      original(...args)
      const text = args
        .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
        .join(' ')
      if (text && shouldRecordLogLevel(level, logThreshold)) writeSystemLog(level, text)
    }

  console.debug = capture('debug', originalConsole.debug)
  console.log = capture('info', originalConsole.log)
  console.info = capture('info', originalConsole.info)
  console.warn = capture('warn', originalConsole.warn)
  console.error = capture('error', originalConsole.error)

  process.on('uncaughtException', (error: Error) => {
    writeSystemLog('error', `uncaughtException: ${error.stack ?? error.message}`)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason: unknown) => {
    writeSystemLog('error', `unhandledRejection: ${String(reason)}`)
  })

  if (shouldRecordLogLevel('info', logThreshold)) {
    writeSystemLog(
      'info',
      `Crescent started (pid=${process.pid}, platform=${process.platform}, arch=${process.arch})`
    )
  }
}
