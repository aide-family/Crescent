import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface LaunchedCrescent {
  app: ElectronApplication
  window: Page
  /** Isolated HOME so the run never touches the developer's ~/.crescent config. */
  userDataDir: string
}

/**
 * Launch the built app (`npm run build` first) with a throwaway HOME. The
 * sandbox flag is required on Linux CI where Electron runs as root.
 */
export async function launchCrescent(): Promise<LaunchedCrescent> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'crescent-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), '--no-sandbox'],
    env: {
      ...process.env,
      HOME: userDataDir,
      CRESCENT_DISABLE_GPU: '1'
    }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // Dismiss the first-run onboarding modal deterministically via storage.
  await window.evaluate(() => {
    localStorage.setItem('crescent.onboarding.dismissed', '1')
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  return { app, window, userDataDir }
}
