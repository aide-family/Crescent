import { toast } from 'sonner'

import type { Dictionary } from '@renderer/i18n'
import { TOAST_INTERVENTION_DURATION_MS } from '@renderer/lib/toast-policy'

export type OperationFeedback = {
  success: string
  failed: string
  canceled?: string
}

export function copyFeedback(t: Dictionary): OperationFeedback {
  return {
    success: t.common.copySucceeded,
    failed: t.common.copyFailed
  }
}

export function exportFeedback(t: Dictionary): OperationFeedback {
  return {
    success: t.common.exportSucceeded,
    failed: t.common.exportFailed,
    canceled: t.common.exportCanceled
  }
}

export function notifyOperationError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error || '')
  toast.error(detail ? `${message}: ${detail}` : message, {
    duration: TOAST_INTERVENTION_DURATION_MS
  })
}

export const COPY_FALLBACK_TEXTAREA_CSS =
  'position:fixed;left:-9999px;top:0;opacity:0;user-select:text;-webkit-user-select:text'

export function applyCopyFallbackTextareaStyle(textArea: { style: { cssText: string } }): void {
  textArea.style.cssText = COPY_FALLBACK_TEXTAREA_CSS
}

function notifyCopySuccess(feedback?: OperationFeedback): void {
  if (feedback) toast.success(feedback.success)
}

export async function copyText(value: string, feedback?: OperationFeedback): Promise<void> {
  try {
    const writeHost = globalThis.window?.api?.app?.writeClipboardText
    if (writeHost) {
      const result = await writeHost(value)
      if (result.ok) {
        notifyCopySuccess(feedback)
        return
      }
    }
  } catch {
    // Fall through to Chromium clipboard APIs.
  }

  try {
    await navigator.clipboard.writeText(value)
    notifyCopySuccess(feedback)
    return
  } catch (clipboardError) {
    const textArea = document.createElement('textarea')
    try {
      textArea.value = value
      applyCopyFallbackTextareaStyle(textArea)
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      const copied = document.execCommand('copy')
      if (!copied) throw clipboardError
      notifyCopySuccess(feedback)
    } catch (fallbackError) {
      if (feedback) notifyOperationError(feedback.failed, fallbackError)
      throw fallbackError
    } finally {
      textArea.remove()
    }
  }
}

async function textToDataUrl(value: string, type: string): Promise<string> {
  const blob = new Blob([value], { type })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read export content.'))
    reader.readAsDataURL(blob)
  })
}

export async function saveTextFile(
  value: string,
  filename: string,
  type: string,
  feedback: OperationFeedback,
  filters?: Array<{ name: string; extensions: string[] }>
): Promise<void> {
  try {
    const selection = await window.api.agent.pickSavePath({
      defaultPath: filename,
      filters
    })
    if (!selection.ok || !selection.path) {
      toast.info(feedback.canceled ?? feedback.failed)
      return
    }

    const dataUrl = await textToDataUrl(value, type)
    const result = await window.api.agent.writeDataUrlFile({ path: selection.path, dataUrl })
    if (!result.ok) throw new Error(result.error || 'Failed to write export file.')
    toast.success(feedback.success)
  } catch (error) {
    notifyOperationError(feedback.failed, error)
  }
}

export async function downloadMarkdown(
  value: string,
  filename: string,
  t: Dictionary
): Promise<void> {
  await saveTextFile(value, filename, 'text/markdown;charset=utf-8', exportFeedback(t), [
    { name: 'Markdown', extensions: ['md', 'markdown'] }
  ])
}

export async function downloadJson(value: string, filename: string, t: Dictionary): Promise<void> {
  await saveTextFile(value, filename, 'application/json;charset=utf-8', exportFeedback(t), [
    { name: 'JSON', extensions: ['json'] }
  ])
}
