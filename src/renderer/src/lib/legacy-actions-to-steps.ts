import type { AgentRunStep } from './terminal-tabs'

/**
 * Convert legacy "动作概要" markdown into structured timeline steps so old
 * logs render with the same Cursor-style timeline as live V2 runs.
 */
export function legacyActionsMarkdownToSteps(actionsMarkdown: string): AgentRunStep[] {
  const normalized = actionsMarkdown.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const lines = normalized.split('\n')
  const detailSteps: AgentRunStep[] = []
  const bulletSteps: AgentRunStep[] = []
  let index = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const detailHeading = line.match(/^####\s+\d+\.\s+(.+)$/)
    if (detailHeading) {
      const title = detailHeading[1].trim()
      const detailLines: string[] = []
      i += 1
      while (i < lines.length && !/^####\s+\d+\.\s+/.test(lines[i].trim())) {
        if (lines[i].trim() === '</details>') break
        detailLines.push(lines[i])
        i += 1
      }
      i -= 1
      const detail = detailLines.join('\n').trim()
      detailSteps.push(legacyTitleToStep(`legacy-detail-${index}`, title, detail))
      index += 1
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      bulletSteps.push(legacyTitleToStep(`legacy-bullet-${index}`, bullet[1].trim()))
      index += 1
    }
  }

  // Prefer detailed #### blocks when present (they carry args/output).
  return detailSteps.length > 0 ? detailSteps : bulletSteps
}

function legacyTitleToStep(id: string, title: string, detail = ''): AgentRunStep {
  const toolMatch =
    title.match(/^(?:Used tool|调用工具|Tool)\s*[:：]\s*(.+)$/i) ||
    title.match(/^调用工具\s*[:：]\s*(.+)$/)
  if (toolMatch) {
    const name = toolMatch[1].trim()
    const command = extractCommandFromDetail(detail)
    const argsText = extractArgsFromDetail(detail)
    const resultText = extractOutputFromDetail(detail)
    return {
      id,
      kind: 'tool',
      name,
      phase: 'finished',
      command,
      argsText: argsText || (!command && !resultText && detail ? detail : undefined),
      resultText,
      isError: /fail|error|失败/i.test(detail)
    }
  }

  if (/^(?:Command|命令|terminal|bash)\b/i.test(title) || detail.includes('Command:')) {
    const command =
      extractCommandFromDetail(detail) || title.replace(/^(?:Command|命令)\s*[:：]?\s*/i, '')
    return {
      id,
      kind: 'tool',
      name: 'bash',
      phase: 'finished',
      command: command || undefined,
      resultText: extractOutputFromDetail(detail) || detail || undefined
    }
  }

  return {
    id,
    kind: 'status',
    title,
    detail: detail || undefined
  }
}

function extractCommandFromDetail(detail: string): string | undefined {
  if (!detail.trim()) return undefined
  const commandBlock = detail.match(
    /(?:^|\n)\s*Command:\s*\n?([\s\S]*?)(?:\n\s*Output:|\n\s*Args:|\n\s*Arguments:|$)/i
  )
  if (commandBlock?.[1]?.trim()) return stripCodeFence(commandBlock[1].trim())
  return undefined
}

function extractArgsFromDetail(detail: string): string | undefined {
  if (!detail.trim()) return undefined
  const argsBlock = detail.match(
    /(?:^|\n)\s*(?:Arguments?|Args):\s*\n?([\s\S]*?)(?:\n\s*Output:|\n\s*Command:|$)/i
  )
  if (argsBlock?.[1]?.trim()) return stripCodeFence(argsBlock[1].trim())
  return undefined
}

function extractOutputFromDetail(detail: string): string | undefined {
  if (!detail.trim()) return undefined
  const outputBlock = detail.match(/(?:^|\n)\s*Output:\s*\n?([\s\S]*)$/i)
  if (outputBlock?.[1]?.trim()) return stripCodeFence(outputBlock[1].trim())
  return undefined
}

function stripCodeFence(value: string): string {
  const fenced = value.match(/^```[^\n]*\n([\s\S]*?)\n```$/m)
  if (fenced?.[1] != null) return fenced[1].trim()
  return value
    .replace(/^```[^\n]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}
