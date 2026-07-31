import type { OpsHistoryRecord, StoredAgentRun } from '../../shared/agent-types'

/** Format user-rated ops feedback for agent system prompt injection. */
export function formatOpsHistoryContext(records: OpsHistoryRecord[]): string {
  if (records.length === 0) return ''

  const likes = records.filter((record) => record.rating === 'like')
  const dislikes = records.filter((record) => record.rating === 'dislike')
  const sections: string[] = [
    'User-rated ops feedback for THIS connection/terminal (like/dislike only; unrated runs are not reference material).',
    'Scope is the current SSH connection when connected, otherwise the local terminal.',
    'These are lightweight operational path references and guidance for later work on the same connection/terminal.',
    'They are NOT SOP/wiki documents. Do not create, save, or expand them into knowledge-base SOP pages unless the user explicitly asks.',
    'Use positive examples as preferred patterns when the current goal is similar.',
    'Treat negative examples as cautionary cases: avoid repeating those failed plans or unsafe shortcuts.'
  ]

  if (likes.length > 0) {
    sections.push('## Positive ops paths (preferred references for this connection/terminal)')
    for (const record of likes) {
      sections.push(
        [
          `- User goal: ${record.userGoal}`,
          `  Ops path: ${record.pathSummary}`,
          record.lesson ? `  Why it worked: ${record.lesson}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
  }

  if (dislikes.length > 0) {
    sections.push('## Negative ops paths (avoid on this connection/terminal)')
    for (const record of dislikes) {
      sections.push(
        [
          `- User goal: ${record.userGoal}`,
          `  Failed path: ${record.pathSummary}`,
          record.lesson ? `  Lesson: ${record.lesson}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
  }

  return sections.join('\n')
}

export function buildOpsFeedbackSummarizeSource(run: StoredAgentRun): string {
  const steps =
    run.trace?.steps
      ?.slice(0, 24)
      .map((step) => `${step.index}. ${step.title}\n${step.detail}`.trim())
      .join('\n\n') ?? ''
  const result = (run.output || run.error || run.trace?.resultSummary || '').trim()

  return [
    `User goal:\n${run.input.trim()}`,
    steps ? `Action steps:\n${steps}` : '',
    result ? `Result / error:\n${result.slice(0, 8000)}` : '',
    `Run status: ${run.status}`
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 12000)
}

export function parseOpsFeedbackSummary(content: string):
  | {
      pathSummary: string
      lesson: string
    }
  | undefined {
  try {
    const parsed = JSON.parse(content) as { pathSummary?: unknown; lesson?: unknown }
    const pathSummary = typeof parsed.pathSummary === 'string' ? parsed.pathSummary.trim() : ''
    const lesson = typeof parsed.lesson === 'string' ? parsed.lesson.trim() : ''
    if (pathSummary)
      return { pathSummary: pathSummary.slice(0, 1200), lesson: lesson.slice(0, 600) }
  } catch {
    // fall through
  }

  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return undefined

  return {
    pathSummary: lines[0].slice(0, 1200),
    lesson: lines.slice(1).join(' ').slice(0, 600)
  }
}
