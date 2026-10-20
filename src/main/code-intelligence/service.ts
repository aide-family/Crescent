import { createHash } from 'node:crypto'
import { opendir, realpath } from 'node:fs/promises'
import { join, relative, dirname, resolve, posix } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openKnowledgeDatabase } from '../knowledge-database'
import { LocalDocumentReader, sensitiveDocumentPath } from '../local-document-reader'
import { codeLanguage, parseCode } from './parser'
import type { CodeIndexStatus, CodeHit, CodeSymbol, CodeReference } from '../../shared/knowledge'
import { redactSensitiveText } from '../../shared/secret-redaction'

function redactedSource(text: string): string {
  let privateKey = false
  return text
    .split('\n')
    .map((line) => {
      if (privateKey || /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line)) {
        privateKey = !/-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line)
        return '[REDACTED PRIVATE KEY]'
      }
      return redactSensitiveText(line)
    })
    .join('\n')
}

const ignored = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.cache'
])
let singleton: CodeIntelligenceService | undefined
export function codeIntelligence(): CodeIntelligenceService {
  return (singleton ??= new CodeIntelligenceService())
}
export class CodeIntelligenceService {
  private db: DatabaseSync
  private jobs = new Map<string, Promise<CodeIndexStatus>>()
  constructor() {
    this.db = openKnowledgeDatabase('code_index.db')
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS files(root TEXT, path TEXT, language TEXT, hash TEXT, content TEXT, symbols TEXT, refs TEXT, updated_at TEXT, PRIMARY KEY(root,path));
      CREATE TABLE IF NOT EXISTS index_metadata(root TEXT PRIMARY KEY, value TEXT NOT NULL);`)
    if (
      !this.db
        .prepare('PRAGMA table_info(files)')
        .all()
        .some((row) => row.name === 'parse_error')
    )
      this.db.exec('ALTER TABLE files ADD COLUMN parse_error INTEGER NOT NULL DEFAULT 0')
  }
  status(root: string): CodeIndexStatus {
    const row = this.db.prepare('SELECT value FROM index_metadata WHERE root=?').get(root)
    const stored = row ? JSON.parse(String(row.value)) : {}
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM files WHERE root=?').get(root)
    return {
      root,
      files: Number(count?.count ?? 0),
      symbols: 0,
      skipped: 0,
      errors: 0,
      limited: false,
      ...stored,
      indexing: this.jobs.has(root)
    }
  }
  async index(root: string, signal?: AbortSignal): Promise<CodeIndexStatus> {
    root = await realpath(root)
    if (this.jobs.has(root)) throw new Error('此目录正在索引，请稍后重试')
    if (this.jobs.size >= 2) throw new Error('索引任务繁忙，请稍后重试')
    const job = this.scan(root, signal).finally(() => this.jobs.delete(root))
    this.jobs.set(root, job)
    return job
  }
  private async scan(root: string, signal?: AbortSignal): Promise<CodeIndexStatus> {
    const reader = new LocalDocumentReader([root])
    await reader.authorize(root)
    const rows: Array<{
      path: string
      language: string
      hash: string
      content: string
      symbols: CodeSymbol[]
      refs: CodeReference[]
      parseError: boolean
    }> = []
    let skipped = 0,
      errors = 0,
      bytes = 0,
      visited = 0,
      limited = false
    const scan = async (directory: string, depth: number): Promise<void> => {
      if (depth > 24) {
        skipped++
        return
      }
      await reader.authorize(directory)
      const entries = await opendir(directory)
      for await (const entry of entries) {
        signal?.throwIfAborted()
        if (++visited > 20000 || rows.length >= 2000 || bytes >= 32 * 1024 * 1024) {
          limited = true
          break
        }
        const absolute = join(directory, entry.name)
        if (entry.isSymbolicLink() || ignored.has(entry.name) || sensitiveDocumentPath(absolute)) {
          skipped++
          continue
        }
        if (entry.isDirectory()) {
          await scan(absolute, depth + 1)
          continue
        }
        const language = codeLanguage(absolute)
        if (!entry.isFile() || !language) continue
        try {
          // Raw text remains in main memory only for AST parsing; persist only redacted lines.
          // Refuse partial files so graph claims never silently describe a truncated source.
          let content = '',
            offset = 1
          for (;;) {
            const page = await reader.read({ path: absolute, offset, limit: 500 }, signal, {
              rawForIndex: true
            })
            content += page.lines.map((line) => line.text).join('\n') + '\n'
            if (Buffer.byteLength(content) > 512 * 1024 || offset > 10000)
              throw new Error('File exceeds index budget')
            if (!page.hasMore) break
            if (!page.lines.length) throw new Error('Long line exceeds index budget')
            offset = page.lines[page.lines.length - 1].line + 1
          }
          const path = relative(root, absolute).split('\\').join('/')
          const hash = 'ast-v2:' + createHash('sha256').update(content).digest('hex')
          const old = this.db
            .prepare('SELECT hash,symbols,refs,parse_error FROM files WHERE root=? AND path=?')
            .get(root, path)
          const parsed =
            old?.hash === hash
              ? {
                  symbols: JSON.parse(String(old.symbols)),
                  references: JSON.parse(String(old.refs)),
                  errors: old.parse_error === 1
                }
              : await parseCode(path, content)
          if (parsed.errors) errors++
          rows.push({
            path,
            language,
            hash,
            content: redactedSource(content),
            symbols: parsed.symbols,
            refs: parsed.references,
            parseError: parsed.errors
          })
          bytes += Buffer.byteLength(content) + Buffer.byteLength(JSON.stringify(parsed))
        } catch (error) {
          signal?.throwIfAborted()
          skipped++
          if (!(error instanceof Error)) throw error
        }
        await new Promise<void>((done) => setImmediate(done))
      }
    }
    await scan(root, 0)
    signal?.throwIfAborted()
    const now = new Date().toISOString()
    const status: CodeIndexStatus = {
      root,
      files: rows.length,
      symbols: rows.reduce((n, row) => n + row.symbols.length, 0),
      updatedAt: now,
      indexing: false,
      skipped,
      errors,
      limited
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM files WHERE root=?').run(root)
      const put = this.db.prepare(
        'INSERT INTO files(root,path,language,hash,content,symbols,refs,updated_at,parse_error) VALUES(?,?,?,?,?,?,?,?,?)'
      )
      for (const row of rows)
        put.run(
          root,
          row.path,
          row.language,
          row.hash,
          row.content,
          JSON.stringify(row.symbols),
          JSON.stringify(row.refs),
          now,
          Number(row.parseError)
        )
      this.db
        .prepare(
          'INSERT INTO index_metadata VALUES(?,?) ON CONFLICT(root) DO UPDATE SET value=excluded.value'
        )
        .run(root, JSON.stringify(status))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return status
  }
  search(root: string, query: string): CodeHit[] {
    this.validateQuery(query)
    const hits: Array<CodeHit & { score: number }> = []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    for (const row of this.rows(root)) {
      String(row.content)
        .split('\n')
        .forEach((text, index) => {
          const score = words.reduce(
            (n, word) =>
              n +
              Number(text.toLowerCase().includes(word)) * 2 +
              Number(index === 0 && row.path.toLowerCase().includes(word)),
            0
          )
          if (score) hits.push({ path: row.path, line: index + 1, text: text.slice(0, 400), score })
        })
      if (hits.length > 1000) hits.sort((a, b) => b.score - a.score).splice(200)
    }
    return hits
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map(({ path, line, text }) => ({ path, line, text }))
  }
  lookup(root: string, query: string): { definitions: CodeSymbol[]; references: CodeReference[] } {
    this.validateQuery(query)
    const definitions: CodeSymbol[] = [],
      references: CodeReference[] = []
    for (const row of this.rows(root)) {
      definitions.push(
        ...(JSON.parse(row.symbols) as CodeSymbol[])
          .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 80 - definitions.length)
      )
      references.push(
        ...(JSON.parse(row.refs) as CodeReference[])
          .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 120 - references.length)
      )
    }
    return { definitions, references }
  }
  trace(root: string, query: string, reverse = false) {
    this.validateQuery(query)
    const rows = this.rows(root)
    const seeds = new Set(
      rows
        .filter(
          (row) =>
            row.path.includes(query) ||
            (JSON.parse(row.symbols) as CodeSymbol[]).some((s) =>
              s.name.toLowerCase().includes(query.toLowerCase())
            )
        )
        .map((row) => row.path)
    )
    if (!seeds.size)
      this.search(root, query)
        .slice(0, 5)
        .forEach((hit) => seeds.add(hit.path))
    const paths = new Set(rows.map((row) => row.path))
    const edges: Array<{ source: string; target: string; line: number; kind: string }> = []
    for (const row of rows)
      for (const ref of JSON.parse(row.refs) as CodeReference[]) {
        if (ref.kind !== 'import') continue
        const base = ref.name.startsWith('.')
          ? posix.normalize(posix.join(dirname(row.path), ref.name))
          : ref.name.startsWith('@renderer/')
            ? 'src/renderer/src/' + ref.name.slice(10)
            : ''
        const target = [
          base,
          ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '.py'].map(
            (ext) => base + ext
          )
        ].find((candidate) => paths.has(candidate))
        if (target) edges.push({ source: row.path, target, line: ref.line, kind: 'import' })
      }
    const reached = new Set(seeds),
      result: typeof edges = []
    let frontier = new Set(seeds)
    for (let depth = 0; depth < 5; depth++) {
      const next = new Set<string>()
      for (const edge of edges) {
        const from = reverse ? edge.target : edge.source,
          to = reverse ? edge.source : edge.target
        if (frontier.has(from) && !result.includes(edge) && result.length < 120) {
          result.push(edge)
          if (!reached.has(to)) next.add(to)
          reached.add(to)
        }
      }
      frontier = next
    }
    return {
      seeds: [...seeds].slice(0, 20),
      edges: result,
      paths: [...reached].slice(0, 120),
      caveat:
        'Static imports and lexical references only. Dynamic calls and Electron IPC require reading both endpoints; matching names do not prove runtime identity.'
    }
  }
  clear(root: string): void {
    if (this.jobs.has(root)) throw new Error('请先取消索引')
    this.db.prepare('DELETE FROM files WHERE root=?').run(root)
    this.db.prepare('DELETE FROM index_metadata WHERE root=?').run(root)
  }
  private validateQuery(query: string): void {
    if (typeof query !== 'string' || !query.trim() || query.length > 200)
      throw new Error('Invalid code query')
  }
  private rows(
    root: string
  ): Array<{ path: string; content: string; symbols: string; refs: string }> {
    return this.db
      .prepare('SELECT path,content,symbols,refs FROM files WHERE root=? ORDER BY path')
      .all(resolve(root)) as unknown as Array<{
      path: string
      content: string
      symbols: string
      refs: string
    }>
  }
}
