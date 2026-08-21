export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type AppUpdateStatusEvent =
  | { state: 'idle' }
  | { state: 'checking' }
  | {
      state: 'available'
      version: string
      releaseName?: string
      releaseNotes?: string
    }
  | { state: 'not-available'; version: string }
  | {
      state: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { state: 'downloaded'; version: string; installerPath?: string }
  | { state: 'error'; message: string }

export interface AppUpdateVersionResult {
  version: string
}

export interface AppUpdateActionResult {
  ok: boolean
  error?: string
  path?: string
  skipped?: boolean
}
