import type { Dictionary } from '@renderer/i18n'

export interface ParsedAgentRunMarkdown {
  actionsMarkdown: string
  resultMarkdown: string
  errorMarkdown: string
  elapsedMarkdown: string
}

export function extractResultMarkdown(value: string, t: Dictionary): string {
  const parsed = parseAgentRunMarkdown(value, t)
  if (parsed) {
    return trimMarkdownLines([parsed.resultMarkdown, parsed.errorMarkdown].filter(Boolean))
  }

  return stripActionMarkdown(value.replace(/\r\n/g, '\n').split('\n'), t)
}

export function parseAgentRunMarkdown(value: string, t: Dictionary): ParsedAgentRunMarkdown | null {
  const normalized = value.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const actionsHeading = `**${t.input.actions}**`
  const resultHeading = `**${t.input.result}**`
  const errorHeading = `**${t.input.error}**`
  const actionsIndex = lines.findIndex((line) => line.trim() === actionsHeading)
  const resultIndex = lines.findIndex((line) => line.trim() === resultHeading)
  const errorIndex = lines.findIndex((line) => line.trim() === errorHeading)
  const elapsedIndex = findElapsedFooterIndex(lines, t)

  if (actionsIndex < 0 && resultIndex < 0 && errorIndex < 0) return null

  const actionsEnd = firstExistingIndexAfter(actionsIndex, [resultIndex, errorIndex, elapsedIndex])
  const resultEnd = firstExistingIndexAfter(resultIndex, [errorIndex, elapsedIndex])
  const errorEnd = firstExistingIndexAfter(errorIndex, [elapsedIndex])

  return {
    actionsMarkdown:
      actionsIndex >= 0
        ? filterNoisyActionMarkdown(lines.slice(actionsIndex + 1, actionsEnd ?? lines.length))
        : '',
    resultMarkdown:
      resultIndex >= 0
        ? trimMarkdownLines(lines.slice(resultIndex + 1, resultEnd ?? lines.length))
        : '',
    errorMarkdown:
      errorIndex >= 0
        ? trimMarkdownLines(lines.slice(errorIndex + 1, errorEnd ?? lines.length))
        : '',
    elapsedMarkdown: elapsedIndex >= 0 ? trimMarkdownLines(lines.slice(elapsedIndex + 1)) : ''
  }
}

export function trimMarkdownLines(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start += 1
  while (end > start && !lines[end - 1].trim()) end -= 1
  return lines.slice(start, end).join('\n').trim()
}

function findElapsedFooterIndex(lines: string[], t: Dictionary): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line.trim() !== '---') continue

    const nextMeaningfulLine = lines.slice(index + 1).find((next) => next.trim())
    if (nextMeaningfulLine?.trim().startsWith(`${t.input.elapsed}:`)) return index
  }

  return -1
}

function firstExistingIndexAfter(startIndex: number, indexes: number[]): number | undefined {
  if (startIndex < 0) return undefined

  const nextIndexes = indexes.filter((index) => index > startIndex)
  if (nextIndexes.length === 0) return undefined
  return Math.min(...nextIndexes)
}

function stripActionMarkdown(lines: string[], t: Dictionary): string {
  const actionHeading = `**${t.input.actions}**`
  const actionIndex = lines.findIndex((line) => line.trim() === actionHeading)
  if (actionIndex < 0) return trimMarkdownLines(lines)

  const nextSectionIndex = lines.findIndex((line, index) => {
    if (index <= actionIndex) return false
    const trimmed = line.trim()
    return (
      trimmed === `**${t.input.result}**` || trimmed === `**${t.input.error}**` || trimmed === '---'
    )
  })

  return trimMarkdownLines([
    ...lines.slice(0, actionIndex),
    ...(nextSectionIndex >= 0 ? lines.slice(nextSectionIndex) : [])
  ])
}

function filterNoisyActionMarkdown(lines: string[]): string {
  const withoutSummaryNoise = lines.filter(
    (line) => !/^\s*[-*]\s+Loaded \d+ MCP tools?[.:]?\s*$/i.test(line)
  )
  const filtered: string[] = []

  for (let index = 0; index < withoutSummaryNoise.length; index += 1) {
    const line = withoutSummaryNoise[index]
    if (/^####\s+\d+\.\s+Loaded \d+ MCP tools?[.:]?\s*$/i.test(line.trim())) {
      index += 1
      while (
        index < withoutSummaryNoise.length &&
        !/^####\s+\d+\.\s+/.test(withoutSummaryNoise[index].trim())
      ) {
        index += 1
      }
      index -= 1
      continue
    }

    filtered.push(line)
  }

  return trimMarkdownLines(filtered)
}
