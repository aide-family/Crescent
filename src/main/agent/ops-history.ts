export function buildOpsFeedbackSummarizeSource(input: {
  input: string
  output?: string
  summary?: string
  trace?: { resultSummary?: string }
}): string {
  return [
    input.summary?.trim() ? `Summary: ${input.summary.trim()}` : '',
    input.trace?.resultSummary?.trim() ? `Result: ${input.trace.resultSummary.trim()}` : '',
    `Input: ${input.input.trim()}`,
    input.output?.trim() ? `Output:\n${input.output.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function parseOpsFeedbackSummary(
  content: string
): { pathSummary: string; lesson: string } | undefined {
  const text = content.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as { pathSummary?: string; lesson?: string; summary?: string }
    const pathSummary = (parsed.pathSummary || parsed.summary || '').trim()
    const lesson = (parsed.lesson || '').trim()
    if (pathSummary && lesson) return { pathSummary, lesson }
    if (pathSummary) return { pathSummary, lesson: pathSummary }
  } catch {
    // fall through
  }
  return undefined
}
