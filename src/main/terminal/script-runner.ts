/**
 * Keep every physical PTY input line below the canonical line-buffer limit
 * (macOS commonly uses 1024 bytes). Prefer atomic one-liners so each NL is a
 * complete statement — no deferred `{ … }` compound and no multi-line quotes.
 */

export const PTY_SCRIPT_RUNNER_CHUNK_SIZE = 256

/** Base idle wait for the execution start marker (ms). */
export const TERMINAL_COMMAND_START_TIMEOUT_BASE_MS = 8_000
/** Cap for payload-scaled idle start timeout (ms). */
export const TERMINAL_COMMAND_START_TIMEOUT_MAX_MS = 60_000
/** Extra idle ms per payload byte when scaling the start timeout. */
export const TERMINAL_COMMAND_START_TIMEOUT_MS_PER_BYTE = 2
/** Floor for the absolute start deadline from write (ms). */
export const TERMINAL_COMMAND_START_DEADLINE_FLOOR_MS = 120_000

export interface PtyScriptRunner {
  payload: string
  byteLength: number
}

/** Idle start budget: clamp(8000 + byteLength * 2, 8000, 60000). */
export function resolveCommandStartTimeoutMs(byteLength: number): number {
  const scaled =
    TERMINAL_COMMAND_START_TIMEOUT_BASE_MS +
    Math.max(0, byteLength) * TERMINAL_COMMAND_START_TIMEOUT_MS_PER_BYTE
  return Math.min(
    TERMINAL_COMMAND_START_TIMEOUT_MAX_MS,
    Math.max(TERMINAL_COMMAND_START_TIMEOUT_BASE_MS, scaled)
  )
}

/** Absolute wall-clock cap so idle-reset cannot stretch forever. */
export function resolveCommandStartDeadlineMs(startTimeoutMs: number): number {
  return Math.max(TERMINAL_COMMAND_START_DEADLINE_FLOOR_MS, startTimeoutMs * 3)
}

/**
 * Build a PTY bootstrap that decodes `script` via base64 and sources it.
 * Each physical line is a complete statement terminated with `\n` (canonical EOL).
 */
export function createPtyScriptRunner(script: string): PtyScriptRunner {
  const encoded = Buffer.from(script, 'utf8').toString('base64')
  const chunks = encoded.match(new RegExp(`.{1,${PTY_SCRIPT_RUNNER_CHUNK_SIZE}}`, 'g')) ?? ['']
  const lines: string[] = [
    `__crescent_encoded=''`,
    ...chunks.map((chunk) => `__crescent_encoded+='${chunk}'`),
    `__crescent_script=$(mktemp "\${TMPDIR:-/tmp}/crescent.XXXXXX")`,
    `{ printf %s "$__crescent_encoded" | base64 -d > "$__crescent_script" 2>/dev/null || printf %s "$__crescent_encoded" | base64 -D > "$__crescent_script"; }`,
    `. "$__crescent_script"`,
    `rm -f "$__crescent_script"; stty echo 2>/dev/null; unset __crescent_script __crescent_encoded __crescent_status`
  ]

  const payload = lines.map((line) => `${line}\n`).join('')
  return { payload, byteLength: Buffer.byteLength(payload, 'utf8') }
}
