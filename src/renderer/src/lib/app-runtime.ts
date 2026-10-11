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

export const SKILL_TARGET_SHEET_RATIO = 0.8
export const SKILL_LIST_COLUMN_WIDTH = 360
export const SKILL_SHEET_CHROME_WIDTH = 44
export const SKILL_MIN_DETAIL_WIDTH = 420
export const SKILL_FALLBACK_DETAIL_WIDTH = 720

export function getDefaultWikiPreviewWidth(): number {
  if (typeof window === 'undefined') return WIKI_FALLBACK_PREVIEW_WIDTH

  return Math.max(
    WIKI_MIN_PREVIEW_WIDTH,
    Math.floor(window.innerWidth * WIKI_TARGET_PREVIEW_SHEET_RATIO) -
      WIKI_SHEET_SELECTED_FIXED_WIDTH
  )
}

export function getDefaultSkillDetailWidth(): number {
  if (typeof window === 'undefined') return SKILL_FALLBACK_DETAIL_WIDTH

  return Math.max(
    SKILL_MIN_DETAIL_WIDTH,
    Math.floor(window.innerWidth * SKILL_TARGET_SHEET_RATIO) -
      SKILL_LIST_COLUMN_WIDTH -
      SKILL_SHEET_CHROME_WIDTH
  )
}

export function clampSkillDetailWidth(width: number, viewportWidth = window.innerWidth): number {
  const maxWidth = Math.max(
    SKILL_MIN_DETAIL_WIDTH,
    viewportWidth - 48 - SKILL_LIST_COLUMN_WIDTH - SKILL_SHEET_CHROME_WIDTH
  )
  return Math.max(SKILL_MIN_DETAIL_WIDTH, Math.min(maxWidth, width))
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
