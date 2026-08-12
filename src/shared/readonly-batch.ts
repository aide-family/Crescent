import { isStaticallyReadonly } from './command-guard'

/** Rare marker injected between readonly segments so PTY output can be split. */
export const CRES_BATCH_SEP = '###CRES_BATCH_SEP###'

const BATCH_HEADER = /^\[Crescent batch: (\d+) readonly commands\]$/
const BATCH_COMMAND_LINE = /^--- command (\d+)\/(\d+): (.+) ---$/
// Built via String.fromCharCode to avoid no-control-regex on ESC/BEL literals.
const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(0x1b)}(?:\\[[0-9;?]*[ -/]*[@-~]|[\\]PX^_][^${String.fromCharCode(0x07)}]*(?:${String.fromCharCode(0x07)}|${String.fromCharCode(0x1b)}\\\\)|.)`,
  'g'
)

export interface ReadonlyBatchPlan {
  inject: boolean
  segments: string[]
  ptyCommand: string
  reason: 'single' | 'not-readonly' | 'segment-not-readonly' | 'ok'
}

export interface BatchedCommandPart {
  command: string
  output: string
  index: number
  total: number
}

/**
 * Quote-aware split on `;`, `&&`, and newlines.
 * Separators inside single/double quotes, `$(...)` (nested paren depth),
 * and backticks (toggle, non-nesting) are preserved.
 *
 * Security dossier (HIGH anchoring):
 * `command-guard` HIGH is unanchored (no `^`/`$`); it substring-matches with `\b`.
 * `classifyByStaticRules` / `isStaticallyReadonly` call `HIGH.test(cmd)` on the raw
 * string (not after `normalizeCommand`). Example: `echo $(kubectl delete pod x)` still
 * hits HIGH via the `kubectl … delete` substring — both raw and after normalize
 * (tokens keep `$(kubectl` / `x)`). Keeping substitution as one segment therefore does
 * not weaken HIGH detection; the whole script stays `high` and `planReadonlyBatch`
 * will not inject separators.
 */
export function splitShellSegments(script: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escape = false
  let inBacktick = false
  let substDepth = 0

  const push = (): void => {
    const trimmed = current.trim()
    if (trimmed) segments.push(trimmed)
    current = ''
  }

  for (let i = 0; i < script.length; i++) {
    const ch = script[i]

    if (escape) {
      current += ch
      escape = false
      continue
    }

    if (quote === '"' && ch === '\\') {
      current += ch
      escape = true
      continue
    }

    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }

    if (ch === '`') {
      inBacktick = !inBacktick
      current += ch
      continue
    }

    if (!inBacktick && ch === '$' && script[i + 1] === '(') {
      substDepth += 1
      current += '$('
      i += 1
      continue
    }

    if (substDepth > 0 && ch === '(') {
      substDepth += 1
      current += ch
      continue
    }

    if (substDepth > 0 && ch === ')') {
      substDepth -= 1
      current += ch
      continue
    }

    if (substDepth > 0 || inBacktick) {
      current += ch
      continue
    }

    if (ch === '\n' || ch === '\r') {
      push()
      continue
    }

    if (ch === ';') {
      push()
      continue
    }

    if (ch === '&' && script[i + 1] === '&') {
      push()
      i += 1
      continue
    }

    current += ch
  }

  push()
  return segments
}

export function injectBatchSeparators(segments: string[]): string {
  return segments.map((segment) => `${segment}; echo "${CRES_BATCH_SEP}"`).join('; ')
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

export function splitBatchOutput(raw: string): string[] {
  const cleaned = stripAnsi(raw)
  if (!cleaned.includes(CRES_BATCH_SEP)) return [cleaned]
  return cleaned.split(CRES_BATCH_SEP).map((part) => part.replace(/^\s+|\s+$/g, ''))
}

export function formatBatchedToolOutput(segments: string[], parts: string[]): string {
  const lines: string[] = [`[Crescent batch: ${segments.length} readonly commands]`]
  for (let i = 0; i < segments.length; i++) {
    const output = parts[i] ?? ''
    lines.push(`--- command ${i + 1}/${segments.length}: ${segments[i]} ---`)
    lines.push(output || '(no output)')
  }
  if (parts.length > segments.length) {
    const trailing = parts.slice(segments.length).join('\n').trim()
    if (trailing) {
      lines.push('--- trailing output ---')
      lines.push(trailing)
    }
  }
  return lines.join('\n')
}

/** Parse formatted batch tool output back into command/output pairs (for Timeline UI). */
export function parseBatchedToolOutput(text: string): BatchedCommandPart[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[Crescent batch:')) return null
  const lines = trimmed.split('\n')
  if (!BATCH_HEADER.test(lines[0] ?? '')) return null

  const parts: BatchedCommandPart[] = []
  let i = 1
  while (i < lines.length) {
    const match = lines[i]?.match(BATCH_COMMAND_LINE)
    if (!match) {
      i += 1
      continue
    }
    const index = Number(match[1])
    const total = Number(match[2])
    const command = match[3]
    i += 1
    const outputLines: string[] = []
    while (
      i < lines.length &&
      !BATCH_COMMAND_LINE.test(lines[i] ?? '') &&
      lines[i] !== '--- trailing output ---'
    ) {
      outputLines.push(lines[i] ?? '')
      i += 1
    }
    const output = outputLines.join('\n').replace(/^\n+|\n+$/g, '')
    parts.push({
      command,
      output: output === '(no output)' ? '' : output,
      index,
      total
    })
  }
  return parts.length > 0 ? parts : null
}

/**
 * Decide whether a script may receive separator injection.
 * Only statically readonly wholes + every segment readonly + n > 1.
 */
export function planReadonlyBatch(script: string): ReadonlyBatchPlan {
  if (!isStaticallyReadonly(script)) {
    return {
      inject: false,
      segments: [script],
      ptyCommand: script,
      reason: 'not-readonly'
    }
  }

  const segments = splitShellSegments(script)
  if (segments.length <= 1) {
    return {
      inject: false,
      segments,
      ptyCommand: script,
      reason: 'single'
    }
  }

  for (const segment of segments) {
    if (!isStaticallyReadonly(segment)) {
      return {
        inject: false,
        segments,
        ptyCommand: script,
        reason: 'segment-not-readonly'
      }
    }
  }

  return {
    inject: true,
    segments,
    ptyCommand: injectBatchSeparators(segments),
    reason: 'ok'
  }
}

export function applyBatchOutputFormatting(
  plan: ReadonlyBatchPlan,
  output: string
): { formatted: string; parts: string[] } {
  if (!plan.inject) {
    return { formatted: output, parts: [output] }
  }
  const parts = splitBatchOutput(output)
  return {
    formatted: formatBatchedToolOutput(plan.segments, parts),
    parts
  }
}
