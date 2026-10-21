import { ipcRenderer } from 'electron'
import type {
  LocalDocumentNode,
  LocalDocumentRequest,
  LocalDocumentPage
} from '../../shared/local-documents'
export const documentsApi = {
  pdf: (path: string): Promise<{ path: string; base64: string }> =>
    ipcRenderer.invoke('documents:pdf', { path }),
  chooseRoot: (): Promise<string | undefined> => ipcRenderer.invoke('documents:choose-root'),
  list: (path: string): Promise<LocalDocumentNode[]> =>
    ipcRenderer.invoke('documents:list', { path }),
  read: (input: LocalDocumentRequest & { requestId: string }): Promise<LocalDocumentPage> =>
    ipcRenderer.invoke('documents:read', input),
  cancel: (requestId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('documents:cancel', requestId)
}
