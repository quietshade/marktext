import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import type { WebPreferences } from 'electron'
import { launchElectron } from './helpers'

// Asserts the renderer is actually sandboxed: contextIsolation: true,
// nodeIntegration: false, sandbox: true. If any of these regress, the bridge
// is no longer load-bearing and the security boundary is gone — this single
// test is the canary.

test.describe('Renderer sandboxing', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('contextBridge active, nodeIntegration disabled, no preload leakage', async() => {
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents as Electron.WebContents & {
        getLastWebPreferences: () => WebPreferences
      }
      const prefs = contents.getLastWebPreferences()
      return {
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
        webSecurity: prefs.webSecurity
      }
    })
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    })

    expect(await page.evaluate(() => typeof window.electron?.ipcRenderer?.invoke)).toBe('function')

    expect(await page.evaluate(() => typeof require)).toBe('undefined')
    expect(await page.evaluate(() => typeof global)).toBe('undefined')
    expect(await page.evaluate(() => typeof Buffer)).toBe('undefined')

    const leaked = await page.evaluate(() =>
      ['fileUtilsAPI', 'electronAPI', 'pathAPI', 'commandAPI'].some((name) => name in window)
    )
    expect(leaked).toBe(false)
  })
})
