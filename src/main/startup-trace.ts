export function startupTraceEnabled(): boolean {
  return process.env.CRESCENT_STARTUP_TRACE === '1'
}

export function traceStartup(label: string, startMs?: number): number {
  const now = performance.now()
  if (startupTraceEnabled()) {
    if (startMs !== undefined) {
      console.info(`[startup-trace] ${label} +${(now - startMs).toFixed(1)}ms`)
    } else {
      console.info(`[startup-trace] ${label}`)
    }
  }
  return now
}
