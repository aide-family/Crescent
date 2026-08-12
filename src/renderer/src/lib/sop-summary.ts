import type { Dictionary } from '@renderer/i18n'
import { parseAgentRunDocument } from './agent-run-document'
import type { AgentLogEntry, AgentRunStep, AgentRunViewState } from './terminal-tabs'

const SUMMARY_MAX_CHARS = 12_000

function summarizeToolSteps(steps: AgentRunStep[]): string[] {
  const lines: string[] = []
  for (const step of steps) {
    if (step.kind !== 'tool') continue
    const command = (step.command || step.argsText || '').trim()
    const result = (step.resultText || '').trim()
    if (!command && !result) continue
    const resultPreview = result ? result.slice(0, 400) : ''
    lines.push(
      [
        command ? `Command: ${command.slice(0, 300)}` : '',
        resultPreview
          ? `Result: ${resultPreview}${result.length > 400 ? '…' : ''}${step.isError ? ' (error)' : ''}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return lines
}

/** Build a compact turn summary for SOP generation (no secrets assumed beyond session text). */
export function buildSopGenerationSummary(input: {
  log: AgentLogEntry[]
  entry: AgentLogEntry
  liveRun?: AgentRunViewState
  t: Dictionary
}): string {
  const { log, entry, liveRun, t } = input
  const entryIndex = log.findIndex((item) => item.id === entry.id)
  const userMessages: string[] = []
  for (let i = 0; i < (entryIndex >= 0 ? entryIndex : log.length); i++) {
    const item = log[i]
    if (item?.kind === 'user' && item.text.trim()) {
      userMessages.push(item.text.trim())
    }
  }

  let steps: AgentRunStep[] = liveRun?.steps ?? []
  let resultMarkdown = liveRun?.result?.trim() ?? ''
  if ((!steps.length || !resultMarkdown) && entry.kind === 'assistant') {
    const parsed = parseAgentRunDocument(entry.text, t)
    if (parsed) {
      if (!steps.length) steps = parsed.steps
      if (!resultMarkdown) resultMarkdown = parsed.resultMarkdown.trim()
    } else if (!resultMarkdown && entry.text.trim()) {
      resultMarkdown = entry.text.trim().slice(0, 2000)
    }
  }

  const commandLines = summarizeToolSteps(steps)
  const parts = [
    '# User goals',
    userMessages.length ? userMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n') : '(none)',
    '',
    '# Commands and results',
    commandLines.length ? commandLines.join('\n\n') : '(none)',
    '',
    '# Final report',
    resultMarkdown || '(none)'
  ]

  let summary = parts.join('\n')
  if (summary.length > SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, SUMMARY_MAX_CHARS)}…`
  }
  return summary
}

export function buildFallbackSopSeed(userText: string): { title: string; content: string } {
  const seed = userText.trim()
  return {
    title: seed.slice(0, 20) || 'SOP',
    content: seed
  }
}
