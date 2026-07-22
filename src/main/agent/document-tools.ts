import { promises as fs } from 'fs'
import { homedir } from 'os'
import { extname, isAbsolute, resolve } from 'path'
import { inflateRawSync, inflateSync } from 'zlib'

import type { AgentBrain } from './brain'
import type { OpenAiTool } from './types'

export const PARSE_PDF_TOOL_NAME = 'parse_pdf_file'
export const PARSE_DOCX_TOOL_NAME = 'parse_docx_file'
export const PARSE_MARKDOWN_TOOL_NAME = 'parse_markdown_file'
export const ANALYZE_IMAGE_TOOL_NAME = 'analyze_image_file'
export const TRANSCRIBE_AUDIO_TOOL_NAME = 'transcribe_audio_file'

const DEFAULT_MAX_CHARS = 24_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const TEXT_FILE_EXTENSIONS = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
  '.jsonl',
  '.toml',
  '.ini',
  '.env',
  '.conf',
  '.config',
  '.properties',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.log'
]

export const DOCUMENT_PARSE_TOOLS: OpenAiTool[] = [
  {
    type: 'function',
    function: {
      name: PARSE_PDF_TOOL_NAME,
      description:
        'Parse a local PDF file on the Crescent machine and return extracted text plus metadata. Use this for user-referenced PDF paths before answering questions about PDF content.',
      parameters: createPathParameters('Absolute path or ~/ path to a local .pdf file.')
    }
  },
  {
    type: 'function',
    function: {
      name: PARSE_DOCX_TOOL_NAME,
      description:
        'Parse a local DOCX file on the Crescent machine and return extracted document text plus metadata. Use this for user-referenced Word .docx files.',
      parameters: createPathParameters('Absolute path or ~/ path to a local .docx file.')
    }
  },
  {
    type: 'function',
    function: {
      name: PARSE_MARKDOWN_TOOL_NAME,
      description:
        'Read a local Markdown, plain-text, source-code, or configuration file on the Crescent machine. Use this for user-referenced .md, .txt, .yaml/.yml, .json, .toml, .env, .conf, scripts, logs, and other text files.',
      parameters: createPathParameters(
        'Absolute path or ~/ path to a local Markdown/text/configuration file.'
      )
    }
  },
  {
    type: 'function',
    function: {
      name: ANALYZE_IMAGE_TOOL_NAME,
      description:
        'Analyze a local image file on the Crescent machine with the configured vision-capable model. Returns dimensions, MIME type, and visual/text analysis.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path or ~/ path to a local image file.'
          },
          prompt: {
            type: 'string',
            description:
              'Optional analysis instruction, such as OCR all text, describe UI issues, or summarize a chart.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TRANSCRIBE_AUDIO_TOOL_NAME,
      description:
        'Transcribe a local audio file on the Crescent machine with the configured OpenAI-compatible audio transcription endpoint. Returns transcript plus metadata.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path or ~/ path to a local audio file.'
          },
          language: {
            type: 'string',
            description: 'Optional ISO language hint, for example zh, en, or ja.'
          },
          prompt: {
            type: 'string',
            description: 'Optional transcription prompt or vocabulary hint.'
          },
          model: {
            type: 'string',
            description: 'Optional transcription model. Defaults to whisper-1.'
          }
        },
        required: ['path']
      }
    }
  }
]

export async function executeDocumentParseTool(
  toolName: string,
  rawArguments: string,
  brain: AgentBrain
): Promise<unknown> {
  const args = parseDocumentToolArgs(rawArguments)
  const path = resolveLocalPath(args.path)

  if (!path) return { ok: false, error: 'A local file path is required.' }

  try {
    if (toolName === PARSE_PDF_TOOL_NAME) return parsePdfFile(path, args.maxChars)
    if (toolName === PARSE_DOCX_TOOL_NAME) return parseDocxFile(path, args.maxChars)
    if (toolName === PARSE_MARKDOWN_TOOL_NAME) return parseMarkdownFile(path, args.maxChars)
    if (toolName === ANALYZE_IMAGE_TOOL_NAME) return analyzeImageFile(path, args.prompt, brain)
    if (toolName === TRANSCRIBE_AUDIO_TOOL_NAME) {
      return transcribeAudioFile(path, args, brain)
    }

    return { ok: false, path, error: `Unknown document parser tool ${toolName}` }
  } catch (error) {
    return {
      ok: false,
      path,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function parseMarkdownFile(path: string, maxChars: number): Promise<unknown> {
  assertExtension(path, TEXT_FILE_EXTENSIONS)
  const stat = await fs.stat(path)
  const content = await fs.readFile(path, 'utf8')

  return {
    ok: true,
    type: 'markdown',
    path,
    bytes: stat.size,
    truncated: content.length > maxChars,
    content: truncateText(content, maxChars)
  }
}

async function parseDocxFile(path: string, maxChars: number): Promise<unknown> {
  assertExtension(path, ['.docx'])
  const file = await fs.readFile(path)
  const entries = readZipEntries(file)
  const documentParts = [
    'word/document.xml',
    ...[...entries.keys()]
      .filter((name) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/i.test(name))
      .sort()
  ]
  const text = documentParts
    .map((name) => entries.get(name))
    .filter((entry): entry is Buffer => Boolean(entry))
    .map((entry) => extractDocxXmlText(entry.toString('utf8')))
    .filter(Boolean)
    .join('\n\n')
    .trim()

  return {
    ok: true,
    type: 'docx',
    path,
    bytes: file.length,
    parts: documentParts.filter((name) => entries.has(name)),
    truncated: text.length > maxChars,
    content: truncateText(text, maxChars)
  }
}

async function parsePdfFile(path: string, maxChars: number): Promise<unknown> {
  assertExtension(path, ['.pdf'])
  const file = await fs.readFile(path)
  const text = extractPdfText(file).trim()

  return {
    ok: true,
    type: 'pdf',
    path,
    bytes: file.length,
    pages: countPdfPages(file),
    truncated: text.length > maxChars,
    content: truncateText(text, maxChars)
  }
}

async function analyzeImageFile(
  path: string,
  prompt: string | undefined,
  brain: AgentBrain
): Promise<unknown> {
  const file = await fs.readFile(path)
  if (file.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      type: 'image',
      path,
      bytes: file.length,
      error: `Image is too large for inline analysis (${file.length} bytes). Limit is ${MAX_IMAGE_BYTES} bytes.`
    }
  }

  const image = inspectImage(file, path)
  const dataUrl = `data:${image.mimeType};base64,${file.toString('base64')}`
  const analysis = await brain.analyzeImage({ dataUrl, prompt })

  return {
    ok: true,
    type: 'image',
    path,
    bytes: file.length,
    ...image,
    analysis
  }
}

async function transcribeAudioFile(
  path: string,
  args: DocumentToolArgs,
  brain: AgentBrain
): Promise<unknown> {
  const stat = await fs.stat(path)
  const audio = inspectAudio(path)
  const transcript = await brain.transcribeAudio({
    path,
    model: args.model,
    language: args.language,
    prompt: args.prompt
  })

  return {
    ok: true,
    type: 'audio',
    path,
    bytes: stat.size,
    ...audio,
    transcript
  }
}

interface DocumentToolArgs {
  path: string
  maxChars: number
  prompt?: string
  language?: string
  model?: string
}

function parseDocumentToolArgs(rawArguments: string): DocumentToolArgs {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown
    if (!isRecord(parsed)) return { path: '', maxChars: DEFAULT_MAX_CHARS }

    const maxChars = Number(parsed.maxChars)
    return {
      path: typeof parsed.path === 'string' ? parsed.path.trim() : '',
      maxChars: Number.isFinite(maxChars)
        ? Math.max(1_000, Math.min(80_000, Math.floor(maxChars)))
        : DEFAULT_MAX_CHARS,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
      language: typeof parsed.language === 'string' ? parsed.language : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined
    }
  } catch {
    return { path: '', maxChars: DEFAULT_MAX_CHARS }
  }
}

function createPathParameters(pathDescription: string): OpenAiTool['function']['parameters'] {
  return {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: pathDescription
      },
      maxChars: {
        type: 'number',
        description:
          'Optional maximum number of extracted characters to return. Defaults to 24000 and is capped at 80000.'
      }
    },
    required: ['path']
  }
}

function resolveLocalPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  const expanded = trimmed.replace(/^~(?=\/|$)/, homedir()).replace(/^\$HOME(?=\/|$)/, homedir())
  return isAbsolute(expanded) ? resolve(expanded) : resolve(homedir(), expanded)
}

function assertExtension(path: string, allowed: string[]): void {
  const extension = extname(path).toLowerCase()
  if (!allowed.includes(extension)) {
    throw new Error(`Unsupported file extension "${extension}". Expected ${allowed.join(', ')}.`)
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n...[content truncated]`
}

function readZipEntries(file: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  const centralDirectoryOffset = findCentralDirectoryOffset(file)
  let offset = centralDirectoryOffset

  while (offset + 46 <= file.length && file.readUInt32LE(offset) === 0x02014b50) {
    const method = file.readUInt16LE(offset + 10)
    const compressedSize = file.readUInt32LE(offset + 20)
    const fileNameLength = file.readUInt16LE(offset + 28)
    const extraLength = file.readUInt16LE(offset + 30)
    const commentLength = file.readUInt16LE(offset + 32)
    const localHeaderOffset = file.readUInt32LE(offset + 42)
    const name = file
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString('utf8')
      .replace(/\\/g, '/')

    const dataOffset = getZipLocalDataOffset(file, localHeaderOffset)
    const compressed = file.subarray(dataOffset, dataOffset + compressedSize)
    const content =
      method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : Buffer.alloc(0)

    if (content.length > 0) entries.set(name, content)
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function findCentralDirectoryOffset(file: Buffer): number {
  for (let offset = file.length - 22; offset >= Math.max(0, file.length - 65_558); offset -= 1) {
    if (file.readUInt32LE(offset) === 0x06054b50) return file.readUInt32LE(offset + 16)
  }

  throw new Error('Invalid DOCX zip: end of central directory not found.')
}

function getZipLocalDataOffset(file: Buffer, localHeaderOffset: number): number {
  if (file.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error('Invalid DOCX zip: local file header not found.')
  }

  const fileNameLength = file.readUInt16LE(localHeaderOffset + 26)
  const extraLength = file.readUInt16LE(localHeaderOffset + 28)
  return localHeaderOffset + 30 + fileNameLength + extraLength
}

function extractDocxXmlText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:(br|cr)\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:tc>/gi, '\t')
      .replace(/<\/w:(p|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractPdfText(file: Buffer): string {
  const binary = file.toString('latin1')
  const chunks: string[] = []
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match: RegExpExecArray | null

  while ((match = streamPattern.exec(binary))) {
    const dictionary = binary.slice(Math.max(0, match.index - 1200), match.index)
    const raw = Buffer.from(match[1], 'latin1')
    const data = /\/FlateDecode\b/.test(dictionary) ? inflatePdfStream(raw) : raw
    const text = extractPdfTextOperators(data.toString('latin1'))
    if (text.trim()) chunks.push(text)
  }

  if (chunks.length > 0) return normalizeExtractedText(chunks.join('\n'))
  return normalizeExtractedText(extractPdfTextOperators(binary))
}

function inflatePdfStream(raw: Buffer): Buffer {
  try {
    return inflateSync(raw)
  } catch {
    return raw
  }
}

function extractPdfTextOperators(content: string): string {
  const chunks: string[] = []
  const textObjects = content.match(/BT[\s\S]*?ET/g) ?? [content]

  for (const object of textObjects) {
    for (const match of object.matchAll(/\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")/g)) {
      chunks.push(decodePdfLiteral(match[0].replace(/\s*(?:Tj|'|")$/, '')))
    }
    for (const match of object.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      chunks.push(decodePdfHex(match[1]))
    }
    for (const match of object.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const array = match[1]
      for (const literal of array.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
        chunks.push(decodePdfLiteral(literal[0]))
      }
      for (const hex of array.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
        chunks.push(decodePdfHex(hex[1]))
      }
    }
  }

  return chunks.join(' ')
}

function decodePdfLiteral(value: string): string {
  const body = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value
  return body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, escape: string) => {
    if (escape === 'n') return '\n'
    if (escape === 'r') return '\r'
    if (escape === 't') return '\t'
    if (escape === 'b') return '\b'
    if (escape === 'f') return '\f'
    if (/^[0-7]/.test(escape)) return String.fromCharCode(parseInt(escape, 8))
    return escape
  })
}

function decodePdfHex(value: string): string {
  const hex = value.replace(/\s+/g, '')
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`
  const buffer = Buffer.from(padded, 'hex')

  if (buffer[0] === 0xfe && buffer[1] === 0xff) return decodeUtf16Be(buffer.subarray(2))
  return buffer.toString('latin1')
}

function decodeUtf16Be(buffer: Buffer): string {
  const codePoints: number[] = []
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    codePoints.push(buffer.readUInt16BE(index))
  }
  return String.fromCharCode(...codePoints)
}

function countPdfPages(file: Buffer): number {
  const text = file.toString('latin1')
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function inspectImage(
  file: Buffer,
  path: string
): {
  mimeType: string
  width?: number
  height?: number
} {
  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      mimeType: 'image/png',
      width: file.readUInt32BE(16),
      height: file.readUInt32BE(20)
    }
  }
  if (file.subarray(0, 3).toString('latin1') === 'GIF') {
    return {
      mimeType: 'image/gif',
      width: file.readUInt16LE(6),
      height: file.readUInt16LE(8)
    }
  }
  if (file.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    const size = readJpegSize(file)
    return { mimeType: 'image/jpeg', ...size }
  }
  if (
    file.subarray(0, 4).toString('latin1') === 'RIFF' &&
    file.subarray(8, 12).toString() === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ...readWebpSize(file) }
  }

  return { mimeType: mimeTypeFromExtension(path) || 'application/octet-stream' }
}

function readJpegSize(file: Buffer): { width?: number; height?: number } {
  let offset = 2
  while (offset + 9 < file.length) {
    if (file[offset] !== 0xff) return {}
    const marker = file[offset + 1]
    const length = file.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: file.readUInt16BE(offset + 5),
        width: file.readUInt16BE(offset + 7)
      }
    }
    offset += 2 + length
  }
  return {}
}

function readWebpSize(file: Buffer): { width?: number; height?: number } {
  const chunk = file.subarray(12, 16).toString('latin1')
  if (chunk === 'VP8X' && file.length >= 30) {
    return {
      width: 1 + file.readUIntLE(24, 3),
      height: 1 + file.readUIntLE(27, 3)
    }
  }
  return {}
}

function inspectAudio(path: string): { mimeType: string; durationSeconds?: number } {
  return {
    mimeType: mimeTypeFromExtension(path) || 'application/octet-stream'
  }
}

function mimeTypeFromExtension(path: string): string | undefined {
  const extension = extname(path).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac'
  }

  return mimeTypes[extension]
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase()
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    if (normalized === 'amp') return '&'
    if (normalized === 'quot') return '"'
    if (normalized === 'apos') return "'"
    if (normalized.startsWith('#x')) {
      return String.fromCodePoint(parseInt(normalized.slice(2), 16))
    }
    if (normalized.startsWith('#')) return String.fromCodePoint(parseInt(normalized.slice(1), 10))
    return match
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
