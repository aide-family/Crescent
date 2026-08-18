import type { CaptureKind, CaptureScope } from './agent-types'

export interface CaptureIntent {
  kind: CaptureKind
  scope: CaptureScope
  seedText: string
}

const REFERENCE_SLASH = /^\/(?:skill|wiki|tool|mcp|style|ext|connection|file|folder)(?::|\s|$)/i
const HOST_SLASH = /^\/(?:reload|new)(?:\s|$)/i

const SESSION_SCOPE_PATTERN =
  /这次会话|整个会话|整段会话|全部对话|本次会话|this session|whole session|entire (?:session|conversation)|full conversation/i

const SOP_PHRASES: RegExp[] = [
  /\/sop\b/i,
  /存成\s*SOP/i,
  /存为\s*SOP/i,
  /保存到知识库/i,
  /保存到\s*wiki/i,
  /转成\s*SOP/i,
  /转为\s*SOP/i,
  /转换成\s*SOP/i,
  /生成\s*SOP/i,
  /save\s+as\s+sop/i,
  /save\s+to\s+(?:the\s+)?(?:knowledge\s+base|wiki)/i
]

const SKILL_PHRASES: RegExp[] = [
  /\/create-skill\b/i,
  /把.{0,16}流程.{0,12}skill/i,
  /转成\s*skill/i,
  /写成\s*skill/i,
  /转为\s*skill/i,
  /转换成\s*skill/i,
  /生成\s*skill/i,
  /创建\s*skill/i,
  /(?:convert|save)\s+(?:this\s+)?(?:session\s+)?(?:to\s+)?(?:a\s+)?skill/i,
  /create\s+(?:a\s+)?skill\s+from/i
]

const USE_SKILL_PATTERN = /(?:使用|引用|选用|调用)\s*skill|(?:^|\s)use\s+skill\b/i

export function parseCaptureIntent(input: string): CaptureIntent | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  if (REFERENCE_SLASH.test(trimmed) || HOST_SLASH.test(trimmed)) return undefined
  if (USE_SKILL_PATTERN.test(trimmed) && !hasSkillCapturePhrase(trimmed)) return undefined

  const skill = hasSkillCapturePhrase(trimmed)
  const sop = hasSopCapturePhrase(trimmed)
  if (!skill && !sop) return undefined

  const kind: CaptureKind = skill ? 'skill' : 'sop'
  const scope: CaptureScope = SESSION_SCOPE_PATTERN.test(trimmed) ? 'session' : 'turn'
  const seedText = stripCapturePhrases(trimmed, kind)
  return { kind, scope, seedText }
}

export function hasSopCapturePhrase(value: string): boolean {
  return SOP_PHRASES.some((pattern) => pattern.test(value))
}

export function hasSkillCapturePhrase(value: string): boolean {
  return SKILL_PHRASES.some((pattern) => pattern.test(value))
}

function stripCapturePhrases(value: string, kind: CaptureKind): string {
  const phrases = kind === 'skill' ? SKILL_PHRASES : SOP_PHRASES
  let next = value
  for (const pattern of [...phrases, SESSION_SCOPE_PATTERN]) {
    next = next.replace(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'), ' ')
  }
  return next.replace(/\s+/g, ' ').trim()
}
