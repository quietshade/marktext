import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import type CodeMirror from 'codemirror'
import * as fs from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { clickMenuById, createElectronEnvironment, getElectronPath, launchElectron, openProjectFolder, typeIntoEditor, waitForMenuReady } from './helpers'

const tabFor = (page: Page, filename: string) =>
  page.locator(`.tabs-container > li[title$="${filename}"]`)

const tabCount = (page: Page): Promise<number> => page.locator('.tabs-container > li').count()

test.describe('Issue #2395 sidebar preview tabs', () => {
  let app: ElectronApplication
  let page: Page
  let projectDir: string

  const launchProject = async(preferences: Record<string, unknown> = {}): Promise<void> => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-preview-'))
    for (const name of ['alpha', 'beta', 'gamma']) {
      fs.writeFileSync(path.join(projectDir, `${name}.md`), `# ${name}\n`, 'utf-8')
    }

    const launched = await launchElectron([], {
      preferences: {
        sideBarVisibility: true,
        tabBarVisibility: true,
        openFilesInPreviewMode: true,
        autoRevealInSidebar: true,
        ...preferences
      }
    })
    app = launched.app
    page = launched.page
    await openProjectFolder(app, page, projectDir, path.join(projectDir, 'alpha.md'))
  }

  test.afterEach(async() => {
    if (app) await app.close()
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true })
  })

  test('single clicks reuse one preview tab', async() => {
    await launchProject()

    await page.locator('.side-bar-file[title$="alpha.md"]').click()
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)
    await expect.poll(() => tabCount(page)).toBe(1)

    await page.locator('.side-bar-file[title$="beta.md"]').click()
    await expect(tabFor(page, 'beta.md')).toHaveClass(/preview/)
    await expect(tabFor(page, 'alpha.md')).toHaveCount(0)
    await expect.poll(() => tabCount(page)).toBe(1)

    await page.locator('.side-bar-file[title$="gamma.md"]').click()
    await expect(tabFor(page, 'gamma.md')).toHaveClass(/preview/)
    await expect.poll(() => tabCount(page)).toBe(1)
  })

  test('editing pins the preview and the next file gets a new preview', async() => {
    await launchProject()
    await page.locator('.side-bar-file[title$="alpha.md"]').click()
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)

    await typeIntoEditor(page, ' edited')

    await expect(tabFor(page, 'alpha.md')).not.toHaveClass(/preview/)
    await page.locator('.side-bar-file[title$="beta.md"]').click()

    await expect(tabFor(page, 'alpha.md')).toHaveCount(1)
    await expect(tabFor(page, 'beta.md')).toHaveClass(/preview/)
    await expect.poll(() => tabCount(page)).toBe(2)
  })

  test('double-clicking a preview pins it without creating another tab', async() => {
    await launchProject()
    const row = page.locator('.side-bar-file[title$="alpha.md"]')
    await row.click()
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)
    await row.dblclick()

    await expect(tabFor(page, 'alpha.md')).toHaveCount(1)
    await expect(tabFor(page, 'alpha.md')).not.toHaveClass(/preview/)
  })

  test('double-clicking three distinct files keeps three permanent tabs', async() => {
    await launchProject()
    for (const name of ['alpha', 'beta', 'gamma']) {
      await page.locator(`.side-bar-file[title$="${name}.md"]`).dblclick()
    }
    for (const name of ['alpha', 'beta', 'gamma']) {
      await expect(tabFor(page, `${name}.md`)).not.toHaveClass(/preview/)
    }
    await expect(page.locator('.tabs-container > li')).toHaveCount(3)
    await page.locator('.side-bar-file[title$="alpha.md"]').dblclick()
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/active/)
    await expect(page.locator('.tabs-container > li')).toHaveCount(3)
  })

  for (const boundary of ['load', 'delivery']) {
    test(`a promoted pending open survives the next sidebar selection (${boundary})`, async() => {
      await launchProject()
      // Holding a boundary makes both sides of the promotion race deterministic.
      await app.evaluate(({ BrowserWindow }, boundary) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        const send = contents.send.bind(contents)
        const held: Array<() => void> = []
        const io = process.getBuiltinModule('fs/promises') as typeof FsPromises
        const read = io.readFile
        Object.assign(globalThis, {
          sidebarHeldCount: () => held.length,
          releaseSidebarOpen: () => {
            contents.send = send
            io.readFile = read
            for (const deliver of held) deliver()
          }
        })
        if (boundary === 'load') {
          io.readFile = (async(...args: Parameters<typeof read>) => {
            if (String(args[0]).endsWith('alpha.md')) await new Promise<void>(resolve => held.push(resolve))
            return read(...args)
          }) as typeof read
          return
        }
        contents.send = (channel, ...args) => {
          if (channel === 'mt::open-new-tab' && args[0]?.pathname?.endsWith('alpha.md')) {
            held.push(() => send(channel, ...args))
          } else send(channel, ...args)
        }
      }, boundary)
      await page.locator('.side-bar-file[title$="alpha.md"]').dblclick()
      await expect.poll(() => app.evaluate(() =>
        (globalThis as unknown as { sidebarHeldCount: () => number }).sidebarHeldCount()
      )).toBeGreaterThan(0)
      await page.locator('.side-bar-file[title$="beta.md"]').click()
      await expect(tabFor(page, 'beta.md')).toHaveClass(/preview/)
      await app.evaluate(() =>
        (globalThis as unknown as { releaseSidebarOpen: () => void }).releaseSidebarOpen()
      )
      await expect(tabFor(page, 'alpha.md')).toHaveCount(1)
      await expect(tabFor(page, 'alpha.md')).not.toHaveClass(/preview/)
      await expect(tabFor(page, 'beta.md')).toHaveClass(/preview/)
      await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    })
  }

  test('disabling preview mode restores one tab per file', async() => {
    await launchProject({ openFilesInPreviewMode: false })

    await page.locator('.side-bar-file[title$="alpha.md"]').click()
    await page.locator('.side-bar-file[title$="beta.md"]').click()

    await expect(tabFor(page, 'alpha.md')).not.toHaveClass(/preview/)
    await expect(tabFor(page, 'beta.md')).not.toHaveClass(/preview/)
    await expect.poll(() => tabCount(page)).toBe(2)
  })

  test('sidebar ownership remains independent of layouts, permissions and dirty session recovery', async() => {
    test.setTimeout(60000)
    await launchProject({ defaultOpenMode: 'read', startUpAction: 'restoreAll', restoreLayoutState: true, autoSave: false })
    const snapshots = () => ['alpha', 'beta', 'gamma'].map(name => {
      const file = path.join(projectDir, `${name}.md`)
      return { bytes: fs.readFileSync(file).toString('hex'), mtime: fs.statSync(file).mtimeMs }
    })
    const before = snapshots()
    await page.locator('.side-bar-file[title$="alpha.md"]').click()
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)
    await clickMenuById(app, 'documentLayout-preview')
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)
    await page.locator('.side-bar-file[title$="alpha.md"]').dblclick()
    await expect(tabFor(page, 'alpha.md')).not.toHaveClass(/preview/)
    await page.locator('.side-bar-file[title$="beta.md"]').click()
    await expect(tabFor(page, 'beta.md')).toHaveClass(/preview/)
    await clickMenuById(app, 'documentLayout-source')
    await expect(tabFor(page, 'beta.md')).toHaveClass(/preview/)
    await clickMenuById(app, 'readOnlyModeMenuItem')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
    await page.locator('.CodeMirror').evaluate((host: HTMLElement & { CodeMirror: CodeMirror.Editor }) => {
      host.CodeMirror.replaceRange(' unsaved', { line: 0, ch: 6 })
    })
    await expect(tabFor(page, 'beta.md')).toHaveClass(/unsaved/)
    await expect(tabFor(page, 'beta.md')).not.toHaveClass(/preview/)
    await page.locator('.side-bar-file[title$="gamma.md"]').dblclick()
    await expect(tabFor(page, 'gamma.md')).not.toHaveClass(/preview/)
    await expect(page.locator('.tabs-container > li')).toHaveCount(3)
    await page.locator('.side-bar-file[title$="alpha.md"]').click()
    await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'preview')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    await app.evaluate(({ ipcMain, BrowserWindow }, file) => {
      ipcMain.emit('mt::open-file', { sender: BrowserWindow.getAllWindows()[0].webContents }, file)
    }, path.join(projectDir, 'beta.md'))
    await expect(tabFor(page, 'beta.md')).toHaveClass(/active/)
    await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'source')
    await expect(page.locator('.tabs-container > li')).toHaveCount(3)
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await app.close()
    const desktop = path.resolve(__dirname, '../..')
    app = await _electron.launch({
      executablePath: getElectronPath(), args: [desktop, '--user-data-dir', userData],
      cwd: desktop, env: createElectronEnvironment(process.env)
    })
    page = await app.firstWindow()
    await waitForMenuReady(app)
    await expect(page.locator('.tabs-container > li')).toHaveCount(3)
    for (const [name, layout, permission] of [
      ['alpha', 'preview', 'Reading Mode'], ['beta', 'source', 'Edit Mode'], ['gamma', 'wysiwyg', 'Reading Mode']
    ]) {
      await tabFor(page, `${name}.md`).click()
      await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', layout)
      await expect(page.locator('.document-mode [role=status]')).toHaveText(permission)
      await expect(tabFor(page, `${name}.md`)).not.toHaveClass(/preview/)
      if (name === 'beta') {
        await expect(tabFor(page, 'beta.md')).toHaveClass(/unsaved/)
        expect(await page.locator('.CodeMirror').evaluate((host: HTMLElement & { CodeMirror: CodeMirror.Editor }) => host.CodeMirror.getValue())).toBe('# beta unsaved\n')
      }
    }
    expect(snapshots()).toEqual(before)
  })

  test('preview browsing does not reveal a hidden tab bar', async() => {
    await launchProject()
    await clickMenuById(app, 'tabBarMenuItem')
    await expect(page.locator('.editor-tabs')).toBeHidden()

    await page.locator('.side-bar-file[title$="alpha.md"]').click()
    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)
    await page.locator('.side-bar-file[title$="beta.md"]').click()

    await expect(page.locator('.editor-tabs')).toBeHidden()
    await expect.poll(() => tabCount(page)).toBe(1)
  })

  test('rapid A-B-A clicks leave the last A request as the only preview', async() => {
    await launchProject()

    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.side-bar-file'))
      const alpha = rows.find((row) => row.getAttribute('title')?.endsWith('alpha.md'))
      const beta = rows.find((row) => row.getAttribute('title')?.endsWith('beta.md'))
      ;(alpha as HTMLElement | undefined)?.click()
      ;(beta as HTMLElement | undefined)?.click()
      ;(alpha as HTMLElement | undefined)?.click()
    })

    await expect(tabFor(page, 'alpha.md')).toHaveClass(/preview/)
    await expect.poll(() => tabCount(page)).toBe(1)
    await expect(tabFor(page, 'beta.md')).toHaveCount(0)
  })
})
