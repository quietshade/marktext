import type CodeMirror from 'codemirror'
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'
import {
  clickMenuById, enterSourceMode, exitSourceMode, launchElectron, launchWithMarkdown,
  sendIpcToRenderer, waitForEditor, waitForMenuReady, createElectronEnvironment, getElectronPath
} from './helpers'

type SourceHost = HTMLElement & { CodeMirror: CodeMirror.Editor }
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('Reading Mode preserves sidebar shortcuts, commands, width restoration and independent outline', async() => {
  const launched = await launchWithMarkdown('# Heading\n\n## Child\n', {
    preferences: { defaultOpenMode: 'read', sideBarVisibility: true, restoreLayoutState: true, startUpAction: 'restoreAll' }
  })
  let { app, page } = launched
  try {
    const sidebar = page.locator('.side-bar')
    await expect(sidebar).toBeVisible()
    await expect(page.locator('.document-outline')).toBeVisible()
    const drag = await sidebar.locator('.drag-bar').boundingBox()
    if (!drag) throw new Error('Sidebar resize handle is missing')
    await page.mouse.move(drag.x + drag.width / 2, drag.y + 80)
    await page.mouse.down()
    await page.mouse.move(drag.x + drag.width / 2 + 110, drag.y + 80, { steps: 8 })
    await page.mouse.up()
    const width = await sidebar.evaluate(el => Math.round(el.getBoundingClientRect().width))
    expect(width).toBeGreaterThanOrEqual(300)
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const modifiers = process.platform === 'darwin' ? ['meta' as const] : ['control' as const]
      win.focus()
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers })
    })
    await expect(sidebar).toBeHidden()
    await expect(page.locator('.document-outline')).toBeVisible()
    await clickMenuById(app, 'sideBarMenuItem')
    await expect(sidebar).toBeVisible()
    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'view.toggle-sidebar')
    await expect(sidebar).toBeHidden()
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await app.close()
    app = await _electron.launch({
      executablePath: getElectronPath(),
      args: [resolve(__dirname, '../..'), '--user-data-dir', userData],
      cwd: resolve(__dirname, '../..'), env: createElectronEnvironment(process.env)
    })
    page = await app.firstWindow()
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await expect(page.locator('.side-bar')).toBeHidden()
    await clickMenuById(app, 'sideBarMenuItem')
    await expect(page.locator('.side-bar')).toBeVisible()
    expect(await page.locator('.side-bar').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width)
    await expect(page.locator('.document-outline')).toBeVisible()
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('the General preference changes future opens while retaining current and untitled document modes', async() => {
  const { app, page, filePath } = await launchWithMarkdown('already open\n', {
    preferences: { language: 'en', openFilesInPreviewMode: false }
  })
  try {
    await expect(page.locator('.document-mode')).toContainText('Edit Mode')
    const settingsPromise = app.waitForEvent('window')
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('app-create-settings-window') })
    const settings = await settingsPromise
    await settings.waitForSelector('.pref-general')
    const preference = settings.locator('.pref-general .pref-select-item').first()
    await expect(preference).toContainText('Default mode for opened files')
    await expect(preference).toContainText('New documents remain editable')
    await preference.locator('.el-select').click()
    await settings.getByRole('option', { name: 'Reading Mode', exact: true }).click()
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')).defaultOpenMode).toBe('read')
    await settings.close()
    await expect(page.locator('.document-mode')).toContainText('Edit Mode')
    const second = join(dirname(filePath), 'second.md')
    writeFileSync(second, 'opened later\n')
    await page.evaluate(pathname => window.electron.ipcRenderer.send('mt::open-file', pathname, {}), second)
    await expect(page.locator('.editor-component')).toContainText('opened later')
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'untitled\n')
    await expect(page.locator('.document-mode')).toContainText('Edit Mode')
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('recovery after Cancel retains locked dirty source buffers with a different opening default', async() => {
  const launched = await launchWithMarkdown('disk version\n', {
    preferences: { sourceCodeModeEnabled: true, startUpAction: 'restoreAll', defaultOpenMode: 'edit' }
  })
  let { app, page } = launched
  try {
    await page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.setValue('retained dirty version\n'))
    await page.locator('.document-mode-toggle').click()
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await app.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { closePrompts?: number }
      state.closePrompts = 0
      dialog.showMessageBox = async() => {
        state.closePrompts = (state.closePrompts ?? 0) + 1
        return { response: 2, checkboxChecked: false }
      }
    })
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::app-try-quit'))
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { closePrompts?: number }).closePrompts)).toBe(1)
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    // Simulate process loss after the close attempt has persisted the recovery buffer.
    const closed = app.waitForEvent('close')
    await app.evaluate(({ app }) => app.exit(0))
    await closed
    app = await _electron.launch({
      executablePath: getElectronPath(),
      args: [resolve(__dirname, '../..'), '--user-data-dir', userData],
      cwd: resolve(__dirname, '../..'), env: createElectronEnvironment(process.env)
    })
    page = await app.firstWindow()
    await expect(page.locator('.CodeMirror')).toContainText('retained dirty version')
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(1)
    expect(readFileSync(launched.filePath, 'utf8')).toBe('disk version\n')
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('read-only source rejects native and programmatic edits while retaining selection, copy and find', async() => {
  const markdown = '# Original\n\nalpha beta alpha\n'
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    preferences: { defaultOpenMode: 'read', sourceCodeModeEnabled: true, autoSave: true }
  })
  const source = page.locator('.CodeMirror')
  const value = () => source.evaluate((host: SourceHost) => host.CodeMirror.getValue())
  try {
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await expect.poll(() => source.evaluate((host: SourceHost) => host.CodeMirror.getOption('readOnly'))).toBe(true)
    await source.click()
    await page.keyboard.press(`${modifier}+a`)
    await page.keyboard.press(`${modifier}+c`)
    await expect.poll(async() => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(markdown)
    await app.evaluate(({ clipboard }) => clipboard.writeText('UNWANTED'))
    for (const key of [`${modifier}+v`, `${modifier}+x`, 'Backspace', 'Delete', `${modifier}+b`]) {
      await page.keyboard.press(key)
    }
    await page.keyboard.type('UNWANTED')
    await source.evaluate((host: SourceHost) => {
      const cm = host.CodeMirror
      cm.setValue('UNWANTED')
      cm.replaceRange('UNWANTED', { line: 0, ch: 0 })
      cm.undo()
      cm.redo()
      cm.getInputField().dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertCompositionText', data: 'UNWANTED', bubbles: true, cancelable: true
      }))
    })
    for (const action of ['pasteAsPlainText', 'undo', 'redo', 'duplicate', 'deleteParagraph', 'replace']) {
      await sendIpcToRenderer(app, 'mt::editor-edit-action', action)
    }
    await sendIpcToRenderer(app, 'mt::editor-format-action', { type: 'strong' })
    await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: 'heading 1' })
    for (const id of ['format.strong', 'paragraph.table', 'edit.replace', 'edit.undo']) {
      await sendIpcToRenderer(app, 'mt::execute-command-by-id', id)
    }
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(value).toBe(markdown)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await page.locator('.search-bar input').first().fill('alpha')
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await expect(page.locator('.search-bar .left-arrow')).toBeDisabled()
    await page.locator('.search-bar .button-group button').last().click()
    await expect(page.locator('.search-result')).toHaveText('2 / 2')
    await page.keyboard.press('Escape')
    await source.evaluate((host: SourceHost) => host.CodeMirror.setSelection({ line: 2, ch: 0 }, { line: 2, ch: 5 }))
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'copyAsHtml')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('alpha')
    await expect.poll(value).toBe(markdown)
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    expect(readFileSync(filePath, 'utf8')).toBe(markdown)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('visual Reading Mode supports non-mutating find and source navigation', async() => {
  const { app, page, filePath } = await launchWithMarkdown('alpha beta alpha\n', {
    preferences: { defaultOpenMode: 'read' }
  })
  try {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await page.locator('.search-bar input').first().fill('alpha')
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await expect(page.locator('.search-bar .left-arrow')).toBeDisabled()
    await page.keyboard.press('Escape')
    await enterSourceMode(page, app)
    await expect(page.locator('.document-mode')).toContainText('Reading Mode')
    await exitSourceMode(page, app)
    await expect(page.locator('.mu-read-only')).toBeVisible()
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    expect(readFileSync(filePath, 'utf8')).toBe('alpha beta alpha\n')
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('source search options and replacement use the source undo history', async() => {
  const markdown = 'alpha ALPHA alphabet\nalpha\n'
  const { app, page } = await launchWithMarkdown(markdown, {
    preferences: { sourceCodeModeEnabled: true }
  })
  const source = page.locator('.CodeMirror')
  try {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    const query = page.locator('.search-bar input').first()
    await query.fill('alpha')
    await expect(page.locator('.search-result')).toHaveText('1 / 4')
    await page.locator('.search-bar .is-whole-word').click()
    await expect(page.locator('.search-result')).toHaveText('1 / 3')
    await page.locator('.search-bar .is-case-sensitive').click()
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await page.locator('.search-bar .is-regex').click()
    await query.fill('alph[a]')
    await expect(page.locator('.search-result')).toHaveText('1 / 2')
    await page.locator('.search-bar .left-arrow').click()
    await page.locator('.search-bar .replace input').fill('omega')
    await page.locator('.search-bar .replace .button-group button').first().click()
    await expect.poll(() => source.evaluate((host: SourceHost) => host.CodeMirror.getValue())).toBe('omega ALPHA alphabet\nomega\n')
    await page.keyboard.press('Escape')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect.poll(() => source.evaluate((host: SourceHost) => host.CodeMirror.getValue())).toBe(markdown)
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('external reload updates locked source without unlocking it or writing back', async() => {
  const { app, page, filePath } = await launchWithMarkdown('before reload\n', {
    preferences: { sourceCodeModeEnabled: true, defaultOpenMode: 'read', autoSave: true, autoSaveDelay: 1000 }
  })
  try {
    await expect(page.locator('.CodeMirror')).toContainText('before reload')
    writeFileSync(filePath, 'external version\n')
    const changedMtime = statSync(filePath).mtimeMs
    await expect(page.locator('.CodeMirror')).toContainText('external version', { timeout: 8000 })
    await expect.poll(() => page.locator('.CodeMirror').evaluate((host: SourceHost) => host.CodeMirror.getOption('readOnly'))).toBe(true)
    await page.waitForTimeout(1300)
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    expect(readFileSync(filePath, 'utf8')).toBe('external version\n')
    expect(statSync(filePath).mtimeMs).toBe(changedMtime)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('immediate source changes survive lock, unlock and undo without implicit disk writes', async() => {
  const { app, page, filePath } = await launchWithMarkdown('original\n', {
    preferences: { sourceCodeModeEnabled: true, autoSave: true, autoSaveDelay: 1500 }
  })
  const source = page.locator('.CodeMirror')
  const value = () => source.evaluate((host: SourceHost) => host.CodeMirror.getValue())
  const toggle = page.locator('.document-mode-toggle')
  try {
    await source.evaluate((host: SourceHost) => {
      host.dataset.instance = 'retained'
      host.CodeMirror.replaceRange(' pending', { line: 0, ch: 8 }, undefined, '+input')
    })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(source).toHaveAttribute('data-instance', 'retained')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(1)
    await source.click()
    await page.keyboard.press(`${modifier}+z`)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await page.waitForTimeout(1800)
    expect(await value()).toBe('original pending\n')
    expect(readFileSync(filePath, 'utf8')).toBe('original\n')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await page.waitForTimeout(1800)
    expect(readFileSync(filePath, 'utf8')).toBe('original\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect.poll(value).toBe('original\n')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect.poll(value).toBe('original pending\n')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('original pending\n')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    await source.evaluate((host: SourceHost) => host.CodeMirror.replaceRange(' saved', { line: 0, ch: 16 }))
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('original pending saved\n')
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

for (const titleBarStyle of ['custom', 'native']) {
  test(`mode indicator remains accessible with hidden chrome and ${titleBarStyle} title bar`, async() => {
    const { app, page } = await launchWithMarkdown('indicator\n', {
      preferences: {
        titleBarStyle, defaultOpenMode: 'read', tabBarVisibility: false,
        sideBarVisibility: false, restoreLayoutState: true,
        theme: titleBarStyle === 'native' ? 'dark' : 'light'
      }
    })
    try {
      await expect(page.locator('.side-bar')).toBeHidden()
      await expect(page.locator('.tabs-container')).toBeHidden()
      await expect(page.locator('.document-mode [role=status]')).toContainText('Reading Mode')
      await expect(page.locator('.document-mode-toggle')).toBeVisible()
      await page.locator('.document-mode-toggle').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.document-mode [role=status]')).toContainText('Edit Mode')
      await expect(page.locator('.document-mode-toggle')).toBeFocused()
      await page.keyboard.press('Space')
      await expect(page.locator('.document-mode [role=status]')).toContainText('Reading Mode')
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    }
  })
}

const fixtures = [
  ['utf8-lf', Buffer.from('# Heading\n\nTrailing spaces  \n\n\n')],
  ['utf8-crlf', Buffer.from('# Heading\r\n\r\nTrailing spaces  \r\n\r\n')],
  ['utf8-bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Heading\r\n\n')])],
  ['utf16le-bom', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Heading\r\n\r\n', 'utf16le')])]
] as const

for (const [name, bytes] of fixtures) {
  test(`viewing and changing modes preserve ${name} bytes and modification time`, async() => {
    const dir = mkdtempSync(join(tmpdir(), 'marktext-viewer-integrity-'))
    const filePath = join(dir, `${name}.md`)
    writeFileSync(filePath, bytes)
    const snapshot = () => ({
      hash: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
      size: statSync(filePath).size, mtimeMs: statSync(filePath).mtimeMs
    })
    const before = snapshot()
    const { app, page } = await launchElectron([filePath], {
      preferences: { defaultOpenMode: 'read', autoSave: true, autoSaveDelay: 1000 }
    })
    try {
      await waitForEditor(page)
      await waitForMenuReady(app)
      await enterSourceMode(page, app)
      await page.locator('.document-mode-toggle').click()
      await page.locator('.CodeMirror').click()
      await page.keyboard.press(`${modifier}+a`)
      await page.keyboard.press('ArrowRight')
      await page.locator('.document-mode-toggle').click()
      await exitSourceMode(page, app)
      await page.locator('.document-mode-toggle').click()
      await page.locator('.document-mode-toggle').click()
      await page.waitForTimeout(1300)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
      expect(snapshot()).toEqual(before)
      await app.close()
      expect(snapshot()).toEqual(before)
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
