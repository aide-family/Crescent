import type { ConnectionConfig } from '../../../shared/agent-types'
import { LOCAL_CONNECTION_ID } from '../../../shared/local-connection'

export { LOCAL_CONNECTION_ID, resolveOpsConnectionId } from '../../../shared/local-connection'

export const WIKI_TARGET_PREVIEW_SHEET_RATIO = 0.8
export const WIKI_DOCUMENT_LIST_WIDTH = 280
export const WIKI_HEADING_NAV_WIDTH = 180
export const WIKI_SHEET_SELECTED_FIXED_WIDTH =
  WIKI_DOCUMENT_LIST_WIDTH + 12 + WIKI_HEADING_NAV_WIDTH + 12 + 32
export const WIKI_MIN_PREVIEW_WIDTH = 360
export const WIKI_FALLBACK_PREVIEW_WIDTH = 620
export const WIKI_REFRESH_MIN_LOADING_MS = 350

export function getDefaultWikiPreviewWidth(): number {
  if (typeof window === 'undefined') return WIKI_FALLBACK_PREVIEW_WIDTH

  return Math.max(
    WIKI_MIN_PREVIEW_WIDTH,
    Math.floor(window.innerWidth * WIKI_TARGET_PREVIEW_SHEET_RATIO) -
      WIKI_SHEET_SELECTED_FIXED_WIDTH
  )
}

export function buildModelSelectionValue(providerId: string | undefined, model: string): string {
  return `${encodeURIComponent(providerId ?? '')}:${encodeURIComponent(model)}`
}

export function parseModelSelectionValue(value: string): { providerId: string; model: string } {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex < 0) return { providerId: '', model: decodeURIComponent(value) }

  return {
    providerId: decodeURIComponent(value.slice(0, separatorIndex)),
    model: decodeURIComponent(value.slice(separatorIndex + 1))
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function isLocalConnection(connection: ConnectionConfig): boolean {
  return connection.source === 'local' || connection.id === LOCAL_CONNECTION_ID
}
