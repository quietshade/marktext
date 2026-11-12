import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import type CodeMirror from 'codemirror'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  clickMenuById,
  createElectronEnvironment,
  getElectronPath,
  launchWithMarkdown,
  sendIpcToRenderer,
  waitForMenuReady
} from './helpers'

type Layout = 'wysiwyg' | 'source' | 'preview'
const layouts: Layout[] = ['wysiwyg', 'source', 'preview']
const labels = {
  wysiwyg: 'Visual Editor (WYSIWYG)',
  source: 'Markdown Source',
  preview: 'Preview Only'
}
type SourceHost = HTMLElement & { CodeMirror: CodeMirror.Editor }
const sourceText = (page: Page) =>
  page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.getValue())
const fileState = (pathname: string) => ({
  bytes: readFileSync(pathname).toString('hex'),
  mtime: statSync(pathname).mtimeMs
})
const tab = (page: Page, pathname: string) =>
  page.locator('.tabs-container li').and(page.getByTitle(pathname, { exact: true }))

const setLayout = async(app: ElectronApplication, page: Page, value: Layout) => {
  await clickMenuById(app, `documentLayout-${value}`)
  await expect(page.locator('.document-layout-label')).toHaveText(labels[value])
}

const copyRendered = async(app: ElectronApplication, page: Page, value: Layout) => {
  const element = page
    .locator(value === 'preview' ? '.mu-editor strong' : '.mu-paragraph-content')
    .first()
  await element.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await page.keyboard.press('ControlOrMeta+c')
  if (value === 'preview') {
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Bold text')
    expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toContain(
      '<strong>Bold text</strong>'
    )
  } else {
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('**Bold text** and *italic text*')
  }
}

const menuState = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    return {
      checked: ['wysiwyg', 'source', 'preview'].map(
        (value) => !!menu?.getMenuItemById(`documentLayout-${value}`)?.checked
      ),
      source: menu?.getMenuItemById('sourceCodeModeMenuItem')?.checked,
      reading: menu?.getMenuItemById('readOnlyModeMenuItem')?.checked
    }
  })

const consistent = async(
  app: ElectronApplication,
  page: Page,
  value: Layout,
  reading: boolean
) => {
  await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
  await expect(page.locator('.document-layout-label')).toHaveText(labels[value])
  await expect(page.locator('.document-mode [role=status]')).toHaveText(
    reading ? 'Reading Mode' : 'Edit Mode'
  )
  if (value === 'source') {
    await expect(page.locator('.CodeMirror')).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('.CodeMirror')
          .evaluate((host: SourceHost) => host.CodeMirror.getOption('readOnly'))
      )
      .toBe(reading)
  } else {
    await expect(page.locator('.mu-editor')).toHaveAttribute(
      'contenteditable',
      reading || value === 'preview' ? 'false' : 'true'
    )
  }
  await expect
    .poll(() => menuState(app))
    .toEqual({
      checked: layouts.map((layout) => layout === value),
      source: value === 'source',
      reading
    })
}

const closeNormally = async(app: ElectronApplication) => {
  const closed = app.waitForEvent('close')
  const window = await app.browserWindow(await app.firstWindow())
  await window.evaluate((window) => window.close())
  await closed
}

const restart = (userData: string) =>
  _electron.launch({
    executablePath: getElectronPath(),
    args: [resolve(__dirname, '../..'), '--user-data-dir', userData],
    cwd: resolve(__dirname, '../..'),
    env: createElectronEnvironment(process.env)
  })

const savedTabs = (
  userData: string
): Array<{
  pathname: string
  documentLayout: Layout
  readOnly: boolean
  markdown: string
  isSaved: boolean
}> => {
  const directory = join(userData, 'editorStates')
  return readdirSync(directory)
    .filter((file) => file.endsWith('_editor_buffer_store.json'))
    .flatMap((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')).tabs)
}

for (const value of layouts) {
  test(`${value} Reading layout agrees with its native menu after a normal close and cold restart`, async() => {
    const markdown = '**Bold text** and *italic text*  \r\n'
    const launched = await launchWithMarkdown('\uFEFF' + markdown, {
      preferences: {
        language: 'en',
        startUpAction: 'restoreAll',
        restoreLayoutState: true,
        defaultOpenMode: 'read'
      }
    })
    let { app, page } = launched
    const before = fileState(launched.filePath)
    try {
      await setLayout(app, page, value)
      await consistent(app, page, value, true)
      const userData = await app.evaluate(({ app }) => app.getPath('userData'))
      await closeNormally(app)
      expect(savedTabs(userData).find((tab) => tab.pathname === launched.filePath)).toMatchObject({
        documentLayout: value,
        readOnly: true
      })
      app = await restart(userData)
      page = await app.firstWindow()
      await waitForMenuReady(app)
      await consistent(app, page, value, true)
      if (value === 'source') {
        await expect(page.locator('.CodeMirror')).toBeVisible()
        expect(await sourceText(page)).toContain('**Bold text** and *italic text*')
      } else {
        await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
        await copyRendered(app, page, value)
      }
      await consistent(app, page, value, true)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
      expect(fileState(launched.filePath)).toEqual(before)
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    }
  })
}

for (const restoreLayoutState of [true, false]) {
  for (const sourceDefault of [true, false]) {
    test(`restored mixed tabs, dirty buffers and native menu respect restore=${restoreLayoutState}, source default=${sourceDefault}`, async() => {
      const markdown = '**Bold text** and *italic text*\n'
      const launched = await launchWithMarkdown(markdown, {
        preferences: {
          language: 'en',
          startUpAction: 'restoreAll',
          restoreLayoutState,
          sourceCodeModeEnabled: sourceDefault,
          defaultOpenMode: 'read',
          autoSave: false,
          autoSaveDelay: 1000
        }
      })
      let { app, page } = launched
      const files = [
        launched.filePath,
        join(dirname(launched.filePath), 'preview.md'),
        join(dirname(launched.filePath), 'source.md')
      ]
      writeFileSync(files[1], markdown)
      writeFileSync(files[2], 'source\n')
      const before = files.map(fileState)
      const fallback: Layout = sourceDefault ? 'source' : 'wysiwyg'
      const expected = (layout: Layout) => (restoreLayoutState ? layout : fallback)
      try {
        await setLayout(app, page, 'wysiwyg')
        for (const [pathname, value] of [
          [files[1], 'preview'],
          [files[2], 'source']
        ] as const) {
          await page.evaluate(
            (pathname) =>
              window.electron.ipcRenderer.send('mt::open-file', pathname, { readOnly: false }),
            pathname
          )
          await expect(tab(page, pathname)).toHaveClass(/active/)
          await setLayout(app, page, value)
          await consistent(app, page, value, false)
        }
        await expect.poll(() => sourceText(page)).toBe('source\n')
        await page
          .locator('.CodeMirror')
          .evaluate((host: SourceHost) =>
            host.CodeMirror.replaceRange(' retained', { line: 0, ch: 6 }, undefined, '+input')
          )
        await expect(tab(page, files[2])).toHaveClass(/unsaved/)
        await tab(page, files[1]).click()
        await consistent(app, page, 'preview', false)
        const userData = await app.evaluate(({ app }) => app.getPath('userData'))
        await closeNormally(app)
        expect(
          savedTabs(userData).map((item) => ({
            layout: item.documentLayout,
            reading: item.readOnly
          }))
        ).toEqual([
          { layout: 'wysiwyg', reading: true },
          { layout: 'preview', reading: false },
          { layout: 'source', reading: false }
        ])
        expect(savedTabs(userData).find((item) => item.pathname === files[2])).toMatchObject({
          markdown: 'source retained\n',
          isSaved: false
        })

        app = await restart(userData)
        page = await app.firstWindow()
        await waitForMenuReady(app)
        await expect(page.locator('.tabs-container li')).toHaveCount(3)
        await expect(tab(page, files[1])).toHaveClass(/active/)
        await consistent(app, page, expected('preview'), false)
        if (expected('preview') !== 'source') await copyRendered(app, page, expected('preview'))
        if (restoreLayoutState) {
          await sendIpcToRenderer(app, 'mt::show-command-palette')
          const search = page.locator('input.search').first()
          await search.fill('Bold')
          await search.dispatchEvent('keyup', { key: 'd' })
          const command = page.locator('.command-item').filter({ hasText: /^Bold/ })
          await expect(command).toHaveAttribute('aria-disabled', 'true')
          await expect(command).toContainText('Unavailable in Preview Only')
          await search.fill('Visual Editor')
          await search.dispatchEvent('keyup', { key: 'r' })
          const layoutCommand = page.locator('.command-item').filter({ hasText: labels.wysiwyg })
          await expect(layoutCommand).toHaveAttribute('aria-disabled', 'false')
          await layoutCommand.click()
          await consistent(app, page, 'wysiwyg', false)
          await setLayout(app, page, 'preview')
          await consistent(app, page, 'preview', false)
        }

        for (const index of [0, 2, 1, 0, 1]) {
          await tab(page, files[index]).click()
          const value: Layout = index === 0 ? 'wysiwyg' : index === 1 ? 'preview' : 'source'
          await consistent(app, page, expected(value), index === 0)
        }
        await tab(page, files[2]).click()
        await consistent(app, page, expected('source'), false)
        await expect(tab(page, files[2])).toHaveClass(/unsaved/)
        await setLayout(app, page, 'source')
        await expect.poll(() => sourceText(page)).toBe('source retained\n')
        await page.locator('.document-mode-toggle[aria-pressed]').click()
        await expect(page.locator('.document-mode-toggle[aria-pressed]')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await consistent(app, page, 'source', true)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        expect(await sourceText(page)).toBe('source retained\n')

        if (restoreLayoutState && !sourceDefault) {
          await page.locator('.document-mode-toggle[aria-pressed]').click()
          await expect(page.locator('.document-mode-toggle[aria-pressed]')).toHaveAttribute(
            'aria-pressed',
            'false'
          )
          await page.evaluate(() =>
            window.electron.ipcRenderer.send('mt::set-user-preference', { autoSave: true })
          )
          await expect
            .poll(
              () => JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')).autoSave
            )
            .toBe(true)
          await page
            .locator('.CodeMirror')
            .evaluate((host: SourceHost) =>
              host.CodeMirror.replaceRange('X', { line: 0, ch: 15 }, undefined, '+input')
            )
          await setLayout(app, page, 'preview')
          await consistent(app, page, 'preview', false)
          await page.waitForTimeout(1700)
          expect(files.map(fileState)).toEqual(before)
          await setLayout(app, page, 'source')
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await expect.poll(() => sourceText(page)).toBe('source retained\n')
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
          await expect.poll(() => sourceText(page)).toBe('source retainedX\n')
          await page.locator('.document-mode-toggle[aria-pressed]').click()
          await expect(page.locator('.document-mode-toggle[aria-pressed]')).toHaveAttribute(
            'aria-pressed',
            'true'
          )
        }

        const oldMenu = await app.evaluateHandle(({ Menu }) => Menu.getApplicationMenu())
        await page.evaluate(() =>
          window.electron.ipcRenderer.send('mt::set-user-preference', { theme: 'dark' })
        )
        await expect
          .poll(() => app.evaluate(({ Menu }, old) => Menu.getApplicationMenu() === old, oldMenu))
          .toBe(false)
        await oldMenu.dispose()
        await consistent(app, page, 'source', true)
        await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'new\n')
        await expect(page.locator('.tabs-container li')).toHaveCount(4)
        await consistent(app, page, fallback, false)
        const fresh = join(dirname(launched.filePath), 'fresh.md')
        writeFileSync(fresh, 'fresh\n')
        const freshBefore = fileState(fresh)
        await page.evaluate(
          (pathname) => window.electron.ipcRenderer.send('mt::open-file', pathname),
          fresh
        )
        await expect(tab(page, fresh)).toHaveClass(/active/)
        await consistent(app, page, fallback, true)
        await tab(page, files[1]).click()
        await consistent(app, page, expected('preview'), false)
        expect(files.map(fileState)).toEqual(before)
        expect(fileState(fresh)).toEqual(freshBefore)
      } finally {
        await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
      }
    })
  }
}
