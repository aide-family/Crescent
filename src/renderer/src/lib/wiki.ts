import type { Dictionary } from '@renderer/i18n'
import type {
  StoredSessionHistoryDetail,
  WikiDocument,
  WikiDocumentSummary
} from '../../../shared/agent-types'

export function buildWikiContentFromHistory(
  detail: StoredSessionHistoryDetail,
  t: Dictionary
): string {
  const title = `${detail.title} SOP`
  const logs = detail.logs
    .filter((log) => log.kind === 'user' || log.kind === 'assistant' || log.kind === 'error')
    .slice(-20)
  const sourceLines = [
    `- ${t.wiki.sourceSession}: ${detail.title}`,
    detail.connectionName ? `- ${t.terminal.connectionTarget}: ${detail.connectionName}` : '',
    detail.terminalCwd ? `- ${t.app.workingDirectory}: ${detail.terminalCwd}` : '',
    `- ${t.history.runs}: ${detail.runCount}`,
    `- ${t.wiki.savedAt}: ${new Date().toISOString()}`
  ].filter(Boolean)

  const conversationLines = logs.flatMap((log) => [
    `### ${formatWikiLogKind(log.kind, t)} · ${log.createdAt}`,
    '',
    truncateWikiContent(log.text.trim(), 6000),
    ''
  ])

  return [
    `# ${title}`,
    '',
    `## ${t.wiki.overview}`,
    '',
    t.wiki.generatedFromHistory,
    '',
    `## ${t.wiki.sourceInfo}`,
    '',
    ...sourceLines,
    '',
    `## ${t.wiki.bestPracticeDraft}`,
    '',
    `- ${t.wiki.fillInPurpose}`,
    `- ${t.wiki.fillInPrerequisites}`,
    `- ${t.wiki.fillInSteps}`,
    `- ${t.wiki.fillInRollback}`,
    '',
    `## ${t.wiki.historyTranscript}`,
    '',
    ...conversationLines
  ].join('\n')
}

export function formatWikiLogKind(kind: string, t: Dictionary): string {
  if (kind === 'user') return t.common.user
  if (kind === 'assistant') return t.common.assistant
  if (kind === 'error') return t.common.error
  return kind
}

export function truncateWikiContent(content: string, maxChars: number): string {
  return content.length > maxChars ? `${content.slice(0, maxChars)}\n...[truncated]` : content
}

export function upsertWikiSummary(
  documents: WikiDocumentSummary[],
  document: WikiDocument
): WikiDocumentSummary[] {
  const summary: WikiDocumentSummary = {
    id: document.id,
    title: document.title,
    path: document.path,
    updatedAt: document.updatedAt,
    excerpt: document.excerpt
  }

  return [summary, ...documents.filter((candidate) => candidate.id !== document.id)]
}

export function filterWikiDocuments(
  documents: WikiDocumentSummary[],
  query: string
): WikiDocumentSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return documents

  return documents.filter((document) =>
    [document.title, document.excerpt, document.path].join('\n').toLowerCase().includes(normalized)
  )
}

export interface WikiHeading {
  level: number
  text: string
  index: number
}

export function parseWikiHeadings(content: string): WikiHeading[] {
  const headings: WikiHeading[] = []
  let index = 0
  let fenceMarker: '```' | '~~~' | null = null

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (fenceMarker) {
      if (new RegExp(`^\\s*${escapeRegExp(fenceMarker)}\\s*$`).test(line)) {
        fenceMarker = null
      }
      continue
    }

    const fence = line.match(/^\s*(```|~~~)[\w-]*\s*$/)
    if (fence) {
      fenceMarker = fence[1] as '```' | '~~~'
      continue
    }

    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*$/)
    if (!match) continue

    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      index
    })
    index += 1
  }

  return headings
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
