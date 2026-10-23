import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { clickMenuById, createElectronEnvironment, getElectronPath, launchElectron, sendIpcToRenderer, waitForMenuReady } from './helpers'

const desktopRoot = resolve(__dirname, '../..')

const restart = async(userData: string): Promise<ElectronApplication> => _electron.launch({
  executablePath: getElectronPath(),
  args: [desktopRoot, '--user-data-dir', userData],
  cwd: desktopRoot,
  env: createElectronEnvironment(process.env)
})

const openFolder = async(app: ElectronApplication, page: Page, pathname: string): Promise<void> => {
  const win = await app.browserWindow(page)
  const id = await win.evaluate(win => win.id)
  await app.evaluate(({ BrowserWindow, dialog, Menu }, { pathname, id }) => {
    dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [pathname] })
    const item = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? [])
      .find(item => item.label === 'Open Folder...')
    if (!item) throw new Error('File > Open Folder is missing')
    const win = BrowserWindow.fromId(id)
    if (!win) throw new Error('The folder target window has closed')
    item.click(undefined, win, win.webContents)
  }, { pathname, id })
}

interface Session {
  tabs: Array<{ pathname: string; markdown: string; readOnly: boolean; isSaved: boolean }>
  project?: { roots?: Array<{ pathname: string; collapsedPaths: string[] }> }
  layout?: { showSideBar: boolean; sideBarWidth: number }
}

const readSessions = (userData: string): Session[] => {
  const directory = join(userData, 'editorStates')
  return readdirSync(directory).filter(name => name.endsWith('_editor_buffer_store.json'))
    .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')))
}

const fileSnapshot = (pathname: string) => ({
  hash: createHash('sha256').update(readFileSync(pathname)).digest('hex'),
  size: statSync(pathname).size,
  mtimeMs: statSync(pathname).mtimeMs
})

for (const { openFolderInNewWindow, anotherWindow } of [
  { openFolderInNewWindow: false, anotherWindow: false },
  { openFolderInNewWindow: true, anotherWindow: false },
  { openFolderInNewWindow: false, anotherWindow: true }
]) {
  test(`File > Open Folder survives normal quit (new-window ${openFolderInNewWindow}, another window ${anotherWindow})`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-folder-restore-'))
    const root = join(directory, 'project')
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(join(root, 'nested', 'note.md'), '# Untouched\n')
    let app: ElectronApplication | undefined
    try {
      const launched = await launchElectron([], {
        preferences: { language: 'en', startUpAction: 'restoreAll', restoreLayoutState: true, openFolderInNewWindow }
      })
      app = launched.app
      await waitForMenuReady(app)
      if (anotherWindow) {
        const opened = app.waitForEvent('window')
        await app.evaluate(({ ipcMain }) => { ipcMain.emit('mt::cmd-new-editor-window') })
        await opened
      }
      const newPage = openFolderInNewWindow ? app.waitForEvent('window') : Promise.resolve(launched.page)
      await openFolder(app, launched.page, root)
      const page = await newPage
      const folderWindow = await app.browserWindow(page)
      const folderSession = await folderWindow.evaluate(win => (win as Electron.BrowserWindow & { restoreBufferId: string }).restoreBufferId)
      await expect(page.locator('.project-root')).toContainText('project')
      await expect(page.locator('.root-status')).toHaveCount(0)
      const userData = await app.evaluate(({ app }) => app.getPath('userData'))
      const hasRoot = () => readSessions(userData).some(state => state.project?.roots?.some(entry => entry.pathname === root))
      await expect.poll(hasRoot).toBe(true)
      if (openFolderInNewWindow || anotherWindow) {
        const closed = page.waitForEvent('close')
        const window = await app.browserWindow(page)
        await window.evaluate(win => win.close())
        await closed
        expect(hasRoot(), 'closing the folder window must retain its folder snapshot').toBe(true)
      }
      await app.close()
      expect(hasRoot(), 'normal shutdown must retain the folder snapshot').toBe(true)
      const restoredApp = await restart(userData)
      app = restoredApp
      await expect.poll(() => restoredApp.windows().length).toBeGreaterThanOrEqual(1)
      const pages = app.windows()
      await expect.poll(async() => {
        const roots = await Promise.all(pages.map(page => page.locator('.project-root').count()))
        return roots.reduce((total, count) => total + count, 0)
      }).toBe(1)
      const rootCounts = await Promise.all(pages.map(page => page.locator('.project-root').count()))
      const restoredPage = pages[rootCounts.findIndex(count => count === 1)]
      await expect(restoredPage.locator('.project-root')).toContainText('project')
      const restoredWindow = await app.browserWindow(restoredPage)
      expect(await restoredWindow.evaluate(win => (win as Electron.BrowserWindow & { restoreBufferId: string }).restoreBufferId)).toBe(folderSession)
      await app.close()
      app = undefined
      expect(readFileSync(join(root, 'nested', 'note.md'), 'utf8')).toBe('# Untouched\n')
    } finally {
      await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('multiple roots, tree state, hidden sidebar and dirty/locked tabs survive a normal restart', async() => {
  const directory = mkdtempSync(join(tmpdir(), 'mt-folder-state-'))
  const firstRoot = join(directory, 'work')
  const secondRoot = join(directory, 'notes')
  const expanded = join(firstRoot, 'expanded')
  const deep = join(expanded, 'deep')
  const collapsed = join(firstRoot, 'collapsed')
  mkdirSync(deep, { recursive: true })
  mkdirSync(collapsed)
  mkdirSync(secondRoot)
  const readFile = join(firstRoot, 'read.md')
  const editFile = join(secondRoot, 'edit.md')
  const leaf = join(deep, 'leaf.md')
  writeFileSync(readFile, '# Reading\r\n')
  writeFileSync(editFile, '# Editable\n')
  writeFileSync(leaf, '# Nested\n')
  const files = [readFile, editFile, leaf]
  const before = files.map(fileSnapshot)
  let app: ElectronApplication | undefined
  try {
    const launched = await launchElectron([firstRoot], {
      preferences: {
        language: 'en', startUpAction: 'restoreAll', restoreLayoutState: true,
        sourceCodeModeEnabled: true, defaultOpenMode: 'read', autoSave: false,
        autoRevealInSidebar: false
      }
    })
    app = launched.app
    let page = launched.page
    await expect(page.locator('.root-status')).toHaveCount(0)
    await app.evaluate(({ dialog }, pathname) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [pathname] })
    }, secondRoot)
    await page.locator('.add-folder-button').click()
    await expect(page.locator('.project-root')).toHaveCount(2)
    await expect(page.locator('.root-status')).toHaveCount(0)
    const folder = (pathname: string) => page.locator('.folder-name').and(page.getByTitle(pathname, { exact: true }))
    await folder(expanded).click()
    await folder(deep).click()
    await expect(page.getByTitle(leaf, { exact: true })).toBeVisible()
    await expect(folder(collapsed).locator('.icon-arrow')).toHaveClass(/fold/)
    await page.locator('.project-root').nth(1).click()
    await expect(page.locator('.project-root').nth(1)).toHaveAttribute('aria-expanded', 'false')

    const handle = await page.locator('.side-bar .drag-bar').boundingBox()
    if (!handle) throw new Error('Missing sidebar resize handle')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 80)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + 80, { steps: 8 })
    await page.mouse.up()
    const width = await page.locator('.side-bar').evaluate(el => Math.round(el.getBoundingClientRect().width))
    expect(width).toBeGreaterThanOrEqual(300)
    await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, {}), readFile)
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await expect(page.locator('.CodeMirror')).toContainText('Reading')
    await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, {}), editFile)
    await expect(page.locator('.CodeMirror')).toContainText('Editable')
    await page.locator('.document-mode-toggle').click()
    await expect(page.locator('.document-mode')).toContainText('Edit Mode')
    await page.locator('.CodeMirror').evaluate((host: HTMLElement & { CodeMirror: CodeMirror.Editor }) => {
      host.CodeMirror.replaceRange(' retained edit', { line: 0, ch: 10 })
    })
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'recover untitled\n')
    await expect(page.locator('.CodeMirror')).toContainText('recover untitled')
    await page.locator('.CodeMirror').evaluate((host: HTMLElement & { CodeMirror: CodeMirror.Editor }) => {
      host.CodeMirror.replaceRange(' pending', { line: 0, ch: 16 })
    })
    await clickMenuById(app, 'sideBarMenuItem')
    await expect(page.locator('.side-bar')).toBeHidden()
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await app.close()
    const sessions = readSessions(userData)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].project?.roots).toEqual([
      { pathname: firstRoot, collapsedPaths: ['collapsed'] },
      { pathname: secondRoot, collapsedPaths: [''] }
    ])
    expect(sessions[0].layout).toMatchObject({ showSideBar: false, sideBarWidth: width })
    expect(sessions[0].tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: readFile, readOnly: true, isSaved: true }),
      expect.objectContaining({ pathname: editFile, readOnly: false, isSaved: false, markdown: '# Editable retained edit\n' }),
      expect.objectContaining({ readOnly: false, isSaved: false, markdown: 'recover untitled pending\n' })
    ]))
    expect(files.map(fileSnapshot)).toEqual(before)
    app = await restart(userData)
    page = await app.firstWindow()
    await expect(page.locator('.CodeMirror')).toContainText('recover untitled pending')
    await expect(page.locator('.side-bar')).toBeHidden()
    await clickMenuById(app, 'sideBarMenuItem')
    await expect(page.locator('.project-root')).toHaveCount(2)
    await expect(page.locator('.root-status')).toHaveCount(0)
    expect(await page.locator('.side-bar').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width)
    await expect(page.getByTitle(leaf, { exact: true })).toBeVisible()
    await expect(folder(collapsed).locator('.icon-arrow')).toHaveClass(/fold/)
    await expect(page.locator('.project-root').nth(1)).toHaveAttribute('aria-expanded', 'false')
    await page.locator('.tabs-container li').and(page.getByTitle(readFile, { exact: true })).click()
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await expect(page.locator('.CodeMirror')).toContainText('Reading')
    await page.locator('.tabs-container li').and(page.getByTitle(editFile, { exact: true })).click()
    await expect(page.locator('.document-mode')).toContainText('Edit Mode')
    await expect(page.locator('.CodeMirror')).toContainText('retained edit')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(2)
    expect(files.map(fileSnapshot)).toEqual(before)
    await app.close()
    app = undefined
    expect(files.map(fileSnapshot)).toEqual(before)
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const startUpAction of ['blank', 'openLastFolder', 'folder']) {
  test(`the ${startUpAction} startup option keeps its existing folder selection behavior`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-folder-startup-'))
    const previous = join(directory, 'previous')
    const configured = join(directory, 'configured')
    mkdirSync(previous)
    mkdirSync(configured)
    let app: ElectronApplication | undefined
    try {
      const launched = await launchElectron([previous], {
        preferences: { language: 'en', startUpAction: 'restoreAll' }
      })
      app = launched.app
      await expect(launched.page.locator('.project-root')).toContainText('previous')
      const userData = await app.evaluate(({ app }) => app.getPath('userData'))
      await app.close()
      const pathname = join(userData, 'preferences.json')
      const preferences = JSON.parse(readFileSync(pathname, 'utf8'))
      writeFileSync(pathname, JSON.stringify({
        ...preferences, startUpAction, lastOpenedFolder: configured, defaultDirectoryToOpen: configured
      }))
      app = await restart(userData)
      const page = await app.firstWindow()
      await expect(page.locator('.tree-view')).toBeAttached()
      if (startUpAction === 'blank') await expect(page.locator('.project-root')).toHaveCount(0)
      else {
        await expect(page.locator('.project-root')).toHaveCount(1)
        await expect(page.locator('.project-root')).toContainText('configured')
      }
      await app.close()
      app = undefined
    } finally {
      await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('the pnpm start preview restores a same-window folder after the window X button', async() => {
  test.setTimeout(90000)
  const directory = mkdtempSync(join(tmpdir(), 'mt-pnpm-folder-'))
  const profile = join(directory, 'profile')
  const root = join(directory, 'project')
  mkdirSync(profile)
  mkdirSync(root)
  writeFileSync(join(root, 'note.md'), '# Preview fixture\n')
  writeFileSync(join(profile, 'preferences.json'), JSON.stringify({
    language: 'en', startUpAction: 'restoreAll', restoreLayoutState: true,
    openFolderInNewWindow: false, defaultOpenMode: 'read', sourceCodeModeEnabled: false
  }))
  const before = fileSnapshot(join(root, 'note.md'))
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const portFile = join(profile, 'DevToolsActivePort')
      if (existsSync(portFile)) unlinkSync(portFile)
      // The debug port only attaches Playwright; the normal preview script still builds and launches.
      const command = process.platform === 'win32'
        ? 'pnpm run start -- --user-data-dir "%MARKTEXT_TEST_PROFILE%" --remote-debugging-port=0'
        : 'pnpm run start -- --user-data-dir "$MARKTEXT_TEST_PROFILE" --remote-debugging-port=0'
      const child = spawn(command, {
        cwd: resolve(desktopRoot, '../..'), windowsHide: true, shell: true,
        env: createElectronEnvironment(process.env, {
          MARKTEXT_TEST_PROFILE: profile
        }),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      child.stdout.on('data', data => { output = (output + data).slice(-12000) })
      child.stderr.on('data', data => { output = (output + data).slice(-12000) })
      const exited = once(child, 'exit')
      try {
        await expect.poll(() => {
          if (child.exitCode !== null) throw new Error(`Preview exited ${child.exitCode}: ${output}`)
          return existsSync(portFile)
        }, { timeout: 45000 }).toBe(true)
        const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        const page = browser.contexts()[0].pages()[0]
        await page.waitForSelector('.tree-view', { state: 'attached' })
        if (cycle === 0) {
          await page.evaluate(pathname => {
            const windowId = window.marktext?.env?.windowId
            if (windowId === undefined) throw new Error('The editor window has not bootstrapped')
            window.electron.ipcRenderer.send('mt::open-directory-by-window-id', windowId, pathname)
          }, root)
        }
        await expect(page.locator('.project-root')).toContainText('project')
        const note = page.locator('.side-bar-file').and(page.getByTitle(join(root, 'note.md'), { exact: true }))
        await expect(note).toBeVisible()
        if (cycle === 0) await note.click()
        await expect(page.locator('.document-mode')).toContainText('Reading Mode')
        await expect(page.locator('.mu-read-only')).toContainText('Preview fixture')
        await page.locator('.frameless-titlebar-close').click()
        const [code] = await exited
        expect(code, output).toBe(0)
        await browser.close()
        expect(readSessions(profile).some(state => state.project?.roots?.some(entry => entry.pathname === root))).toBe(true)
      } catch (error) {
        console.error(output)
        throw error
      } finally {
        if (child.exitCode === null && child.pid) {
          if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
          else child.kill()
        }
      }
    }
    expect(fileSnapshot(join(root, 'note.md'))).toEqual(before)
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
