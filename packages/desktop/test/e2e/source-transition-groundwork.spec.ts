import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync, statSync } from 'node:fs'
import { clickMenuById, launchWithMarkdown, placeCaretInEditor, sendIpcToRenderer } from './helpers'

type SourceHost = HTMLElement & { CodeMirror: CodeMirror.Editor }
const source = (page: Page) => page.locator('.source-code .CodeMirror')
const sourceText = (page: Page) => source(page).evaluate((el: SourceHost) => el.CodeMirror.getValue())
const fileState = (pathname: string) => ({ bytes: readFileSync(pathname).toString('hex'), mtime: statSync(pathname).mtimeMs })
const layout = async(app: ElectronApplication, page: Page, value: 'source' | 'wysiwyg' | 'preview') => {
  await clickMenuById(app, `documentLayout-${value}`)
  await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
  await expect.poll(() => app.evaluate(({ Menu }) => ['wysiwyg', 'source', 'preview'].map(id => !!Menu.getApplicationMenu()?.getMenuItemById(`documentLayout-${id}`)?.checked)))
    .toEqual(['wysiwyg', 'source', 'preview'].map(id => id === value))
}
const switchTab = async(app: ElectronApplication, page: Page, index: number, value: string) => {
  await sendIpcToRenderer(app, 'mt::switch-tab-by-index', index)
  await expect.poll(() => sourceText(page)).toBe(value)
}

for (const readOnly of [false, true]) {
  test(`native source ranges, primary caret, history and scroll survive Preview with Reading=${readOnly}`, async() => {
    const markdown = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} alpha beta\n`).join('\n')
    const { app, page, filePath } = await launchWithMarkdown(markdown, {
      preferences: { sourceCodeModeEnabled: true, defaultOpenMode: readOnly ? 'read' : 'edit', autoSave: false }
    })
    const before = fileState(filePath)
    try {
      await expect.poll(() => sourceText(page)).toBe(markdown)
      const saved = await source(page).evaluate((el: SourceHost) => {
        const cm = el.CodeMirror
        if (!cm.getOption('readOnly')) {
          cm.replaceRange(' edit', { line: 2, ch: 9 }, undefined, '+input')
          cm.undo()
        }
        cm.setSelections([
          { anchor: { line: 8, ch: 10, sticky: 'before' }, head: { line: 4, ch: 2, sticky: 'after' } },
          { anchor: { line: 12, ch: 3, sticky: 'before' }, head: { line: 12, ch: 3, sticky: 'before' } }
        ], 1, { scroll: false })
        // CodeMirror's public history loader drops affinity in historical selections.
        // Compare its round-trippable history while retaining exact live ranges below.
        cm.setHistory(cm.getHistory())
        const container = el.closest('.source-code')
        if (!container) throw new Error('Source scroll container is missing')
        container.scrollTop = 620
        return { ranges: cm.listSelections(), primary: cm.getCursor(), history: cm.getHistory() }
      })
      await layout(app, page, 'preview')
      await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
      await layout(app, page, 'source')
      await expect.poll(() => source(page).evaluate((el: SourceHost) => ({ ranges: el.CodeMirror.listSelections(), primary: el.CodeMirror.getCursor(), history: el.CodeMirror.getHistory() }))).toEqual(saved)
      await expect.poll(() => page.locator('.source-code').evaluate(el => el.scrollTop)).toBe(620)
      expect(await sourceText(page)).toBe(markdown)
      if (!readOnly) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await expect.poll(() => sourceText(page)).toContain(' edit')
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await expect.poll(() => sourceText(page)).toBe(markdown)
      } else {
        await source(page).evaluate((el: SourceHost) => el.CodeMirror.replaceRange('BLOCKED', { line: 0, ch: 0 }))
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'pasteAsPlainText')
        expect(await sourceText(page)).toBe(markdown)
      }
      expect(fileState(filePath)).toEqual(before)
    } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
  })
}

test('source reconciliation retains each document visual history across interleaved source sessions', async() => {
  const { app, page, filePath } = await launchWithMarkdown('alpha\n', { preferences: { autoSave: false } })
  const before = fileState(filePath)
  try {
    await placeCaretInEditor(page)
    await page.keyboard.type(' visual')
    await expect(page.locator('.mu-paragraph-content')).toHaveText('alpha visual')
    await layout(app, page, 'source')
    await source(page).evaluate((el: SourceHost) => el.CodeMirror.replaceRange(' source A', { line: 0, ch: 12 }, undefined, '+input'))
    const a = await sourceText(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'beta\n')
    await expect(page.locator('.tabs-container li')).toHaveCount(2)
    await layout(app, page, 'source')
    await expect.poll(() => sourceText(page)).toBe('beta\n')
    await source(page).evaluate((el: SourceHost) => el.CodeMirror.replaceRange(' source B', { line: 0, ch: 4 }, undefined, '+input'))
    const b = await sourceText(page)
    await switchTab(app, page, 0, a)
    await switchTab(app, page, 1, b)
    await switchTab(app, page, 0, a)
    await layout(app, page, 'wysiwyg')
    await expect(page.locator('.mu-paragraph-content')).toHaveText('alpha visual source A')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.locator('.mu-paragraph-content')).toHaveText('alpha visual')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.locator('.mu-paragraph-content')).toHaveText('alpha')
    await switchTab(app, page, 1, b)
    await layout(app, page, 'wysiwyg')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.locator('.mu-paragraph-content')).toHaveText('beta')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect(page.locator('.mu-paragraph-content')).toHaveText('beta source B')
    expect(fileState(filePath)).toEqual(before)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('no-op layout transitions retain source bytes and reject premature Split through IPC and menus', async() => {
  const markdown = '\uFEFF# Heading\r\n\r\n**Bold text** and *italic text*  \r\n\r\n'
  const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { autoSave: true, autoSaveDelay: 1000 } })
  const before = fileState(filePath)
  try {
    await layout(app, page, 'source')
    const canonical = await sourceText(page)
    for (const value of ['preview', 'wysiwyg', 'source', 'wysiwyg', 'source'] as const) {
      await layout(app, page, value)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    }
    expect(await sourceText(page)).toBe(canonical)
    await sendIpcToRenderer(app, 'mt::set-document-layout', 'split')
    await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', 'source')
    expect(await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu()?.getMenuItemById('documentLayout-split'))).toBe(false)
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    await layout(app, page, 'preview')
    await page.locator('.mu-editor strong').evaluate(el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = document.getSelection()
      if (!selection) throw new Error('Native selection is missing')
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Bold text')
    expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toContain('<strong>Bold text</strong>')
    expect(fileState(filePath)).toEqual(before)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})
