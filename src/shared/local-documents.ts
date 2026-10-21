export interface LocalDocumentRequest {
  path: string
  offset?: number
  limit?: number
  query?: string
}
export interface LocalDocumentPage {
  path: string
  encoding: string
  lines: Array<{ line: number; text: string }>
  hasMore: boolean
  scannedLines: number
}
export interface LocalDocumentNode {
  path: string
  name: string
  directory: boolean
}
export const LOCAL_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
export const LOCAL_DOCUMENT_PAGE_BYTES = 50000
