import type {
  AgentCommitCaptureDraftInput,
  AgentCommitCaptureDraftResult,
  AgentConfig,
  AgentGenerateCaptureDraftInput,
  AgentGenerateCaptureDraftResult
} from './types'
import { generateSopFromSummary, type SopChatFn } from './generate-sop'
import { generateSkillFromSummary } from './generate-skill'
import { createAgentSkill } from './skills'
import { saveWikiDocument } from './wiki'

const CAPTURE_TIMEOUT_MIN_MS = 1_000
const CAPTURE_TIMEOUT_MAX_MS = 10 * 60_000

export function normalizeCaptureTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.min(Math.max(Math.floor(value), CAPTURE_TIMEOUT_MIN_MS), CAPTURE_TIMEOUT_MAX_MS)
}

export async function generateCaptureDraft(
  input: AgentGenerateCaptureDraftInput,
  options?: {
    config?: AgentConfig
    chat?: SopChatFn
    timeoutMs?: number
  }
): Promise<AgentGenerateCaptureDraftResult> {
  const kind = input.kind === 'skill' ? 'skill' : 'sop'
  const summary = input.summary?.trim() ?? ''
  if (!summary) {
    return { ok: false, kind, error: 'Summary is empty.' }
  }

  const timeoutMs = options?.timeoutMs ?? normalizeCaptureTimeoutMs(input.timeoutMs)
  const generateOptions = timeoutMs == null ? options : { ...options, timeoutMs }

  if (kind === 'skill') {
    const generated = await generateSkillFromSummary(
      {
        summary,
        locale: input.locale,
        draft: input.draft,
        notes: input.notes
      },
      generateOptions
    )
    return {
      ok: generated.ok,
      kind,
      title: generated.title,
      content: generated.content,
      skillName: generated.skillName,
      generated: generated.generated,
      error: generated.error,
      timedOut: generated.timedOut
    }
  }

  const generated = await generateSopFromSummary(
    {
      summary,
      locale: input.locale,
      draft: input.draft,
      notes: input.notes
    },
    generateOptions
  )
  return {
    ok: generated.ok,
    kind,
    title: generated.title,
    content: generated.content,
    generated: generated.generated,
    error: generated.error,
    timedOut: generated.timedOut
  }
}

export async function commitCaptureDraft(
  input: AgentCommitCaptureDraftInput,
  options?: { skillRoot?: string }
): Promise<AgentCommitCaptureDraftResult> {
  const kind = input.kind === 'skill' ? 'skill' : 'sop'
  const title = input.title?.trim() ?? ''
  const content = input.content?.trim() ?? ''
  if (!content) {
    return { ok: false, kind, error: 'Draft content is empty.' }
  }

  if (kind === 'skill') {
    const created = createAgentSkill({
      name: input.skillName || title,
      content,
      skillRoot: options?.skillRoot,
      overwrite: Boolean(input.overwrite)
    })
    if (created.conflict) {
      return {
        ok: false,
        kind,
        conflict: true,
        existingPath: created.existingPath,
        skillName: created.skillName,
        error: 'A skill with this name already exists.'
      }
    }
    if (!created.ok) {
      return { ok: false, kind, error: created.error }
    }
    return {
      ok: true,
      kind,
      title: created.skill.name,
      content,
      skill: created.skill,
      skillName: created.skill.name
    }
  }

  const document = await saveWikiDocument({ title: title || 'SOP', content })
  return {
    ok: true,
    kind,
    title: document.title,
    content: document.content,
    document
  }
}
