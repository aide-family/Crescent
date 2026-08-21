import type { AgentRunTrace, CaptureScope } from './agent-types'

export const CAPTURE_TRANSCRIPT_MAX_CHARS = 80_000
export const CAPTURE_STDOUT_MAX_CHARS = 2_000

export function formatCaptureTranscript(input: {
  traces: AgentRunTrace[]
  seedText?: string
  scope?: CaptureScope
}): string {
  const scope = input.scope ?? 'session'
  const traces = scope === 'turn' ? input.traces.slice(-1) : input.traces
  const seed = input.seedText?.trim() ?? ''
  if (traces.length === 0 && !seed) return ''

  const parts: string[] = []
  if (seed) {
    parts.push('# Operator seed', seed, '')
  }

  traces.forEach((trace, index) => {
    parts.push(`# Turn ${index + 1}`)
    parts.push('## User')
    parts.push(trace.input.trim() || '(none)')
    parts.push('')
    parts.push('## Commands')
    if (trace.steps.length === 0) {
      parts.push('(none)')
    } else {
      for (const step of trace.steps) {
        const title = step.title.trim() || `Step ${step.index}`
        parts.push(`### ${step.index}. ${title}`)
        const detail = truncateStdout(step.detail.trim())
        if (detail) parts.push(detail)
      }
    }
    parts.push('')
    parts.push('## Result')
    parts.push(trace.resultSummary?.trim() || '(none)')
    if (trace.error?.trim()) {
      parts.push('')
      parts.push('## Error')
      parts.push(trace.error.trim())
    }
    parts.push('')
  })

  let text = parts.join('\n').trim()
  if (text.length > CAPTURE_TRANSCRIPT_MAX_CHARS) {
    text = `${text.slice(0, CAPTURE_TRANSCRIPT_MAX_CHARS)}…`
  }
  return text
}

export function mergeCaptureTraces(
  stored: AgentRunTrace[],
  live: AgentRunTrace[]
): AgentRunTrace[] {
  const byId = new Map<string, AgentRunTrace>()
  for (const trace of stored) {
    if (trace.runId) byId.set(trace.runId, trace)
  }
  for (const trace of live) {
    if (trace.runId) byId.set(trace.runId, trace)
  }
  const leftover = stored.filter((trace) => !trace.runId)
  return [...leftover, ...byId.values()]
}

function truncateStdout(detail: string): string {
  if (detail.length <= CAPTURE_STDOUT_MAX_CHARS) return detail
  return `${detail.slice(0, CAPTURE_STDOUT_MAX_CHARS)}…`
}
