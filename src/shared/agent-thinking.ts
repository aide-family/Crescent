export const AGENT_THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'max'] as const
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number]
export type AgentSamplingParams = Partial<{
  temperature: number
  top_p: number
  top_k: number
  min_p: number
  presence_penalty: number
  frequency_penalty: number
}>
export type AgentSamplingMap = Partial<Record<AgentThinkingLevel, AgentSamplingParams>>
export function normalizeThinkingLevel(value: unknown): AgentThinkingLevel {
  return AGENT_THINKING_LEVELS.find((level) => level === value) ?? 'high'
}
export function normalizeSamplingMap(value: unknown): AgentSamplingMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const limits: Record<keyof AgentSamplingParams, [number, number]> = {
    temperature: [0, 2],
    top_p: [0, 1],
    top_k: [0, 100000],
    min_p: [0, 1],
    presence_penalty: [-2, 2],
    frequency_penalty: [-2, 2]
  }
  const result: AgentSamplingMap = {}
  for (const level of AGENT_THINKING_LEVELS) {
    const params = (value as Record<string, unknown>)[level]
    if (!params || typeof params !== 'object' || Array.isArray(params)) continue
    const normalized: AgentSamplingParams = {}
    for (const key of Object.keys(limits) as (keyof AgentSamplingParams)[]) {
      const n = (params as Record<string, unknown>)[key]
      const [min, max] = limits[key]
      if (
        typeof n === 'number' &&
        Number.isFinite(n) &&
        n >= min &&
        n <= max &&
        (key !== 'top_k' || Number.isInteger(n))
      )
        normalized[key] = n
    }
    if (Object.keys(normalized).length) result[level] = normalized
  }
  return Object.keys(result).length ? result : undefined
}
