import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MiB = 1024 * 1024
export const IPC_DEFAULT_MAX_BYTES = 4 * MiB
export const IPC_ATTACHMENT_MAX_BYTES = 32 * MiB
export const ATTACHMENT_MAX_BYTES = 20 * MiB

/** Bound before serialization/decoding; account for keys, depth and object count too. */
export function assertPayloadSize(value: unknown, limit = IPC_DEFAULT_MAX_BYTES): void {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let bytes = 0
  let nodes = 0
  const seen = new Set<object>()
  while (queue.length) {
    const { value: item, depth } = queue.pop()!
    if (++nodes > 100_000 || depth > 40) throw new Error('IPC payload is too complex')
    if (typeof item === 'string') bytes += Buffer.byteLength(item, 'utf8')
    else if (item && typeof item === 'object') {
      if (seen.has(item)) throw new Error('Cyclic IPC payload')
      seen.add(item)
      if (ArrayBuffer.isView(item)) bytes += item.byteLength
      else if (item instanceof ArrayBuffer) bytes += item.byteLength
      else
        for (const [key, nested] of Object.entries(item)) {
          bytes += Buffer.byteLength(key, 'utf8')
          queue.push({ value: nested, depth: depth + 1 })
        }
    } else bytes += 8
    if (bytes > limit) throw new Error(`IPC payload exceeds ${limit} bytes`)
  }
}

export function decodeAttachmentBase64(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('Invalid or oversized base64 attachment (maximum 20 MiB)')
  }
  const data = Buffer.from(value, 'base64')
  if (data.length > ATTACHMENT_MAX_BYTES) throw new Error('Attachment is too large')
  return data
}

export function assertTrustedRenderer(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const sender = event.sender
  const frame = event.senderFrame
  if (
    sender.isDestroyed() ||
    !BrowserWindow.fromWebContents(sender) ||
    !frame ||
    frame !== sender.mainFrame
  ) {
    throw new Error('Untrusted IPC sender')
  }
  const url = frame.url
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const trusted = devUrl
    ? new URL(url).origin === new URL(devUrl).origin
    : url === pathToFileURL(join(__dirname, '../renderer/index.html')).href
  if (!trusted) throw new Error('Untrusted IPC origin')
}

function validate(
  event: IpcMainEvent | IpcMainInvokeEvent,
  channel: string,
  args: unknown[]
): void {
  assertTrustedRenderer(event)
  const attachment = /(?:attachment|transcribe-audio|write-data-url|export)/.test(channel)
  assertPayloadSize(args, attachment ? IPC_ATTACHMENT_MAX_BYTES : IPC_DEFAULT_MAX_BYTES)
}

export const rendererIpc = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(channel, (event, ...args) => {
      validate(event, channel, args)
      return listener(event, ...args)
    })
  },
  on(channel: string, listener: Parameters<typeof ipcMain.on>[1]): void {
    ipcMain.on(channel, (event, ...args) => {
      try {
        validate(event, channel, args)
        const result = listener(event, ...args) as unknown
        if (result instanceof Promise)
          void result.catch(() => console.warn(`Rejected IPC message on ${channel}`))
      } catch {
        console.warn(`Rejected IPC message on ${channel}`)
      }
    })
  }
}
