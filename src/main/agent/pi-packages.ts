import { getCrescentPiAgentDir } from './pi-paths'
import { loadPiSdk } from './pi-sdk'

export async function createCrescentSettingsManager(cwd: string): Promise<{
  settingsManager: ReturnType<
    (typeof import('@earendil-works/pi-coding-agent'))['SettingsManager']['create']
  >
  agentDir: string
}> {
  const pi = await loadPiSdk()
  const agentDir = getCrescentPiAgentDir()
  const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: false })
  settingsManager.setProjectTrusted(false)
  settingsManager.applyOverrides({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 }
  })
  return { settingsManager, agentDir }
}
