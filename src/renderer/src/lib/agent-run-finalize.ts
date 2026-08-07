import type { AgentRunViewState } from './terminal-tabs'

/** Detect API retry / BadRequest status left on the timeline when the host still returns ok. */
export function findLastRetryFailureDetail(run: AgentRunViewState | undefined): string | undefined {
  if (run?.errorKind === 'quota' && run.error?.trim()) {
    return run.error.trim()
  }
  const steps = run?.steps ?? []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind !== 'status') continue
    const text = [step.title, step.detail].filter(Boolean).join('\n')
    if (/等待配额恢复|Waiting for quota reset|AccountQuotaExceeded/i.test(text)) {
      return (step.detail || step.title || run?.error || '').trim() || undefined
    }
    if (
      /^Retrying\b/i.test(step.title) ||
      /\bInvalidParameter\b/i.test(text) ||
      /\bBadRequest\b/i.test(text) ||
      /\b400:\s*\{/.test(text)
    ) {
      return (step.detail || step.title).trim() || undefined
    }
  }
  return undefined
}

export function isPlaceholderDoneText(text: string | undefined, doneFallback: string): boolean {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return true
  return trimmed === 'Done.' || trimmed === doneFallback
}

/**
 * If the host reports success with only a Done placeholder but the timeline
 * already recorded an API retry/failure, treat the run as failed.
 * Quota exhaustion must not be mis-labeled as a generic Done success.
 */
export function resolveSuccessfulAgentResult(input: {
  text: string | undefined
  run: AgentRunViewState | undefined
  doneFallback: string
}): { ok: true; text: string } | { ok: false; error: string } {
  if (input.run?.errorKind === 'quota' && input.run.error?.trim()) {
    return { ok: false, error: input.run.error.trim() }
  }
  const failure = findLastRetryFailureDetail(input.run)
  if (failure && isPlaceholderDoneText(input.text, input.doneFallback)) {
    return { ok: false, error: failure }
  }
  return { ok: true, text: input.text?.trim() || input.doneFallback }
}
