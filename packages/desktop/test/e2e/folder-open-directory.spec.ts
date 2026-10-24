import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import type CodeMirror from 'codemirror'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { clickMenuById, createElectronEnvironment, getElectronPath, launchElectron, waitForMenuReady } from './helpers'

interface DialogCapture {
  folder: boolean
  defaultPath?: string
}
interface DialogState {
  folderDialogCalls: DialogCapture[]
  nextFolderDialogResult: { canceled: boolean; filePaths: string[] } | null
}

const installChooser = (app: ElectronApplication) => app.evaluate(({ dialog }) => {
  Object.assign(globalThis, { folderDialogCalls: [], nextFolderDialogResult: null })
  dialog.showOpenDialog = async(winOrOptions: Electron.BaseWindow | Electron.OpenDialogOptions, options?: Electron.OpenDialogOptions) => {
    const settings = options ?? winOrOptions as Electron.OpenDialogOptions
    const state = globalThis as unknown as DialogState
    state.folderDialogCalls.push({ folder: !!settings.properties?.includes('openDirectory'), defaultPath: settings.defaultPath })
    const result = state.nextFolderDialogResult
    state.nextFolderDialogResult = null
    if (!result) throw new Error('Unexpected chooser')
    return result
  }
})

const choose = async(app: ElectronApplication, folder: boolean, filePaths: string[], canceled = false) => {
  const count = await app.evaluate(({ BrowserWindow, Menu }, { folder, filePaths, canceled }) => {
    const state = globalThis as unknown as DialogState
    state.nextFolderDialogResult = { filePaths, canceled }
    const win = BrowserWindow.getAllWindows()[0]
    const item = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? [])
      .find(item => item.label === (folder ? 'Open Folder...' : 'Open File...'))
    if (!item) throw new Error('Open menu is missing')
    const count = state.folderDialogCalls.length
    item.click(undefined, win, win.webContents)
    return count
  }, { folder, filePaths, canceled })
  const calls = () => app.evaluate(() => (globalThis as unknown as DialogState).folderDialogCalls)
  await expect.poll(async() => (await calls()).length).toBe(count + 1)
  const call = (await calls())[count]
  expect(call.folder).toBe(folder)
  return call.defaultPath
}

const rememberedFolder = (userData: string): string =>
  JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')).lastOpenedFolder
const tab = (page: Page, pathname: string) => page.locator('.tabs-container li').and(page.getByTitle(pathname, { exact: true }))
type SourceHost = HTMLElement & { CodeMirror: CodeMirror.Editor }
const sourceText = (page: Page) => page.locator('.CodeMirror').evaluate((el: SourceHost) => el.CodeMirror.getValue())

const closeNormally = async(app: ElectronApplication) => {
  const closed = app.waitForEvent('close')
  const win = await app.browserWindow(await app.firstWindow())
  await win.evaluate(win => win.close())
  await closed
}

test('Open Folder starts in the last successfully opened folder', async() => {
  const directory = mkdtempSync(join(tmpdir(), 'mt-folder-dialog-'))
  const folder = join(directory, 'project')
  mkdirSync(folder)
  writeFileSync(join(folder, 'note.md'), '# Note\n')
  const { app, page } = await launchElectron([], {
    preferences: { language: 'en', startUpAction: 'restoreAll', openFolderInNewWindow: false, sideBarVisibility: true }
  })
  try {
    await waitForMenuReady(app)
    await app.evaluate(({ dialog }, folder) => {
      const results = [
        { canceled: false, filePaths: [folder] },
        { canceled: true, filePaths: [] }
      ]
      const paths: Array<string | undefined> = []
      Object.assign(globalThis, { folderDialogPaths: paths })
      dialog.showOpenDialog = async(winOrOptions: Electron.BaseWindow | Electron.OpenDialogOptions, options?: Electron.OpenDialogOptions) => {
        paths.push((options ?? winOrOptions as Electron.OpenDialogOptions).defaultPath)
        const result = results.shift()
        if (!result) throw new Error('Unexpected folder chooser')
        return result
      }
    }, folder)
    const open = () => app.evaluate(({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const item = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? [])
        .find(item => item.label === 'Open Folder...')
      if (!item) throw new Error('Open Folder menu is missing')
      item.click(undefined, win, win.webContents)
    })
    await open()
    await expect(page.locator('.project-root')).toContainText('project')
    await open()
    const calls = () => app.evaluate(() =>
      (globalThis as unknown as { folderDialogPaths: Array<string | undefined> }).folderDialogPaths
    )
    await expect.poll(async() => (await calls()).length).toBe(2)
    expect((await calls())[1]).toBe(folder)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('folder history persists across restart independently of files, cancellation and dirty tab state', async() => {
  test.setTimeout(60000)
  const directory = mkdtempSync(join(tmpdir(), 'mt-folder-history-'))
  const first = join(directory, 'first')
  const second = join(directory, 'second')
  const canceledFolder = join(directory, 'canceled')
  const fileDirectory = join(directory, 'documents')
  for (const folder of [first, second, canceledFolder, fileDirectory]) mkdirSync(folder)
  const readFile = join(first, 'read.md')
  const editFile = join(fileDirectory, 'edit.md')
  writeFileSync(readFile, '\ufeff**Bold**  \r\n')
  writeFileSync(editFile, '# Editable\n')
  const snapshot = () => [readFile, editFile].map(pathname => ({
    bytes: readFileSync(pathname).toString('hex'), mtime: statSync(pathname).mtimeMs
  }))
  const before = snapshot()
  let app: ElectronApplication | undefined
  try {
    const launched = await launchElectron([], {
      preferences: {
        language: 'en', startUpAction: 'restoreAll', restoreLayoutState: true,
        openFolderInNewWindow: false, openFilesInNewWindow: false, defaultOpenMode: 'read',
        autoSave: false, sideBarVisibility: true, tabBarVisibility: true
      }
    })
    app = launched.app
    let page = launched.page
    await waitForMenuReady(app)
    await installChooser(app)
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    expect(await choose(app, true, [first])).toBeUndefined()
    await expect(page.locator('.project-root')).toContainText('first')
    await expect.poll(() => rememberedFolder(userData)).toBe(first)
    expect(await choose(app, false, [readFile])).toBeUndefined()
    await expect(tab(page, readFile)).toHaveClass(/active/)
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.document-layout-label')).toHaveText('Preview Only')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    expect(await choose(app, false, [editFile])).toBe(first)
    await expect(tab(page, editFile)).toHaveClass(/active/)
    await clickMenuById(app, 'readOnlyModeMenuItem')
    await clickMenuById(app, 'documentLayout-source')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
    await expect.poll(() => sourceText(page)).toBe('# Editable\n')
    await page.locator('.CodeMirror').evaluate((el: SourceHost) => {
      el.CodeMirror.replaceRange(' retained', { line: 0, ch: 10 }, undefined, '+input')
      el.CodeMirror.undo()
      el.CodeMirror.redo()
    })
    await expect.poll(() => sourceText(page)).toBe('# Editable retained\n')
    await expect(tab(page, editFile)).toHaveClass(/unsaved/)

    expect(await choose(app, true, [second])).toBe(first)
    await expect(page.locator('.project-root')).toContainText('second')
    expect(await choose(app, true, [second])).toBe(second)
    await expect(page.locator('.project-root')).toHaveCount(1)
    expect(await choose(app, true, [canceledFolder], true)).toBe(second)
    expect(await choose(app, true, [], true)).toBe(second)
    await expect(page.locator('.project-root')).toContainText('second')
    expect(rememberedFolder(userData)).toBe(second)
    expect(await choose(app, false, [readFile], true)).toBe(fileDirectory)
    expect(await choose(app, false, [], true)).toBe(fileDirectory)
    expect(await choose(app, true, [], true)).toBe(second)
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    await expect(tab(page, editFile)).toHaveClass(/unsaved/)
    expect(snapshot()).toEqual(before)
    const recentHistory = readFileSync(join(userData, 'recently-used-documents.json'), 'utf8')

    await closeNormally(app)
    expect(rememberedFolder(userData)).toBe(second)
    app = await _electron.launch({
      executablePath: getElectronPath(), args: [resolve(__dirname, '../..'), '--user-data-dir', userData],
      cwd: resolve(__dirname, '../..'), env: createElectronEnvironment(process.env)
    })
    page = await app.firstWindow()
    await waitForMenuReady(app)
    await expect(page.locator('.project-root')).toHaveCount(1)
    await expect(page.locator('.project-root')).toContainText('second')
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    expect(readFileSync(join(userData, 'recently-used-documents.json'), 'utf8')).toBe(recentHistory)
    await installChooser(app)
    expect(await choose(app, true, [], true)).toBe(second)
    expect(await choose(app, false, [], true)).toBe(fileDirectory)
    await tab(page, editFile).click()
    await expect(page.locator('.document-layout-label')).toHaveText('Markdown Source')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
    await expect.poll(() => sourceText(page)).toBe('# Editable retained\n')
    await expect(tab(page, editFile)).toHaveClass(/unsaved/)
    await tab(page, readFile).click()
    await expect(page.locator('.document-layout-label')).toHaveText('Preview Only')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    expect(snapshot()).toEqual(before)
    await closeNormally(app)
    app = undefined
  } finally {
    await app?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const fallback of ['active', 'inactive', 'missing'] as const) {
  test(`deleted folder uses only a valid active startup fallback (${fallback})`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-folder-fallback-'))
    const folder = join(directory, 'removed')
    const configured = join(directory, 'configured')
    mkdirSync(folder)
    if (fallback !== 'missing') mkdirSync(configured)
    const { app, page } = await launchElectron([], {
      preferences: { language: 'en', startUpAction: 'blank', openFolderInNewWindow: false, sideBarVisibility: true }
    })
    try {
      await waitForMenuReady(app)
      await installChooser(app)
      await choose(app, true, [folder])
      await expect(page.locator('.project-root')).toContainText('removed')
      const userData = await app.evaluate(({ app }) => app.getPath('userData'))
      await expect.poll(() => rememberedFolder(userData)).toBe(folder)
      rmSync(folder, { recursive: true })
      await app.evaluate(({ ipcMain }, { configured, fallback }) => {
        ipcMain.emit('set-user-preference', {
          startUpAction: fallback === 'inactive' ? 'restoreAll' : 'folder', defaultDirectoryToOpen: configured
        })
      }, { configured, fallback })
      expect(await choose(app, true, [], true)).toBe(fallback === 'active' ? configured : undefined)
      expect(rememberedFolder(userData)).toBe(folder)
      await expect(page.locator('.project-root')).toHaveCount(1)
      await expect(page.locator('.project-root')).toContainText('removed')
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
