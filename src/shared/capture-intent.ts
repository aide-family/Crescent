import type { CaptureKind, CaptureScope } from './agent-types'

export interface CaptureIntent {
  kind: CaptureKind
  scope: CaptureScope
  seedText: string
}

const REFERENCE_SLASH = /^\/(?:skill|wiki|tool|mcp|style|ext|connection|file|folder)(?::|\s|$)/i
const HOST_SLASH = /^\/(?:reload|new)(?:\s|$)/i

const TURN_SCOPE_PATTERN =
  /本轮|上一轮|这一轮|刚才这轮|this turn|last turn|previous turn|current turn/i

const SESSION_SCOPE_PATTERN =
  /这次会话|整个会话|整段会话|全部对话|本次会话|上述|全部操作|整段|this session|whole session|entire (?:session|conversation)|full conversation/i

const CAPTURE_VERB = '(?:转|存|写|生成|创建|总结|整理|归纳)'

const SOP_PHRASES: RegExp[] = [
  /\/create-sop\b/i,
  /\/sop\b/i,
  /存成\s*SOP/i,
  /存为\s*SOP/i,
  /保存到知识库/i,
  /保存到\s*wiki/i,
  /转成\s*SOP/i,
  /转为\s*SOP/i,
  /转换成\s*SOP/i,
  /生成\s*SOP/i,
  new RegExp(`${CAPTURE_VERB}成?.{0,40}(?:SOP|知识库|wiki)`, 'i'),
  /save\s+as\s+sop/i,
  /save\s+to\s+(?:the\s+)?(?:knowledge\s+base|wiki)/i,
  /(?:save|convert).{0,48}(?:as\s+)?(?:an?\s+)?sop/i,
  /create\s+(?:an?\s+)?sop(?:\s+from)?/i
]

const SKILL_PHRASES: RegExp[] = [
  /\/create-skill\b/i,
  /把.{0,24}(?:会话|对话|流程|操作).{0,16}(?:转|存|写|生成|创建|总结|整理|归纳).{0,40}skill/i,
  /把.{0,16}流程.{0,12}skill/i,
  /存为\s*skill/i,
  /存成\s*skill/i,
  /保存为\s*skill/i,
  /保存成\s*skill/i,
  /转成\s*skill/i,
  /写成\s*skill/i,
  /转为\s*skill/i,
  /转换成\s*skill/i,
  /转换为\s*skill/i,
  /转换成为?\s*skill/i,
  /生成\s*skill/i,
  /创建\s*skill/i,
  /存为\s*技能/i,
  /转成\s*技能/i,
  new RegExp(`${CAPTURE_VERB}成?.{0,40}(?:skill|技能)`, 'i'),
  /save\s+as\s+(?:a\s+)?skill/i,
  /(?:convert|save)\s+(?:this\s+)?(?:session\s+)?(?:to\s+)?(?:a\s+)?skill/i,
  /(?:save|convert).{0,48}(?:as\s+)?(?:a\s+)?skill/i,
  /create\s+(?:a\s+)?skill(?:\s+from)?/i
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
  const scope: CaptureScope = TURN_SCOPE_PATTERN.test(trimmed) ? 'turn' : 'session'
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
  let next = value
  next = next.replace(kind === 'skill' ? /\/create-skill\b/gi : /\/create-sop\b|\/sop\b/gi, ' ')
  next = next.replace(new RegExp(`${CAPTURE_VERB}成?`, 'gi'), ' ')
  next = next.replace(/\b(?:skill|sop|wiki)\b/gi, ' ')
  next = next.replace(/技能|知识库/g, ' ')
  next = next.replace(new RegExp(SESSION_SCOPE_PATTERN.source, 'gi'), ' ')
  next = next.replace(new RegExp(TURN_SCOPE_PATTERN.source, 'gi'), ' ')
  next = next.replace(
    /\b(?:save|convert|create|from|into|as|to|a|an|the|this|session|conversation|turn|knowledge|base)\b/gi,
    ' '
  )
  next = next.replace(/把|将/g, ' ')
  return next.replace(/[,，]/g, ' ').replace(/\s+/g, ' ').trim()
}
