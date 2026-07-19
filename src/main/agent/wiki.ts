import { promises as fs } from 'fs'
import { basename, join, resolve } from 'path'

import type { WikiDocument, WikiDocumentSummary, WikiSaveInput } from './types'
import { getCrescentWikiDir } from '../crescent-paths'

const WIKI_DIR = getCrescentWikiDir()
const LEGACY_PROJECT_WIKI_DIR = resolve(process.cwd(), 'wiki')
const MAX_WIKI_CONTEXT_CHARS = 12_000

export async function listWikiDocuments(): Promise<WikiDocumentSummary[]> {
  await ensureWikiDir()
  const entries = await fs.readdir(WIKI_DIR, { withFileTypes: true })
  const documents = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => readWikiDocumentByFilename(entry.name))
  )

  return documents
    .filter((document): document is WikiDocument => Boolean(document))
    .map((document) => ({
      id: document.id,
      title: document.title,
      path: document.path,
      updatedAt: document.updatedAt,
      excerpt: document.excerpt
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function getWikiDocument(id: string): Promise<WikiDocument | undefined> {
  const filename = idToFilename(id)
  if (!filename) return undefined

  return readWikiDocumentByFilename(filename)
}

export async function saveWikiDocument(input: WikiSaveInput): Promise<WikiDocument> {
  await ensureWikiDir()
  const title = input.title.trim() || 'Untitled SOP'
  const id = input.id?.trim() || createWikiId(title)
  const filename = idToFilename(id) || `${createWikiId(title)}.md`
  const path = join(WIKI_DIR, filename)
  const content = normalizeWikiContent(title, input.content)

  await fs.writeFile(path, content, 'utf-8')

  const document = await readWikiDocumentByFilename(filename)
  if (!document) throw new Error(`Failed to save wiki document: ${filename}`)

  return document
}

export async function searchWikiDocuments(
  query: string,
  limit = 5,
  maxChars = MAX_WIKI_CONTEXT_CHARS
): Promise<WikiDocument[]> {
  const documents = await Promise.all(
    (await listWikiDocuments()).map((summary) => getWikiDocument(summary.id))
  )
  const terms = tokenizeQuery(query)

  return documents
    .filter((document): document is WikiDocument => Boolean(document))
    .map((document) => ({ document, score: scoreWikiDocument(document, query, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ document }) => ({
      ...document,
      content: truncateText(document.content, maxChars)
    }))
}

export function formatWikiContext(documents: WikiDocument[]): string {
  if (documents.length === 0) return ''

  return documents
    .map((document) =>
      [`# ${document.title}`, `Path: ${document.path}`, '', truncateText(document.content, 6000)]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n---\n\n')
}

async function readWikiDocumentByFilename(filename: string): Promise<WikiDocument | undefined> {
  const safeFilename = idToFilename(filename)
  if (!safeFilename) return undefined

  const path = join(WIKI_DIR, safeFilename)

  try {
    const [stat, content] = await Promise.all([fs.stat(path), fs.readFile(path, 'utf-8')])
    const title = extractMarkdownTitle(content) || filenameToTitle(safeFilename)

    return {
      id: safeFilename,
      title,
      path,
      updatedAt: stat.mtime.toISOString(),
      excerpt: createExcerpt(content),
      content
    }
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function ensureWikiDir(): Promise<void> {
  await fs.mkdir(WIKI_DIR, { recursive: true })
  await migrateLegacyProjectWikiDir()
}

async function migrateLegacyProjectWikiDir(): Promise<void> {
  if (LEGACY_PROJECT_WIKI_DIR === WIKI_DIR) return

  let entries
  try {
    entries = await fs.readdir(LEGACY_PROJECT_WIKI_DIR, { withFileTypes: true })
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') return
    throw error
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map(async (entry) => {
        const filename = idToFilename(entry.name)
        if (!filename) return

        const targetPath = join(WIKI_DIR, filename)
        try {
          await fs.copyFile(join(LEGACY_PROJECT_WIKI_DIR, entry.name), targetPath, fs.constants.COPYFILE_EXCL)
        } catch (error) {
          if (isErrorWithCode(error) && error.code === 'EEXIST') return
          throw error
        }
      })
  )
}

function normalizeWikiContent(title: string, content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return `# ${title}\n`
  if (/^#\s+/m.test(trimmed)) return `${trimmed}\n`

  return `# ${title}\n\n${trimmed}\n`
}

function createWikiId(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return `${new Date().toISOString().slice(0, 10)}-${slug || 'sop'}.md`
}

function idToFilename(id: string): string {
  const filename = basename(id.trim())
  if (!filename || filename === '.' || filename === '..') return ''

  return filename.toLowerCase().endsWith('.md') ? filename : `${filename}.md`
}

function filenameToTitle(filename: string): string {
  return filename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim()
}

function extractMarkdownTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function createExcerpt(content: string): string {
  return truncateText(
    content
      .replace(/^#\s+.+$/gm, '')
      .replace(/\s+/g, ' ')
      .trim(),
    220
  )
}

function scoreWikiDocument(document: WikiDocument, query: string, terms: string[]): number {
  const title = document.title.toLowerCase()
  const content = document.content.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  let score = 0

  if (normalizedQuery && title.includes(normalizedQuery)) score += 20
  if (normalizedQuery && content.includes(normalizedQuery)) score += 8

  for (const term of terms) {
    if (title.includes(term)) score += 8
    if (content.includes(term)) score += 2
  }

  return score
}

function tokenizeQuery(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9_.:/-]{2,}|[\u3400-\u9fff]{2,}/g)
        ?.filter((term) => !['wiki', 'sop', 'best', 'practice'].includes(term)) ?? []
    )
  ].slice(0, 20)
}

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text
}

function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
