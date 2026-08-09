import { promises as fs } from 'fs'
import { basename, extname, resolve } from 'path'

import {
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  type OpenDialogOptions,
  type WebContents
} from 'electron'

import { listEditableInstructionFiles, saveEditableInstructionFile } from './instruction-files'
import { AgentMemory } from './memory'
import { AgentBrain } from './brain'
import { checkTranscriptionSupport } from './transcription-support'
import {
  buildLocalOnlyConnectionIntentResult,
  CONNECTION_INTENT_SYSTEM_PROMPT,
  parseConnectionIntentResponse,
  summarizeConnectionForAi
} from './connection-intent'
import {
  deleteAgentSkill,
  installAgentSkill,
  listAgentSkills,
  readAgentSkillContent,
  searchAgentSkills,
  startAgentSkillInstall
} from './skills'
import { generateAndSaveSop } from './generate-sop'
import { cancelPiAgentRun, runPiAgent, steerPiAgentRun } from './pi-host'
import {
  listPiAvailableModels,
  resolvePiModel,
  syncCrescentProvidersToModelRuntime
} from './pi-model-runtime'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { BUILT_IN_TOOL_CATALOG } from '../../shared/agent-tool-catalog'
import { rejectPendingApprovalsForTab, resolveCommandApprovalDecision } from './command-approval'
import { resolveAgentSubterminalReady } from './pi-open-subterminal'
import { safeWebContentsSend } from '../safe-ipc-send'
import {
  getWikiDocument,
  deleteWikiDocument,
  listWikiDocuments,
  saveWikiDocument,
  searchWikiDocuments
} from './wiki'
import {
  appendOperationRecord,
  readAgentConfig,
  readCrescentMemory,
  readCustomConnections,
  writeAgentConfig,
  writeCrescentMemory,
  normalizeAgentConfig
} from '../crescent-store'
import { loadSshConfigConnections } from '../connections/ssh-config'
import { getCrescentAttachmentsDir } from '../crescent-paths'
import type {
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentGenerateSopInput,
  AgentPathReference,
  AgentRunInput,
  CommandApprovalDecision,
  PastedAttachmentInput,
  TranscribeAudioInput,
  TranscribeAudioResult,
  TranscriptionSupportResult,
  WikiSaveInput
} from './types'

const activeSkillInstalls = new Map<string, { cancel: () => void }>()

export function registerAgentIpc(): void {
  ipcMain.handle('agent:get-config', () => {
    return readAgentConfig()
  })

  ipcMain.handle('agent:get-models', async () => {
    return listPiAvailableModels(readAgentConfig())
  })

  ipcMain.handle('agent:list-skills', () => {
    return listAgentSkills(readAgentConfig().skillRoot)
  })

  ipcMain.handle('agent:search-skills', (_, query: string) => {
    return searchAgentSkills(query ?? '')
  })

  ipcMain.handle(
    'agent:install-skill',
    (_, payload: { installSource?: string; installSkill?: string }) => {
      return installAgentSkill({
        installSource: payload?.installSource ?? '',
        installSkill: payload?.installSkill ?? '',
        skillRoot: readAgentConfig().skillRoot
      })
    }
  )

  ipcMain.handle(
    'agent:start-skill-install',
    (event, payload: { installSource?: string; installSkill?: string }) => {
      const installId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const webContents = event.sender
      const session = startAgentSkillInstall(
        {
          installSource: payload?.installSource ?? '',
          installSkill: payload?.installSkill ?? '',
          skillRoot: readAgentConfig().skillRoot
        },
        (data) => {
          safeWebContentsSend(webContents, 'agent:skill-install-event', {
            installId,
            type: 'log',
            data
          })
        }
      )

      activeSkillInstalls.set(installId, { cancel: session.cancel })
      session.promise
        .then((result) => {
          safeWebContentsSend(webContents, 'agent:skill-install-event', {
            installId,
            type: 'done',
            result
          })
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          safeWebContentsSend(webContents, 'agent:skill-install-event', {
            installId,
            type: 'error',
            error: message,
            canceled: /canceled/i.test(message)
          })
        })
        .finally(() => {
          activeSkillInstalls.delete(installId)
        })

      return { ok: true, installId }
    }
  )

  ipcMain.handle('agent:cancel-skill-install', (_, installId: string) => {
    const session = activeSkillInstalls.get(installId)
    if (!session) return { ok: false }

    session.cancel()
    return { ok: true }
  })

  ipcMain.handle('agent:delete-skill', (_, path: string) => {
    return deleteAgentSkill(path ?? '', readAgentConfig().skillRoot)
  })

  ipcMain.handle('agent:get-skill-content', (_, path: string) => {
    return readAgentSkillContent(path ?? '', readAgentConfig().skillRoot)
  })

  ipcMain.handle('agent:generate-sop', async (_, payload: AgentGenerateSopInput) => {
    return generateAndSaveSop(
      {
        summary: payload?.summary ?? '',
        locale: payload?.locale,
        fallbackTitle: payload?.fallbackTitle,
        fallbackContent: payload?.fallbackContent
      },
      { config: readAgentConfig() }
    )
  })

  ipcMain.handle('agent:list-instruction-files', () => {
    return listEditableInstructionFiles()
  })

  ipcMain.handle('agent:list-wiki-documents', () => {
    return listWikiDocuments()
  })

  ipcMain.handle('agent:get-wiki-document', (_, id: string) => {
    return getWikiDocument(id ?? '')
  })

  ipcMain.handle('agent:save-wiki-document', (_, input: WikiSaveInput) => {
    return saveWikiDocument(input)
  })

  ipcMain.handle('agent:delete-wiki-document', (_, id: string) => {
    return deleteWikiDocument(id ?? '')
  })

  ipcMain.handle('agent:search-wiki-documents', (_, query: string) => {
    return searchWikiDocuments(query ?? '', 12, 6000)
  })

  ipcMain.handle(
    'agent:pick-path-reference',
    async (event, payload: { kind?: AgentPathReference['kind'] }) => {
      const kind = payload?.kind === 'directory' ? 'directory' : 'file'
      const selection = await pickAgentPathReference(event.sender, kind)
      return selection
    }
  )

  ipcMain.handle('agent:import-openapi-document', async (event) => {
    return importOpenApiDocument(event.sender)
  })

  ipcMain.handle('agent:save-pasted-attachment', async (_, payload: PastedAttachmentInput) => {
    return savePastedAttachment(payload)
  })

  ipcMain.handle('agent:request-microphone-permission', async () => {
    return requestMicrophonePermission()
  })

  ipcMain.handle('agent:transcribe-audio', async (_, payload: TranscribeAudioInput) => {
    return transcribeAudioAttachment(payload)
  })

  ipcMain.handle(
    'agent:check-transcription-support',
    async (
      _,
      payload?: { forceRefresh?: boolean; providerId?: string; model?: string }
    ): Promise<TranscriptionSupportResult> => {
      const config = normalizeAgentConfig({
        ...readAgentConfig(),
        ...(payload?.providerId ? { providerId: payload.providerId } : {}),
        ...(payload?.model ? { model: payload.model } : {})
      })
      return checkTranscriptionSupport(config, {
        forceRefresh: payload?.forceRefresh,
        providerId: payload?.providerId,
        model: payload?.model
      })
    }
  )

  ipcMain.handle(
    'agent:save-rendered-image',
    async (event, payload: { dataUrl?: string; defaultPath?: string }) => {
      return saveRenderedImage(event.sender, payload)
    }
  )
  ipcMain.handle(
    'agent:save-svg-as-png',
    async (
      event,
      payload: { svg?: string; defaultPath?: string; width?: number; height?: number }
    ) => {
      return saveSvgAsPng(event.sender, payload)
    }
  )
  ipcMain.handle(
    'agent:pick-save-path',
    async (
      event,
      payload: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
    ) => {
      return pickSavePath(event.sender, payload)
    }
  )
  ipcMain.handle(
    'agent:write-data-url-file',
    async (_, payload: { path?: string; dataUrl?: string }) => {
      return writeDataUrlFile(payload)
    }
  )

  ipcMain.handle(
    'agent:save-instruction-file',
    (_, payload: { name?: string; content?: string }) => {
      return saveEditableInstructionFile({
        name: payload?.name ?? '',
        content: payload?.content ?? ''
      })
    }
  )

  ipcMain.handle('agent:save-config', (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      ...config
    })

    return writeAgentConfig(nextConfig)
  })

  ipcMain.handle('agent:validate-config', async (_, config: Partial<AgentConfig>) => {
    const nextConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      ...config
    })

    try {
      await validateModel(nextConfig)
      const cwd = resolveAgentWorkspaceCwd(nextConfig)
      return {
        ok: true,
        modelOk: true,
        toolCount: BUILT_IN_TOOL_CATALOG.length,
        tools: BUILT_IN_TOOL_CATALOG.map((tool) =>
          tool.name === 'bash'
            ? {
                ...tool,
                description: `Run a local bash command in ${cwd}.`
              }
            : tool
        )
      }
    } catch (error) {
      return {
        ok: false,
        modelOk: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:cancel', async (_, runId: string) => {
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : ''
    if (!normalizedRunId) return { ok: false }
    const ok = await cancelPiAgentRun(normalizedRunId)
    return { ok }
  })

  ipcMain.handle('agent:reject-approvals-for-tab', (_, tabId: string) => {
    const normalized = typeof tabId === 'string' ? tabId.trim() : ''
    if (normalized) rejectPendingApprovalsForTab(normalized, 'Session was closed.')
    return { ok: true }
  })

  ipcMain.handle('agent:supplement', async (_, payload: { runId?: string; input?: string }) => {
    const runId = payload?.runId?.trim()
    const input = payload?.input?.trim()
    if (!runId || !input) return { ok: false }
    const ok = await steerPiAgentRun(runId, input)
    return { ok }
  })

  ipcMain.handle('agent:resolve-command-approval', (_, decision: CommandApprovalDecision) => {
    return resolveCommandApprovalDecision(decision)
  })

  ipcMain.handle(
    'agent:ack-subterminal-opened',
    (_, payload: { tabId?: string; ok?: boolean; error?: string }) => {
      return resolveAgentSubterminalReady(payload)
    }
  )

  ipcMain.handle('agent:generate-command', async () => {
    return {
      ok: false,
      error: 'Command generation was removed. Use the Pi coding agent chat instead.'
    }
  })

  ipcMain.handle(
    'agent:resolve-connection-intent',
    async (_, payload: AgentConnectionIntentInput): Promise<AgentConnectionIntentResult> => {
      const input = payload?.input?.trim()
      if (!input) return { ok: false, error: 'Input is empty.' }
      const localOnlyIntent = buildLocalOnlyConnectionIntentResult(input)
      if (localOnlyIntent) return localOnlyIntent

      const connections = [...loadSshConfigConnections(), ...readCustomConnections()]
      if (connections.length === 0) return { ok: false, reason: 'No configured connections.' }

      try {
        const completion = await new AgentBrain(readAgentConfig()).chat({
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: CONNECTION_INTENT_SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  request: input,
                  conversationContext: payload.conversationContext ?? '',
                  currentConnectionId: payload.currentConnectionId ?? null,
                  currentConnectionName: payload.currentConnectionName ?? null,
                  terminalSummary: payload.terminalSummary ?? '',
                  connections: connections.map(summarizeConnectionForAi)
                },
                null,
                2
              )
            }
          ]
        })
        return parseConnectionIntentResponse(
          completion.choices[0]?.message.content ?? '',
          connections
        )
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('agent:run', async (event, payload: AgentRunInput) => {
    const input = payload?.input?.trim()
    const runId =
      payload?.runId?.trim() || `run-${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (!input) {
      return { ok: false, error: 'Input is empty.' }
    }

    if (input.startsWith('/remember ')) {
      const memory = createMemory()
      memory.addLongTermNote(input.slice('/remember '.length))
      safeWebContentsSend(event.sender, 'agent:event', {
        type: 'done',
        message: 'Saved to long-term memory.',
        runId,
        tabId: payload?.tabId
      })
      return { ok: true, text: 'Saved to long-term memory.' }
    }

    const agentConfig = normalizeAgentConfig({
      ...readAgentConfig(),
      providerId: payload?.providerId,
      model: payload?.model
    })
    const sessionKey = payload?.tabId?.trim() || 'default'
    const executionTabId = payload?.executionTabId?.trim() || payload?.tabId?.trim() || ''
    const wikiIds = [...new Set((payload?.activeWikiIds ?? []).map((id) => id.trim()).filter(Boolean))]
    const activeWikiDocs = (
      await Promise.all(wikiIds.map((id) => getWikiDocument(id)))
    )
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
      .map((doc) => ({ title: doc.title, content: doc.content }))

    const skillRoot = agentConfig.skillRoot
    const skillPaths = [
      ...new Set((payload?.activeSkillPaths ?? []).map((path) => path.trim()).filter(Boolean))
    ]
    const skillCatalog = skillPaths.length ? listAgentSkills(skillRoot) : []
    const activeSkillDocs = skillPaths.flatMap((skillPath) => {
      try {
        const content = readAgentSkillContent(skillPath, skillRoot)
        const resolved = resolve(skillPath)
        const matched = skillCatalog.find((skill) => resolve(skill.path) === resolved)
        return [
          {
            name: matched?.name ?? skillPath.split('/').filter(Boolean).slice(-2, -1)[0] ?? 'Skill',
            path: matched?.path ?? skillPath,
            content
          }
        ]
      } catch {
        return []
      }
    })

    const result = await runPiAgent({
      runId,
      sessionKey,
      input,
      config: agentConfig,
      tabId: payload?.tabId,
      conversationContext: payload?.conversationContext,
      webContents: event.sender,
      executionTabId,
      terminalContext: payload?.terminalContext,
      locale: payload?.locale,
      activeWikiDocs,
      activeSkillDocs,
      emit: (agentEvent) => {
        safeWebContentsSend(event.sender, 'agent:event', {
          ...agentEvent,
          runId,
          tabId: agentEvent.tabId ?? payload?.tabId
        })
      }
    })

    appendOperationRecord({
      status: result.ok ? 'success' : 'error',
      summary: input,
      output: result.text || result.error
    })

    return result
  })
}

async function pickAgentPathReference(
  webContents: WebContents,
  kind: AgentPathReference['kind']
): Promise<AgentPathReference | undefined> {
  const options: OpenDialogOptions = {
    properties: [kind === 'directory' ? 'openDirectory' : 'openFile']
  }
  const browserWindow = BrowserWindow.fromWebContents(webContents) ?? undefined
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  if (selection.canceled || !selection.filePaths[0]) return undefined

  const path = resolve(selection.filePaths[0])

  return {
    id: `${kind}:${path}`,
    kind,
    path,
    name: basename(path) || path
  }
}

async function importOpenApiDocument(
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

async function savePastedAttachment(input: PastedAttachmentInput): Promise<AgentPathReference> {
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

  await fs.writeFile(path, Buffer.from(input.base64 ?? '', 'base64'))

  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    name: basename(path) || path
  }
}

async function requestMicrophonePermission(): Promise<{ ok: boolean; granted: boolean }> {
  if (process.platform !== 'darwin') return { ok: true, granted: true }

  const { systemPreferences } = await import('electron')
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { ok: true, granted: true }
  if (status === 'denied' || status === 'restricted') return { ok: true, granted: false }

  const granted = await systemPreferences.askForMediaAccess('microphone')
  return { ok: true, granted }
}

async function transcribeAudioAttachment(
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

async function saveRenderedImage(
  webContents: WebContents,
  input: { dataUrl?: string; defaultPath?: string }
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
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

async function saveSvgAsPng(
  webContents: WebContents,
  input: { svg?: string; defaultPath?: string; width?: number; height?: number }
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const svg = input.svg?.trim() ?? ''
  if (!svg.includes('<svg')) return { ok: false, error: 'SVG content is empty.' }

  const width = Math.max(1, Math.ceil(input.width || 1200))
  const height = Math.max(1, Math.ceil(input.height || 800))
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

async function pickSavePath(
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
  return { ok: true, path: resolve(selection.filePath) }
}

async function writeDataUrlFile(input: {
  path?: string
  dataUrl?: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  const path = input.path ? resolve(input.path) : ''
  const match = input.dataUrl?.match(/^data:[^,]*;base64,(.+)$/)
  if (!path) return { ok: false, error: 'A save path is required.' }
  if (!match) return { ok: false, error: 'A base64 data URL is required.' }

  try {
    await fs.writeFile(path, Buffer.from(match[1], 'base64'))
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

function createMemory(): AgentMemory {
  return new AgentMemory(readCrescentMemory(), (nextMemory) => {
    writeCrescentMemory(nextMemory)
  })
}

async function validateModel(config: AgentConfig): Promise<void> {
  const runtime = await syncCrescentProvidersToModelRuntime(config)
  const model = await resolvePiModel(config, runtime)
  if (!model) {
    throw new Error('No model configured. Add a provider and model in Settings.')
  }
  if (!config.model?.trim()) {
    throw new Error('Model is required.')
  }
}
