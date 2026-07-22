import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync, deflateSync } from 'zlib'
import { describe, expect, it, vi } from 'vitest'

import {
  ANALYZE_IMAGE_TOOL_NAME,
  executeDocumentParseTool,
  PARSE_DOCX_TOOL_NAME,
  PARSE_MARKDOWN_TOOL_NAME,
  PARSE_PDF_TOOL_NAME,
  TRANSCRIBE_AUDIO_TOOL_NAME
} from './document-tools'
import type { AgentBrain } from './brain'

describe('document parser tools', () => {
  it('parses markdown files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-md-'))
    try {
      const path = join(root, 'note.md')
      writeFileSync(path, '# Title\n\nContent', 'utf8')

      const result = await executeDocumentParseTool(
        PARSE_MARKDOWN_TOOL_NAME,
        JSON.stringify({ path }),
        {} as AgentBrain
      )

      expect(result).toMatchObject({
        ok: true,
        type: 'markdown',
        path,
        content: '# Title\n\nContent'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('parses yaml configuration files as text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-yaml-'))
    try {
      const path = join(root, 'deployment.yaml')
      const content = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: showfront\n'
      writeFileSync(path, content, 'utf8')

      const result = await executeDocumentParseTool(
        PARSE_MARKDOWN_TOOL_NAME,
        JSON.stringify({ path }),
        {} as AgentBrain
      )

      expect(result).toMatchObject({
        ok: true,
        type: 'markdown',
        path,
        content
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts text from docx files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-docx-'))
    try {
      const path = join(root, 'sample.docx')
      writeFileSync(
        path,
        createZip({
          'word/document.xml':
            '<w:document><w:body><w:p><w:r><w:t>Hello &amp; DOCX</w:t></w:r></w:p></w:body></w:document>'
        })
      )

      const result = await executeDocumentParseTool(
        PARSE_DOCX_TOOL_NAME,
        JSON.stringify({ path }),
        {} as AgentBrain
      )

      expect(result).toMatchObject({
        ok: true,
        type: 'docx',
        path,
        content: 'Hello & DOCX'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts text from simple flate PDF streams', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-pdf-'))
    try {
      const path = join(root, 'sample.pdf')
      const stream = deflateSync(Buffer.from('BT (Hello PDF) Tj ET', 'latin1'))
      writeFileSync(
        path,
        Buffer.concat([
          Buffer.from(
            '%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Filter /FlateDecode /Length '
          ),
          Buffer.from(String(stream.length)),
          Buffer.from(' >>\nstream\n'),
          stream,
          Buffer.from('\nendstream\nendobj\n%%EOF')
        ])
      )

      const result = await executeDocumentParseTool(
        PARSE_PDF_TOOL_NAME,
        JSON.stringify({ path }),
        {} as AgentBrain
      )

      expect(result).toMatchObject({
        ok: true,
        type: 'pdf',
        path,
        content: 'Hello PDF'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('analyzes image files through the agent brain', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-image-'))
    try {
      const path = join(root, 'pixel.png')
      writeFileSync(path, createPngHeader(2, 3))
      const brain = {
        analyzeImage: vi.fn(async () => 'a tiny image')
      } as unknown as AgentBrain

      const result = await executeDocumentParseTool(
        ANALYZE_IMAGE_TOOL_NAME,
        JSON.stringify({ path, prompt: 'describe' }),
        brain
      )

      expect(brain.analyzeImage).toHaveBeenCalled()
      expect(result).toMatchObject({
        ok: true,
        type: 'image',
        path,
        mimeType: 'image/png',
        width: 2,
        height: 3,
        analysis: 'a tiny image'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('transcribes audio files through the agent brain', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crescent-audio-'))
    try {
      const path = join(root, 'sample.mp3')
      writeFileSync(path, Buffer.from([1, 2, 3]))
      const brain = {
        transcribeAudio: vi.fn(async () => 'hello audio')
      } as unknown as AgentBrain

      const result = await executeDocumentParseTool(
        TRANSCRIBE_AUDIO_TOOL_NAME,
        JSON.stringify({ path, language: 'en' }),
        brain
      )

      expect(brain.transcribeAudio).toHaveBeenCalledWith(
        expect.objectContaining({ path, language: 'en' })
      )
      expect(result).toMatchObject({
        ok: true,
        type: 'audio',
        path,
        mimeType: 'audio/mpeg',
        transcript: 'hello audio'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function createZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name)
    const contentBuffer = Buffer.from(content)
    const compressed = deflateRawSync(contentBuffer)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(contentBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localParts.push(localHeader, nameBuffer, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(contentBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.length + nameBuffer.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralDirectory, end])
}

function createPngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}
