/** Soft cap for streaming step / thinking fragments in UI / live publish. */
export const AGENT_RUN_STREAM_MAX_CHARS = 32 * 1024
/** Soft cap per in-memory log entry text. SQLite may keep longer debounce snapshots. */
export const AGENT_LOG_ENTRY_MAX_CHARS = 64 * 1024
/** Result / error bodies may be longer than streaming fragments; envelope clamp trims steps first. */
export const AGENT_RESULT_MAX_CHARS = 512 * 1024
/** Max steps kept with full text in the live React view. */
export const AGENT_LIVE_RUN_MAX_FULL_STEPS = 40

/**
 * Streaming live-flush policy: RAF only publishes a slim liveRun;
 * agentLog text is rewritten on debounce / non-streaming / run end — never per frame.
 */
export const AGENT_STREAM_LIVE_FLUSH = {
  rewriteAgentLogOnRaf: false,
  persistDebounceMs: 400
} as const

export function clampAgentText(text: string, maxChars = AGENT_LOG_ENTRY_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n\n…[truncated ${omitted} chars]`
}

const AGENT_TEXT_TRUNCATION_MARKER = /…\[truncated \d+ chars\]\s*$/

export function hasAgentTextTruncationMarker(text: string): boolean {
  return AGENT_TEXT_TRUNCATION_MARKER.test(text.trimEnd())
}
