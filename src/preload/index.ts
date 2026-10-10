import { contextBridge } from 'electron'
import { api } from './api'

const electronAPI = { process: { platform: process.platform, versions: process.versions } }

if (!process.contextIsolated) {
  throw new Error('Crescent requires context isolation for its preload bridge.')
}
try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
