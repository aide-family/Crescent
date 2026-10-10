import { promises as fs } from 'fs'
import { basename, extname, resolve } from 'path'
import {
  BrowserWindow,
  dialog,
  nativeImage,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import { AgentBrain } from './brain'
import { readAgentConfig } from '../crescent-store'
import { getCrescentAttachmentsDir } from '../crescent-paths'
import { decodeAttachmentBase64 } from '../ipc-security'
import type {
  AgentPathReference,
  PastedAttachmentInput,
  TranscribeAudioInput,
  TranscribeAudioResult
} from './types'

export async function importOpenApiDocument(
  webContents: WebContents
): Promise<{ ok: boolean; path?: string; canceled?: boolean }> {
  const options: OpenDialogOptions = {
    title: 'Import OpenAPI document',
    properties: ['openFile'],
    filters: [
      { name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  if (selection.canceled || !selection.filePaths[0]) {
    return { ok: false, canceled: true }
  }

  return { ok: true, path: resolve(selection.filePaths[0]) }
}

export async function savePastedAttachment(
  input: PastedAttachmentInput
): Promise<AgentPathReference> {
  const data = decodeAttachmentBase64(input.base64)
  const attachmentDir = getCrescentAttachmentsDir()
  await fs.mkdir(attachmentDir, { recursive: true })

  const fallbackName = input.mimeType?.startsWith('image/')
    ? 'pasted-image'
    : input.mimeType?.startsWith('audio/')
      ? 'voice-input'
      : 'pasted-file'
  const safeName = sanitizeAttachmentName(input.name || fallbackName)
  const extension = extname(safeName) || extensionFromMimeType(input.mimeType)
  const baseName = sanitizeAttachmentName(
    safeName.slice(0, safeName.length - extname(safeName).length)
  )
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName || fallbackName}${extension}`
  const path = resolve(attachmentDir, filename)

  await fs.writeFile(path, data, { mode: 0o600 })

  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    name: basename(path) || path
  }
}

export async function requestMicrophonePermission(): Promise<{ ok: boolean; granted: boolean }> {
  if (process.platform !== 'darwin') return { ok: true, granted: true }

  const { systemPreferences } = await import('electron')
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { ok: true, granted: true }
  if (status === 'denied' || status === 'restricted') return { ok: true, granted: false }

  const granted = await systemPreferences.askForMediaAccess('microphone')
  return { ok: true, granted }
}

export async function transcribeAudioAttachment(
  input: TranscribeAudioInput
): Promise<TranscribeAudioResult> {
  const base64 = input?.base64?.trim() ?? ''
  if (!base64) return { ok: false, error: 'Audio data is empty.' }

  try {
    const saved = await savePastedAttachment({
      name: input.name || 'voice-input.webm',
      mimeType: input.mimeType || 'audio/webm',
      base64
    })
    const text = (
      await new AgentBrain(readAgentConfig()).transcribeAudio({
        path: saved.path,
        language: input.language
      })
    ).trim()
    if (!text) return { ok: false, error: 'Transcription returned empty text.', path: saved.path }
    return { ok: true, text, path: saved.path }
  } catch (error) {
    return {
      ok: false,
      error: formatTranscriptionError(error)
    }
  }
}

function formatTranscriptionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined

  if (status === 404 || /404|Not Found/i.test(message)) {
    return 'Current model provider does not support audio transcription (/audio/transcriptions). Use an OpenAI-compatible provider that exposes Whisper, or rely on system speech recognition.'
  }

  // OpenAI SDK often includes "404 ... no body" / empty response text.
  if (/no body/i.test(message)) {
    return `${message} (provider likely missing /audio/transcriptions)`
  }

  return message
}

export async function saveRenderedImage(
  webContents: WebContents,
  input: { dataUrl?: string; defaultPath?: string }
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const data = input.dataUrl?.match(/^data:image\/[^,;]+;base64,(.+)$/)?.[1]
  decodeAttachmentBase64(data)
  const image = nativeImage.createFromDataURL(input.dataUrl ?? '')
  if (image.isEmpty()) return { ok: false, error: 'Image data is empty.' }

  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showSaveDialog(browserWindow, {
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
    : await dialog.showSaveDialog({
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })

  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }

  await fs.writeFile(resolve(selection.filePath), image.toPNG())
  return { ok: true, path: resolve(selection.filePath) }
}

export async function saveSvgAsPng(
  webContents: WebContents,
  input: { svg?: string; defaultPath?: string; width?: number; height?: number }
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const svg = input.svg?.trim() ?? ''
  if (!svg.includes('<svg')) return { ok: false, error: 'SVG content is empty.' }

  const width = Math.max(1, Math.ceil(input.width || 1200))
  const height = Math.max(1, Math.ceil(input.height || 800))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width > 32768 || height > 32768) {
    return { ok: false, error: 'Invalid image dimensions (maximum 32768 per side).' }
  }
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showSaveDialog(browserWindow, {
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
    : await dialog.showSaveDialog({
        defaultPath: input.defaultPath || 'crescent-mermaid.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })

  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }

  const maxCaptureSide = 8192
  const scale = Math.min(1, maxCaptureSide / width, maxCaptureSide / height)
  const captureWidth = Math.max(1, Math.ceil(width * scale))
  const captureHeight = Math.max(1, Math.ceil(height * scale))
  const exportWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#171717',
    width: captureWidth,
    height: captureHeight,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      javascript: false,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    exportWindow.setContentSize(captureWidth, captureHeight)
    const html = buildSvgExportHtml(svg, width, height, scale)
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const image = await exportWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureWidth,
      height: captureHeight
    })
    if (image.isEmpty()) return { ok: false, error: 'Captured PNG image is empty.' }

    const path = resolve(selection.filePath)
    await fs.writeFile(path, image.toPNG())
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!exportWindow.isDestroyed()) exportWindow.close()
  }
}

function buildSvgExportHtml(svg: string, width: number, height: number, scale: number): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
    <style>
      html,
      body {
        width: ${Math.ceil(width * scale)}px;
        height: ${Math.ceil(height * scale)}px;
        margin: 0;
        overflow: hidden;
        background: #171717;
      }

      .export-frame {
        width: ${width}px;
        height: ${height}px;
        transform: scale(${scale});
        transform-origin: top left;
        background: #171717;
      }

      svg {
        display: block;
        width: ${width}px !important;
        height: ${height}px !important;
        max-width: none !important;
        max-height: none !important;
        background: #171717;
      }
    </style>
  </head>
  <body>
    <div class="export-frame">${svg}</div>
  </body>
</html>`
}

export async function pickSavePath(
  webContents: WebContents,
  input: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
): Promise<{ ok: boolean; path?: string; canceled?: boolean }> {
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const options = {
    defaultPath: input.defaultPath || 'crescent-export',
    filters: input.filters
  }
  const selection = browserWindow
    ? await dialog.showSaveDialog(browserWindow, options)
    : await dialog.showSaveDialog(options)

  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }
  const path = resolve(selection.filePath)
  rememberAllowedSavePath(path, webContents.id)
  return { ok: true, path }
}

/** Paths returned by pickSavePath; writeDataUrlFile only accepts these. */
const allowedSavePaths = new Map<string, { expiresAt: number; ownerId: number }>()
const ALLOWED_SAVE_PATH_TTL_MS = 5 * 60_000

function rememberAllowedSavePath(path: string, ownerId: number): void {
  const now = Date.now()
  for (const [entry, expiresAt] of allowedSavePaths.entries()) {
    if (expiresAt.expiresAt <= now) allowedSavePaths.delete(entry)
  }
  allowedSavePaths.set(path, { expiresAt: now + ALLOWED_SAVE_PATH_TTL_MS, ownerId })
}

function consumeAllowedSavePath(path: string, ownerId: number): boolean {
  const expiresAt = allowedSavePaths.get(path)
  if (!expiresAt || expiresAt.ownerId !== ownerId) return false
  allowedSavePaths.delete(path)
  return expiresAt.expiresAt > Date.now()
}

export async function writeDataUrlFile(
  ownerId: number,
  input: {
    path?: string
    dataUrl?: string
  }
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const path = input.path ? resolve(input.path) : ''
  const match = input.dataUrl?.match(/^data:[^,]*;base64,(.+)$/)
  if (!path) return { ok: false, error: 'A save path is required.' }
  if (!match) return { ok: false, error: 'A base64 data URL is required.' }
  if (!consumeAllowedSavePath(path, ownerId)) {
    return {
      ok: false,
      error: 'Save path must come from a recent save dialog selection.'
    }
  }

  try {
    await fs.writeFile(path, decodeAttachmentBase64(match[1]), { mode: 0o600 })
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function sanitizeAttachmentName(value: string): string {
  const name = basename(value.trim() || 'attachment')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return name.slice(0, 120) || 'attachment'
}

function extensionFromMimeType(mimeType?: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'application/pdf':
      return '.pdf'
    case 'audio/webm':
      return '.webm'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return '.wav'
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3'
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return '.m4a'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/flac':
      return '.flac'
    default:
      return ''
  }
}
