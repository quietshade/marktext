import { expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchElectron, waitForEditor, waitForMenuReady } from './helpers'

test('File Open follows successful files, ignores cancellation and leaves files unchanged', async() => {
  const directory = mkdtempSync(join(tmpdir(), 'mt-open-directory-'))
  const firstDirectory = join(directory, 'first')
  const secondDirectory = join(directory, 'second')
  mkdirSync(firstDirectory)
  mkdirSync(secondDirectory)
  const first = join(firstDirectory, 'first.md')
  const second = join(secondDirectory, 'second.md')
  writeFileSync(first, '\ufeff# First  \r\n')
  writeFileSync(second, '# Second\n')
  const snapshot = () => [first, second].map(pathname => ({
    bytes: readFileSync(pathname).toString('hex'), mtime: statSync(pathname).mtimeMs
  }))
  const before = snapshot()
  const { app, page } = await launchElectron([], {
    preferences: { language: 'en', startUpAction: 'blank', defaultOpenMode: 'read', tabBarVisibility: true }
  })
  try {
    await waitForEditor(page)
    await waitForMenuReady(app)
    await app.evaluate(({ dialog }, files) => {
      const results = [
        { canceled: false, filePaths: [files.first] },
        { canceled: true, filePaths: [files.second] },
        { canceled: false, filePaths: [files.second] },
        { canceled: true, filePaths: [] },
        { canceled: false, filePaths: [files.first] },
        { canceled: true, filePaths: [] }
      ]
      const paths: Array<string | undefined> = []
      Object.assign(globalThis, { fileOpenPaths: paths })
      dialog.showOpenDialog = async(winOrOptions: Electron.BaseWindow | Electron.OpenDialogOptions, options?: Electron.OpenDialogOptions) => {
        paths.push((options ?? winOrOptions as Electron.OpenDialogOptions).defaultPath)
        const result = results.shift()
        if (!result) throw new Error('Unexpected file chooser')
        return result
      }
    }, { first, second })
    const calls = () => app.evaluate(() =>
      (globalThis as unknown as { fileOpenPaths: Array<string | undefined> }).fileOpenPaths
    )
    const open = (menu = false) => app.evaluate(({ ipcMain, BrowserWindow, Menu }, menu) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (menu) {
        const item = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? [])
          .find(item => item.label === 'Open File...')
        if (!item) throw new Error('File Open menu is missing')
        if (item.accelerator !== 'Ctrl+O') throw new Error('File Open shortcut changed')
        item.click(undefined, win, win.webContents)
        return
      }
      ipcMain.emit('mt::cmd-open-file', { sender: win.webContents })
    }, menu)
    await open(true)
    await expect(page.locator('.tabs-container li[title$="first.md"]')).toBeVisible()
    await open()
    await expect.poll(async() => (await calls()).length).toBe(2)
    expect((await calls())[1]).toBe(firstDirectory)
    await expect(page.locator('.tabs-container li[title$="second.md"]')).toHaveCount(0)
    await open()
    await expect(page.locator('.tabs-container li[title$="second.md"]')).toBeVisible()
    await open()
    await expect.poll(async() => (await calls()).length).toBe(4)
    expect((await calls())[3]).toBe(secondDirectory)
    await open(true)
    await expect(page.locator('.tabs-container li[title$="first.md"]')).toHaveClass(/active/)
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    await open()
    await expect.poll(async() => (await calls()).length).toBe(6)
    expect((await calls())[5]).toBe(firstDirectory)
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    expect(snapshot()).toEqual(before)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const withRecentFile of [false, true]) {
  test(`File Open preference fallback and persisted recents (recent file ${withRecentFile})`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-open-precedence-'))
    const configured = join(directory, 'configured')
    mkdirSync(configured)
    const file = join(directory, 'recent.md')
    writeFileSync(file, '# Recent\n')
    const { app, page } = await launchElectron([], {
      preferences: { language: 'en', startUpAction: 'folder', defaultDirectoryToOpen: configured, sideBarVisibility: true },
      userDataFiles: {
        'recently-used-documents.json': JSON.stringify(withRecentFile ? [file] : [])
      }
    })
    try {
      await waitForMenuReady(app)
      await expect(page.locator('.project-root')).toContainText('configured')
      await app.evaluate(({ dialog, ipcMain, BrowserWindow }) => {
        Object.assign(globalThis, { directoryChosen: null })
        dialog.showOpenDialog = async(winOrOptions: Electron.BaseWindow | Electron.OpenDialogOptions, options?: Electron.OpenDialogOptions) => {
          Object.assign(globalThis, { directoryChosen: (options ?? winOrOptions as Electron.OpenDialogOptions).defaultPath })
          return { canceled: true, filePaths: [] }
        }
        ipcMain.emit('mt::cmd-open-file', { sender: BrowserWindow.getAllWindows()[0].webContents })
      })
      await expect.poll(() => app.evaluate(() =>
        (globalThis as unknown as { directoryChosen: string | null }).directoryChosen
      )).toBe(withRecentFile ? directory : configured)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
