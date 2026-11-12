import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import type * as FsPromises from 'node:fs/promises'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchElectron, openProjectFolder } from './helpers'

interface ReadGate {
  snapshot: () => { held: string[]; promotions: number[] }
  release: (name: string, fail: boolean) => void
  restore: () => void
}
interface Failure { requestId: number; pathname: string }

const installGate = async(app: ElectronApplication, page: Page, names: string[]) => {
  await app.evaluate(({ BrowserWindow, ipcMain }, names) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const io = process.getBuiltinModule('fs/promises') as typeof FsPromises
    const read = io.readFile
    const held: Array<{ name: string; resolve: () => void; reject: (error: Error) => void }> = []
    const promotions: number[] = []
    const promoted = (event: Electron.IpcMainEvent, requestId: number) => {
      if (event.sender === contents) promotions.push(requestId)
    }
    ipcMain.on('mt::promote-pending-preview', promoted)
    io.readFile = (async(...args: Parameters<typeof read>) => {
      const name = names.find(name => String(args[0]).endsWith(`${name}.md`))
      if (name) await new Promise<void>((resolve, reject) => held.push({ name, resolve, reject }))
      return read(...args)
    }) as typeof read
    Object.assign(globalThis, {
      sidebarReadGate: {
        snapshot: () => ({ held: held.map(entry => entry.name), promotions: [...promotions] }),
        release: (name: string, fail: boolean) => {
          const index = held.findIndex(entry => entry.name === name)
          if (index < 0) throw new Error(`No pending read for ${name}`)
          const [entry] = held.splice(index, 1)
          if (fail) entry.reject(Object.assign(new Error('Disposable read unavailable'), { code: 'EACCES' }))
          else entry.resolve()
        },
        restore: () => {
          io.readFile = read
          ipcMain.removeListener('mt::promote-pending-preview', promoted)
          for (const entry of held.splice(0)) entry.resolve()
        }
      }
    })
  }, names)
  await page.evaluate(() => {
    const failures: Failure[] = []
    Object.assign(window, { sidebarOpenFailures: failures })
    window.electron.ipcRenderer.on('mt::sidebar-open-failed', (_, requestId, pathname) => {
      failures.push({ requestId, pathname })
    })
  })
}

const gate = (app: ElectronApplication) => app.evaluate(() =>
  (globalThis as unknown as { sidebarReadGate: ReadGate }).sidebarReadGate.snapshot()
)
const release = (app: ElectronApplication, name: string, fail = false) => app.evaluate((_, { name, fail }) => {
  (globalThis as unknown as { sidebarReadGate: ReadGate }).sidebarReadGate.release(name, fail)
}, { name, fail })
const failures = (page: Page) => page.evaluate(() =>
  (window as unknown as { sidebarOpenFailures: Failure[] }).sidebarOpenFailures
)
const row = (page: Page, pathname: string) => page.locator('.tree-wrapper .side-bar-file').and(page.getByTitle(pathname, { exact: true }))
const tab = (page: Page, pathname: string) => page.locator('.tabs-container > li').and(page.getByTitle(pathname, { exact: true }))

for (const scenario of ['repeated failures', 'overlapping promotions'] as const) {
  test(`sidebar request cleanup: ${scenario}`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-sidebar-cleanup-'))
    const root = join(directory, 'project')
    mkdirSync(root)
    const alpha = join(root, 'alpha.md')
    const beta = join(root, 'beta.md')
    const gamma = join(root, 'gamma.md')
    writeFileSync(alpha, '\ufeff# Alpha  \r\n')
    writeFileSync(beta, '# Beta\n')
    writeFileSync(gamma, '# Gamma\n')
    const snapshot = () => [alpha, beta, gamma].map(file => ({ bytes: readFileSync(file).toString('hex'), mtime: statSync(file).mtimeMs }))
    const before = snapshot()
    const { app, page } = await launchElectron([], {
      preferences: {
        language: 'en', startUpAction: 'blank', sideBarVisibility: true, tabBarVisibility: true,
        openFilesInPreviewMode: true, autoRevealInSidebar: true, defaultOpenMode: 'read'
      }
    })
    try {
      await openProjectFolder(app, page, root, alpha)
      await installGate(app, page, scenario === 'repeated failures' ? ['alpha'] : ['alpha', 'beta'])
      if (scenario === 'repeated failures') {
        for (let index = 0; index < 3; index++) {
          await row(page, alpha).dblclick()
          await expect.poll(async() => (await gate(app)).promotions.length).toBe(index + 1)
          await expect.poll(async() => (await gate(app)).held).toEqual(['alpha'])
          await release(app, 'alpha', true)
          await expect.poll(async() => (await failures(page)).length).toBe(index + 1)
          expect((await failures(page))[index]).toEqual({ requestId: (await gate(app)).promotions[index], pathname: alpha })
          await expect(tab(page, alpha)).toHaveCount(0)
        }
        await row(page, alpha).dblclick()
        await expect.poll(async() => (await gate(app)).promotions.length).toBe(4)
        await release(app, 'alpha')
        await expect(tab(page, alpha)).not.toHaveClass(/preview/)
        await row(page, beta).click()
        await expect(tab(page, beta)).toHaveClass(/preview/)
        await row(page, alpha).dblclick()
        await expect(tab(page, alpha)).toHaveClass(/active/)
      } else {
        await row(page, alpha).dblclick()
        await expect.poll(async() => (await gate(app)).promotions.length).toBe(1)
        await row(page, beta).dblclick()
        await expect.poll(async() => (await gate(app)).promotions.length).toBe(2)
        await row(page, gamma).click()
        await expect(tab(page, gamma)).toHaveClass(/preview/)
        await release(app, 'alpha', true)
        await expect.poll(() => failures(page)).toEqual([{ requestId: (await gate(app)).promotions[0], pathname: alpha }])
        await release(app, 'beta')
        await expect(tab(page, beta)).not.toHaveClass(/preview/)
        await expect(tab(page, gamma)).toHaveClass(/preview/)
        await row(page, alpha).click()
        await expect.poll(async() => (await gate(app)).held).toEqual(['alpha'])
        await release(app, 'alpha', true)
        await expect.poll(async() => (await failures(page)).length).toBe(2)
        await row(page, alpha).click()
        await expect.poll(async() => (await gate(app)).held).toEqual(['alpha'])
        await release(app, 'alpha')
        await expect(tab(page, alpha)).toHaveClass(/preview/)
        await expect(tab(page, gamma)).toHaveCount(0)
        await row(page, alpha).dblclick()
        await expect(tab(page, alpha)).not.toHaveClass(/preview/)
        await row(page, beta).click()
        await expect(tab(page, beta)).toHaveClass(/active/)
      }
      await expect(page.locator('.tabs-container > li')).toHaveCount(2)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
      await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
      expect(snapshot()).toEqual(before)
    } finally {
      await app.evaluate(() => (globalThis as unknown as { sidebarReadGate?: ReadGate }).sidebarReadGate?.restore())
      await app.close()
      expect(snapshot()).toEqual(before)
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
