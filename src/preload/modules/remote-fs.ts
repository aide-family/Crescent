import { ipcRenderer } from 'electron'
import type {
  RemoteFsListInput,
  RemoteFsListResult,
  RemoteFsReadInput,
  RemoteFsReadResult
} from '../../shared/remote-fs-types'

export const remoteFsApi = {
  list: (input: RemoteFsListInput): Promise<RemoteFsListResult> =>
    ipcRenderer.invoke('remote-fs:list', input),
  read: (input: RemoteFsReadInput): Promise<RemoteFsReadResult> =>
    ipcRenderer.invoke('remote-fs:read', input)
}
