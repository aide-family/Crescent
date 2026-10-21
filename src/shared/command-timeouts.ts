export interface CommandTimeoutPolicy {
  startMs: number
  idleMs: number
  executionMs: number
  approvalMs: number
}
export function normalizeCommandTimeoutPolicy(
  value?: Partial<CommandTimeoutPolicy>
): CommandTimeoutPolicy {
  const clamp = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback
  return {
    startMs: clamp(value?.startMs, 30000, 1000, 60000),
    idleMs: clamp(value?.idleMs, 30000, 1000, 600000),
    executionMs: clamp(value?.executionMs, 120000, 60000, 600000),
    approvalMs: clamp(value?.approvalMs, 60000, 5000, 600000)
  }
}
