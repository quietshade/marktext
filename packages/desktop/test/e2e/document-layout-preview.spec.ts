import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clickMenuById, createElectronEnvironment, getElectronPath, launchElectron, launchWithMarkdown, sendIpcToRenderer, waitForEditor, waitForMenuReady } from './helpers'

type SourceHost = HTMLElement & { CodeMirror: CodeMirror.Editor }
type Layout = 'wysiwyg' | 'source' | 'preview'
const layout = async(app: ElectronApplication, page: Page, value: Layout) => {
  await clickMenuById(app, `documentLayout-${value}`)
  await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
  await expect.poll(() => app.evaluate(({ Menu }) =>
    ['wysiwyg', 'source', 'preview'].map(layout => !!Menu.getApplicationMenu()?.getMenuItemById(`documentLayout-${layout}`)?.checked)
  )).toEqual(['wysiwyg', 'source', 'preview'].map(layout => layout === value))
}
const sourceText = (page: Page) => page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.getValue())
const snapshot = (pathname: string) => ({
  hash: createHash('sha256').update(readFileSync(pathname)).digest('hex'),
  size: statSync(pathname).size, mtimeMs: statSync(pathname).mtimeMs
})
const permissionButton = (page: Page) => page.locator('.document-mode-toggle[aria-pressed]')

test('Preview renders supported Markdown with the existing Muya theme and sanitization', async() => {
  const markdown = '# Heading\n\n**Bold** and *italic*, `inline`, ~~deleted~~.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n\n```js\nconst answer = 42\n```\n\n![local](pixel.png)\n\n[Heading](#heading)\n\n<script>window.stage2ScriptRan = true</script>\n\n<img src="missing.png" onerror="window.stage2ScriptRan = true">\n\n[unsafe](javascript:alert(1))\n'
  const directory = mkdtempSync(join(tmpdir(), 'mt-preview-render-'))
  const filePath = join(directory, 'render.md')
  writeFileSync(filePath, markdown)
  writeFileSync(join(directory, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64'))
  const { app, page } = await launchElectron([filePath], { preferences: { language: 'en', isHtmlEnabled: true, theme: 'dark' } })
  try {
    await waitForEditor(page)
    await waitForMenuReady(app)
    await layout(app, page, 'preview')
    await expect(page.locator('.document-layout-label')).toHaveText('Preview Only')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
    await expect(page.locator('.mu-read-only')).toBeVisible()
    await expect(page.locator('.CodeMirror')).toHaveCount(0)
    await expect(page.locator('.editor-component h1')).toContainText('Heading')
    await expect(page.locator('.editor-component h1 .mu-hide.mu-remove').first()).toHaveCSS('font-size', '0px')
    await expect(page.locator('.editor-component strong')).toContainText('Bold')
    await expect(page.locator('.editor-component table')).toContainText('2')
    await expect(page.locator('.editor-component')).toContainText('const answer = 42')
    await expect(page.locator('.editor-component img[alt=local]')).toBeVisible()
    await expect.poll(() => page.locator('.editor-component img[alt=local]').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
    expect(await page.locator('.editor-component script, .editor-component [onerror], .editor-component [href^="javascript:"]').count()).toBe(0)
    expect(await page.evaluate(() => (window as typeof window & { stage2ScriptRan?: boolean }).stage2ScriptRan)).toBeUndefined()
    await page.locator('.mu-link[href="#heading"]').click()
    await expect(page.locator('.document-layout-label')).toHaveText('Preview Only')
    await layout(app, page, 'source')
    expect(await sourceText(page)).toBe(markdown)
    expect(readFileSync(filePath, 'utf8')).toBe(markdown)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('Preview rejects native input, clipboard, tasks, replacement, history and application commands in Edit Mode', async() => {
  const markdown = '# Original\n\nalpha beta alpha\n\n- [ ] task\n'
  const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { autoSave: true, autoSaveDelay: 1000 } })
  const before = snapshot(filePath)
  try {
    await layout(app, page, 'preview')
    const editor = page.locator('.mu-editor')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await page.locator('.mu-paragraph-content').filter({ hasText: 'alpha beta alpha' }).click()
    await app.evaluate(({ clipboard }) => clipboard.writeText('UNWANTED'))
    for (const key of ['ControlOrMeta+v', 'ControlOrMeta+x', 'Backspace', 'Delete', 'ControlOrMeta+b', 'ControlOrMeta+z']) await page.keyboard.press(key)
    await page.keyboard.type('UNWANTED')
    await page.locator('.editor-component input[type=checkbox]').dispatchEvent('click')
    await editor.evaluate(el => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', 'UNWANTED')
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: 'UNWANTED', bubbles: true, cancelable: true }))
    })
    for (const action of ['pasteAsPlainText', 'undo', 'redo', 'duplicate', 'deleteParagraph', 'replace']) await sendIpcToRenderer(app, 'mt::editor-edit-action', action)
    for (const id of ['format.strong', 'paragraph.table', 'edit.replace', 'edit.undo', 'file.save']) await sendIpcToRenderer(app, 'mt::execute-command-by-id', id)
    await sendIpcToRenderer(app, 'mt::editor-format-action', { type: 'strong' })
    await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: 'heading 2' })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    const menu = await app.evaluate(({ Menu }) => Object.fromEntries(['undoMenuItem', 'pasteMenuItem', 'replaceMenuItem', 'paragraphMenuEntry', 'formatMenuItem', 'fileSaveMenuItem'].map(id => [id, Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled])))
    expect(Object.values(menu)).toEqual([false, false, false, false, false, false])
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    await layout(app, page, 'source')
    expect(await sourceText(page)).toBe(markdown)
    expect(snapshot(filePath)).toEqual(before)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('Preview keeps Find, native selection/copy, outline scrolling and permission controls available', async() => {
  const markdown = '# Start\n\nalpha beta alpha\n\n' + Array.from({ length: 50 }, (_, i) => `Paragraph ${i}\n\n`).join('') + '## Destination\n\nend\n'
  const { app, page } = await launchWithMarkdown(markdown)
  try {
    await layout(app, page, 'preview')
    await page.locator('.mu-paragraph-content').filter({ hasText: 'alpha beta alpha' }).evaluate(el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('alpha beta alpha')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await page.locator('.search-bar input').first().fill('alpha')
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await expect(page.locator('.search-bar .left-arrow')).toBeDisabled()
    await page.locator('.search-bar .button-group button').last().click()
    await expect(page.locator('.search-result')).toHaveText('2 / 2')
    await layout(app, page, 'source')
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await layout(app, page, 'preview')
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await expect(page.locator('.search-bar .left-arrow')).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.locator('.outline-toggle').hover()
    await page.locator('.side-bar-toc .el-tree-node__label').filter({ hasText: /^Destination$/ }).click()
    await expect.poll(() => page.locator('.editor-component').evaluate(el => el.scrollTop)).toBeGreaterThan(500)
    await permissionButton(page).click()
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    await permissionButton(page).click()
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
    await expect(page.locator('.mu-read-only')).toBeVisible()
    await page.getByRole('button', { name: 'Open in Visual Editor', exact: true }).click()
    await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'wysiwyg')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'true')
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('source edits, caret and undo history survive Preview and permission changes without an implicit save', async() => {
  const { app, page, filePath } = await launchWithMarkdown('original\n', {
    preferences: { sourceCodeModeEnabled: true, autoSave: true, autoSaveDelay: 1500 }
  })
  const before = snapshot(filePath)
  try {
    await expect.poll(() => sourceText(page)).toBe('original\n')
    await page.locator('.CodeMirror').evaluate((host: SourceHost) => {
      host.CodeMirror.replaceRange(' pending', { line: 0, ch: 8 }, undefined, '+input')
      host.CodeMirror.setCursor({ line: 0, ch: 3 })
    })
    const history = await page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.historySize())
    await layout(app, page, 'preview')
    await expect(page.locator('.mu-read-only')).toContainText('original pending')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(1)
    await permissionButton(page).click()
    await permissionButton(page).click()
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await page.waitForTimeout(1700)
    expect(snapshot(filePath)).toEqual(before)
    await layout(app, page, 'source')
    expect(await sourceText(page)).toBe('original pending\n')
    expect(await page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.historySize())).toEqual(history)
    expect(await page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.getCursor())).toMatchObject({ line: 0, ch: 3 })
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect.poll(() => sourceText(page)).toBe('original\n')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect.poll(() => sourceText(page)).toBe('original pending\n')
    expect(snapshot(filePath)).toEqual(before)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('visual undo and redo remain continuous across Preview without reloading the Muya instance', async() => {
  const { app, page } = await launchWithMarkdown('original\n')
  try {
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('X')
    await expect(paragraph).toHaveText('originalX')
    await page.locator('.mu-editor').evaluate(el => { el.setAttribute('data-instance', 'retained') })
    await layout(app, page, 'preview')
    await layout(app, page, 'wysiwyg')
    await expect(page.locator('.mu-editor')).toHaveAttribute('data-instance', 'retained')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(paragraph).toHaveText('original')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect(paragraph).toHaveText('originalX')
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('source scroll position survives a Preview round trip', async() => {
  const { app, page, filePath } = await launchWithMarkdown('line\n'.repeat(400), { preferences: { sourceCodeModeEnabled: true } })
  const before = snapshot(filePath)
  try {
    await page.locator('.source-code').evaluate(el => {
      el.scrollTop = 700
      el.dispatchEvent(new Event('scroll'))
    })
    const top = await page.locator('.source-code').evaluate(el => el.scrollTop)
    expect(top).toBeGreaterThan(500)
    await layout(app, page, 'preview')
    await layout(app, page, 'source')
    await expect.poll(() => page.locator('.source-code').evaluate(el => el.scrollTop)).toBe(top)
    expect(snapshot(filePath)).toEqual(before)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

for (const restoreLayoutState of [true, false]) {
  test(`tab layouts and permissions survive restart subject to layout restoration ${restoreLayoutState}`, async() => {
    const launched = await launchWithMarkdown('# First\n', {
      preferences: { startUpAction: 'restoreAll', restoreLayoutState, sourceCodeModeEnabled: true, defaultOpenMode: 'read', autoSave: false }
    })
    let { app, page } = launched
    const secondFile = join(dirname(launched.filePath), 'second.md')
    writeFileSync(secondFile, 'second\n')
    const before = [launched.filePath, secondFile].map(snapshot)
    const tab = (pathname: string) => page.locator('.tabs-container li').and(page.getByTitle(pathname, { exact: true }))
    try {
      await layout(app, page, 'preview')
      await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, { readOnly: false }), secondFile)
      await expect(page.locator('.CodeMirror')).toContainText('second')
      await page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.replaceRange(' retained', { line: 0, ch: 6 }))
      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '# Untitled\n')
      await layout(app, page, 'wysiwyg')
      await tab(launched.filePath).click()
      await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'preview')
      await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
      const userData = await app.evaluate(({ app }) => app.getPath('userData'))
      await app.close()
      app = await _electron.launch({
        executablePath: getElectronPath(), args: [resolve(__dirname, '../..'), '--user-data-dir', userData],
        cwd: resolve(__dirname, '../..'), env: createElectronEnvironment(process.env)
      })
      page = await app.firstWindow()
      await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', restoreLayoutState ? 'preview' : 'source')
      await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
      await expect(page.locator('.tabs-container li')).toHaveCount(3)
      await tab(secondFile).click()
      await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'source')
      await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
      expect(await sourceText(page)).toBe('second retained\n')
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(1)
      expect([launched.filePath, secondFile].map(snapshot)).toEqual(before)
      await app.close()
    } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
  })
}

test('layout commands and Ctrl+E preserve Reading Mode, update menu state and keep Split unavailable', async() => {
  const { app, page } = await launchWithMarkdown('protected\n', { preferences: { defaultOpenMode: 'read' } })
  try {
    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'view.layout-preview')
    await expect(page.locator('.document-layout-label')).toHaveText('Preview Only')
    const state = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()
      return {
        preview: menu?.getMenuItemById('documentLayout-preview')?.checked,
        reading: menu?.getMenuItemById('readOnlyModeMenuItem')?.checked,
        split: !!menu?.getMenuItemById('documentLayout-split'),
        sourceShortcut: menu?.getMenuItemById('sourceCodeModeMenuItem')?.accelerator
      }
    })
    expect(state).toMatchObject({ preview: true, reading: true, split: false })
    expect(String(state.sourceShortcut)).toMatch(/(?:Ctrl|CmdOrCtrl|CommandOrControl)\+E/)
    await sendIpcToRenderer(app, 'mt::set-document-layout', 'split')
    await expect(page.locator('.document-layout-label')).toHaveText('Preview Only')
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const modifiers = process.platform === 'darwin' ? ['meta' as const] : ['control' as const]
      win.focus()
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'E', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'E', modifiers })
    })
    await expect(page.locator('.CodeMirror')).toBeVisible()
    expect(await sourceText(page)).toBe('protected\n')
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'view.layout-wysiwyg')
    await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'wysiwyg')
    await expect(page.locator('.mu-read-only')).toBeVisible()
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

const integrityFixtures = [
  ['utf8-lf', Buffer.from('# Heading\n\nTrailing whitespace  \n\n\n')],
  ['utf8-crlf', Buffer.from('# Heading\r\n\r\nTrailing whitespace  \r\n\r\n')],
  ['utf8-bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Heading\r\n\r\nTrailing whitespace  \r\n\r\n')])],
  ['utf16le-bom', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Heading\r\n\r\nTrailing whitespace  \r\n\r\n', 'utf16le')])]
] as const

for (const [name, bytes] of integrityFixtures) {
  test(`Preview transitions preserve ${name} bytes, trailing whitespace, encoding and timestamp`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-preview-integrity-'))
    const pathname = join(directory, `${name}.md`)
    writeFileSync(pathname, bytes)
    const before = snapshot(pathname)
    const { app, page } = await launchElectron([pathname], { preferences: { autoSave: true, autoSaveDelay: 1000 } })
    try {
      await waitForEditor(page)
      await waitForMenuReady(app)
      for (const value of ['preview', 'source', 'preview', 'wysiwyg', 'preview'] as const) await layout(app, page, value)
      await permissionButton(page).click()
      await layout(app, page, 'source')
      await layout(app, page, 'preview')
      await permissionButton(page).click()
      await page.waitForTimeout(1200)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
      expect(snapshot(pathname)).toEqual(before)
      await app.close()
      expect(snapshot(pathname)).toEqual(before)
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
