import { defineConfig } from '@playwright/test'

/**
 * Crescent E2E suite. Electron apps are launched directly by the specs through
 * `e2e/helpers/app.ts`; no browser projects are needed here.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
