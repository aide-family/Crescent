import { ipcRenderer } from 'electron'
import type { ConnectionConfig, ConnectionInput } from '../../shared/agent-types'

export const connectionsApi = {
  list: (): Promise<ConnectionConfig[]> => ipcRenderer.invoke('connections:list'),
  resolve: (id: string): Promise<ConnectionConfig | undefined> =>
    ipcRenderer.invoke('connections:resolve', id),
  save: (input: ConnectionInput): Promise<ConnectionConfig[]> =>
    ipcRenderer.invoke('connections:save', input),
  delete: (id: string): Promise<ConnectionConfig[]> => ipcRenderer.invoke('connections:delete', id),
  getLastUsed: (): Promise<string | null> => ipcRenderer.invoke('connections:get-last-used'),
  setLastUsed: (id: string): Promise<string | null> =>
    ipcRenderer.invoke('connections:set-last-used', id),
  toggleFavorite: (id: string): Promise<ConnectionConfig[]> =>
    ipcRenderer.invoke('connections:toggle-favorite', id),
  reorder: (input: {
    id: string
    action: 'up' | 'down' | 'top' | 'bottom'
  }): Promise<ConnectionConfig[]> => ipcRenderer.invoke('connections:reorder', input)
}
