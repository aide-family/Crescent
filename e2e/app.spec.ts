import { expect, test, type Page } from '@playwright/test'

import { launchCrescent } from './helpers/app'

test.describe('Crescent desktop app', () => {
  const chatInput = (window: Page): ReturnType<Page['getByRole']> =>
    window.locator('[role="textbox"][data-placeholder]')

  const showChat = async (window: Page): Promise<void> => {
    const button = window.getByRole('button', { name: /show chat|显示对话/i })
    await button.click()
    await expect(chatInput(window)).toBeVisible()
  }

  test('launches and shows the core UI', async () => {
    const { app, window } = await launchCrescent()
    try {
      await expect(window).toHaveTitle('Crescent')
      await expect(window.getByRole('textbox', { name: 'Terminal input' })).toBeVisible()
      await expect(
        window.getByRole('button', { name: /manage connections|管理连接/i })
      ).toBeVisible()
      await expect(window.getByRole('button', { name: /show chat|显示对话/i })).toBeVisible()
      await showChat(window)
    } finally {
      await app.close()
    }
  })

  test('opens the manage-connections modal', async () => {
    const { app, window } = await launchCrescent()
    try {
      await window.getByRole('button', { name: /manage connections|管理连接/i }).click()
      await expect(window.locator('#connection-modal-title')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('opens the settings sheet through the app:open-settings flow', async () => {
    const { app, window } = await launchCrescent()
    try {
      // Ensure React listeners are mounted before sending the menu IPC.
      await expect(window.getByRole('textbox', { name: 'Terminal input' })).toBeVisible()
      await window.waitForTimeout(1_000)
      // The sheet title is locale-dependent ("Agent 设置" / "Agent settings");
      // match by content instead of the computed accessible name.
      const dialog = window.getByRole('dialog').filter({ hasText: /Agent 设置|Agent settings/ })
      // The renderer subscribes to the menu IPC shortly after mount; retry the
      // send until the sheet is observed.
      let lastError: unknown
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents
          contents?.send('app:open-settings')
        })
        try {
          await expect(dialog).toBeVisible({ timeout: 2_000 })
          return
        } catch {
          lastError = new Error(`settings sheet not visible (attempt ${attempt})`)
        }
      }
      throw new Error('settings sheet did not open via app:open-settings', { cause: lastError })
    } finally {
      await app.close()
    }
  })

  test('language toggle switches the chat placeholder', async () => {
    const { app, window } = await launchCrescent()
    try {
      await showChat(window)
      const languageButton = window.getByRole('button', { name: /language|语言/i })
      await expect(languageButton).toBeVisible()
      const before = await chatInput(window).getAttribute('data-placeholder')
      await languageButton.click()
      await expect.poll(() => chatInput(window).getAttribute('data-placeholder')).not.toBe(before)
    } finally {
      await app.close()
    }
  })
})
