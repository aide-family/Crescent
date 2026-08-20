export type ComposerRefKind = 'wiki' | 'skill' | 'tool' | 'path'

export type ComposerSegment =
  | { type: 'text'; value: string }
  | { type: 'ref'; kind: ComposerRefKind; id: string }

export const COMPOSER_REF_TOKEN_RE = /\{\{@(wiki|skill|tool|path):([^}]+)\}\}/g

export function formatComposerRefToken(kind: ComposerRefKind, id: string): string {
  return `{{@${kind}:${id}}}`
}

export function hasComposerRefTokens(value: string): boolean {
  COMPOSER_REF_TOKEN_RE.lastIndex = 0
  return COMPOSER_REF_TOKEN_RE.test(value)
}

export type ComposerInlinePart =
  | { type: 'text'; value: string }
  | { type: 'br' }
  | { type: 'ref'; kind: ComposerRefKind; id: string }

/** Flatten tokens so chips, text, and explicit newlines can render in one inline flow. */
export function flattenComposerSegmentsForInline(value: string): ComposerInlinePart[] {
  const parts: ComposerInlinePart[] = []
  for (const segment of parseComposerSegments(value)) {
    if (segment.type === 'ref') {
      parts.push(segment)
      continue
    }
    const lines = segment.value.split('\n')
    lines.forEach((line, index) => {
      if (index > 0) parts.push({ type: 'br' })
      if (line) parts.push({ type: 'text', value: line })
    })
  }
  return parts
}

export function parseComposerSegments(value: string): ComposerSegment[] {
  const segments: ComposerSegment[] = []
  const pattern = /\{\{@(wiki|skill|tool|path):([^}]+)\}\}/g
  let lastIndex = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ type: 'text', value: value.slice(lastIndex, index) })
    }
    segments.push({
      type: 'ref',
      kind: match[1] as ComposerRefKind,
      id: match[2]
    })
    lastIndex = index + match[0].length
  }
  segments.push({ type: 'text', value: value.slice(lastIndex) })
  return segments
}

export function serializeComposerSegments(segments: ComposerSegment[]): string {
  return segments
    .map((segment) =>
      segment.type === 'text' ? segment.value : formatComposerRefToken(segment.kind, segment.id)
    )
    .join('')
}

export function stripComposerRefTokens(value: string): string {
  return value
    .replace(/\{\{@(wiki|skill|tool|path):([^}]+)\}\}/g, ' ')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n[^\S\n]+/g, '\n')
    .trim()
}

export function collectComposerRefIds(value: string): Record<ComposerRefKind, Set<string>> {
  const ids: Record<ComposerRefKind, Set<string>> = {
    wiki: new Set(),
    skill: new Set(),
    tool: new Set(),
    path: new Set()
  }
  for (const segment of parseComposerSegments(value)) {
    if (segment.type === 'ref') ids[segment.kind].add(segment.id)
  }
  return ids
}

export function removeComposerRefToken(value: string, kind: ComposerRefKind, id: string): string {
  const token = formatComposerRefToken(kind, id)
  let next = value
  while (next.includes(token)) {
    const index = next.indexOf(token)
    next = spliceComposerRange(next, index, index + token.length).value
  }
  return next
}

export function findComposerRefRanges(value: string): Array<{
  start: number
  end: number
  kind: ComposerRefKind
  id: string
}> {
  return [...value.matchAll(/\{\{@(wiki|skill|tool|path):([^}]+)\}\}/g)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    kind: match[1] as ComposerRefKind,
    id: match[2]
  }))
}

export function deleteAdjacentComposerRef(
  value: string,
  cursor: number,
  direction: 'backward' | 'forward'
): { value: string; cursor: number } | null {
  const ranges = findComposerRefRanges(value)
  const target =
    direction === 'backward'
      ? [...ranges]
          .reverse()
          .find((range) => range.end <= cursor && !value.slice(range.end, cursor).trim())
      : ranges.find((range) => range.start >= cursor && !value.slice(cursor, range.start).trim())
  if (!target) return null
  return spliceComposerRange(value, target.start, target.end)
}

export function insertComposerRefTokenAt(
  value: string,
  cursor: number,
  kind: ComposerRefKind,
  id: string
): string {
  const token = formatComposerRefToken(kind, id)
  const before = value.slice(0, cursor).replace(/[ \t]+$/, '')
  const after = value.slice(cursor).replace(/^[ \t]+/, '')
  const left = before && !/\s$/.test(before) ? `${before} ` : before
  const right = after ? (/^\s/.test(after) ? after : ` ${after}`) : ' '
  return `${left}${token}${right}`
}

/** Caret after a newly inserted chip (past trailing spaces), or null if none was added. */
export function caretAfterInsertedRef(previous: string, next: string): number | null {
  const prevRanges = findComposerRefRanges(previous)
  const nextRanges = findComposerRefRanges(next)
  if (nextRanges.length <= prevRanges.length) return null
  const prevKeys = new Set(prevRanges.map((range) => `${range.kind}:${range.id}`))
  const inserted =
    nextRanges.find((range) => !prevKeys.has(`${range.kind}:${range.id}`)) ?? nextRanges.at(-1)
  if (!inserted) return null
  let caret = inserted.end
  while (caret < next.length && (next[caret] === ' ' || next[caret] === '\t')) caret += 1
  return caret
}

/** Caret after a parent-driven composer update (slash prefix or chip). */
export function caretAfterProgrammaticValueChange(previous: string, next: string): number {
  return caretAfterInsertedRef(previous, next) ?? next.length
}

/** Map a serialized caret onto a text field, snapping chip interiors to the following field. */
export function resolveComposerTextCaret(
  value: string,
  cursor: number
): { textIndex: number; local: number } {
  const segments = parseComposerSegments(value)
  const clamped = Math.max(0, Math.min(cursor, value.length))
  let offset = 0
  let textIndex = 0
  for (const segment of segments) {
    if (segment.type === 'text') {
      const end = offset + segment.value.length
      if (clamped <= end) {
        return {
          textIndex,
          local: Math.max(0, Math.min(segment.value.length, clamped - offset))
        }
      }
      offset = end
      textIndex += 1
      continue
    }
    const tokenEnd = offset + formatComposerRefToken(segment.kind, segment.id).length
    if (clamped < tokenEnd) {
      offset = tokenEnd
      continue
    }
    offset = tokenEnd
  }
  const lastIndex = Math.max(0, textIndex - 1)
  const lastText = [...segments].reverse().find((segment) => segment.type === 'text')
  return { textIndex: lastIndex, local: lastText?.type === 'text' ? lastText.value.length : 0 }
}

function spliceComposerRange(
  value: string,
  start: number,
  end: number
): { value: string; cursor: number } {
  const left = value.slice(0, start)
  let right = value.slice(end)
  if (/[ \t]$/.test(left) && /^[ \t]/.test(right)) {
    right = right.replace(/^[ \t]+/, '')
  }
  return { value: left + right, cursor: left.length }
}
