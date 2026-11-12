import { expect, test } from '@playwright/test'
import type { Locator } from 'playwright'
import type CodeMirror from 'codemirror'
import { readFileSync, statSync } from 'node:fs'
import { clickMenuById, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const select = (element: Locator, start?: number, end?: number, backward = false) =>
  element.evaluate(
    (el, offsets) => {
      const selection = document.getSelection()
      if (!selection) throw new Error('Native selection is unavailable')
      if (offsets.start === undefined) {
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
      } else {
        const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()
        if (!text || offsets.end === undefined)
          throw new Error('Selection fixture has no text or endpoint')
        const [anchor, focus] = offsets.backward
          ? [offsets.end, offsets.start]
          : [offsets.start, offsets.end]
        selection.setBaseAndExtent(text, anchor, text, focus)
      }
    },
    { start, end, backward }
  )

const fileState = (pathname: string) => ({
  bytes: readFileSync(pathname).toString('hex'),
  mtime: statSync(pathname).mtimeMs
})

test('Preview copies rendered formatted text without Markdown markers', async() => {
  const { app, page } = await launchWithMarkdown('**Bold text** and *italic text*\n')
  try {
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    await select(page.locator('.mu-paragraph-content'))
    await page.keyboard.press('ControlOrMeta+c')
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('Bold text and italic text')
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('full and partial bold/italic selections copy plain text and rich formatting in both directions', async() => {
  const markdown = '**Bold text** and *italic text*\n'
  const { app, page, filePath } = await launchWithMarkdown(markdown)
  const before = fileState(filePath)
  try {
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    await page.locator('.mu-paragraph-content').click()
    for (const [tag, text] of [
      ['strong', 'Bold text'],
      ['em', 'italic text']
    ]) {
      for (const backward of [false, true]) {
        for (const [start, end] of [
          [0, text.length],
          [2, 6]
        ]) {
          await select(page.locator(`.mu-editor ${tag}`), start, end, backward)
          expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
            text.slice(start, end)
          )
          await page.keyboard.press('ControlOrMeta+c')
          await expect
            .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
            .toBe(text.slice(start, end))
          const clipboard = await app.evaluate(({ clipboard }) => ({
            text: clipboard.readText(),
            html: clipboard.readHTML()
          }))
          expect(clipboard.text).toBe(text.slice(start, end))
          expect(clipboard.html).toContain(`<${tag}>${text.slice(start, end)}</${tag}>`)
          expect(clipboard.html).not.toMatch(/mu-remove|data-raw|\*\*/)
        }
      }
    }
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'copyAsRich')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('alic')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'copyAsHtml')
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('<em>alic</em>')
    expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toBe('')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    await clickMenuById(app, 'documentLayout-source')
    expect(
      await page
        .locator('.CodeMirror')
        .evaluate((el: HTMLElement & { CodeMirror: CodeMirror.Editor }) => el.CodeMirror.getValue())
    ).toBe(markdown)
    expect(fileState(filePath)).toEqual(before)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('pointer selection keeps Preview markers and editing tools hidden; WYSIWYG retains Markdown copy', async() => {
  const { app, page } = await launchWithMarkdown('**Bold text** and *italic text*\n')
  try {
    await page.locator('.mu-paragraph-content').click()
    await select(page.locator('.mu-paragraph-content'))
    await page.keyboard.press('ControlOrMeta+c')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      '**Bold text** and *italic text*'
    )
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    const bounds = await page.locator('.mu-editor strong').boundingBox()
    expect(bounds).not.toBeNull()
    if (!bounds) throw new Error('Bold text has no visible bounds')
    const { x, y, width, height } = bounds
    for (const backward of [false, true]) {
      const left = x + 1
      const right = x + width - 1
      await page.mouse.move(backward ? right : left, y + height / 2)
      await page.mouse.down()
      await page.mouse.move(backward ? left : right, y + height / 2, { steps: 12 })
      await page.mouse.up()
      await expect
        .poll(() => page.evaluate(() => document.getSelection()?.toString()))
        .toBe('Bold text')
      await page.keyboard.press('ControlOrMeta+c')
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Bold text')
      expect(
        await page
          .locator('.mu-editor .mu-remove')
          .evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === 'none'))
      ).toBe(true)
      expect(
        await page
          .locator('.mu-format-picker-container')
          .evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '0'))
      ).toBe(true)
    }
    await clickMenuById(app, 'documentLayout-wysiwyg')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'true')
    await page.locator('.mu-paragraph-content').click()
    await select(page.locator('.mu-paragraph-content'))
    await page.keyboard.press('ControlOrMeta+c')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      '**Bold text** and *italic text*'
    )
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('Preview copies headings, lists, links, tables and code as rendered content', async() => {
  const { app, page, filePath } = await launchWithMarkdown(
    '# Heading\n\n- first\n- second\n\n[Example](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```text\nconst x = 1\n  indented\n```\n'
  )
  const before = fileState(filePath)
  try {
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    for (const [selector, text, html] of [
      ['h1', 'Heading', '<h1'],
      ['ul', 'first\n\nsecond', '<li'],
      ['.mu-link', 'Example', 'href="https://example.com"'],
      ['table', 'A\nB\n1\n2\n', '<table'],
      ['.mu-code', 'const x = 1\n  indented', '<code']
    ]) {
      await select(page.locator(`.mu-editor ${selector}`).first())
      await page.keyboard.press('ControlOrMeta+c')
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(text)
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(text)
      expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toContain(html)
    }
    expect(fileState(filePath)).toEqual(before)
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('Preview selection and copying preserve dirty source history, Reading Mode and file integrity', async() => {
  const original = '\uFEFF**Bold text**  \r\n'
  const { app, page, filePath } = await launchWithMarkdown(original, {
    preferences: { sourceCodeModeEnabled: true, autoSave: true, autoSaveDelay: 1500 }
  })
  const before = fileState(filePath)
  const source = () =>
    page
      .locator('.CodeMirror')
      .evaluate((el: HTMLElement & { CodeMirror: CodeMirror.Editor }) => el.CodeMirror.getValue())
  try {
    await expect.poll(source).toContain('**Bold text**')
    const loaded = await source()
    await page
      .locator('.CodeMirror')
      .evaluate((el: HTMLElement & { CodeMirror: CodeMirror.Editor }) =>
        el.CodeMirror.replaceRange(' pending', { line: 0, ch: 13 }, undefined, '+input')
      )
    const edited = await source()
    const history = await page
      .locator('.CodeMirror')
      .evaluate((el: HTMLElement & { CodeMirror: CodeMirror.Editor }) =>
        el.CodeMirror.historySize()
      )
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(1)
    await page.locator('.document-mode-toggle[aria-pressed]').click()
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Reading Mode')
    await select(page.locator('.mu-editor strong'), 0, 9, true)
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Bold text')
    for (const key of [
      'ControlOrMeta+x',
      'ControlOrMeta+v',
      'Delete',
      'ControlOrMeta+b',
      'ControlOrMeta+z'
    ])
      await page.keyboard.press(key)
    await page.waitForTimeout(1700)
    expect(fileState(filePath)).toEqual(before)
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(1)
    await clickMenuById(app, 'documentLayout-source')
    await expect(page.locator('.CodeMirror')).toBeVisible()
    expect(await source()).toBe(edited)
    expect(
      await page
        .locator('.CodeMirror')
        .evaluate((el: HTMLElement & { CodeMirror: CodeMirror.Editor }) =>
          el.CodeMirror.historySize()
        )
    ).toEqual(history)
    await page.locator('.document-mode-toggle[aria-pressed]').click()
    await expect(page.locator('.document-mode [role=status]')).toHaveText('Edit Mode')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect.poll(source).toBe(loaded)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect.poll(source).toBe(edited)
    expect(fileState(filePath)).toEqual(before)
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})

test('Preview marker suppression preserves rendered math, ruby, emoji and entities', async() => {
  const { app, page } = await launchWithMarkdown(
    '$a+b$\n\n<ruby>漢<rt>kan</rt></ruby>\n\n:smile: &amp;\n',
    {
      preferences: { isHtmlEnabled: true }
    }
  )
  try {
    await clickMenuById(app, 'documentLayout-preview')
    await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', 'false')
    for (const selector of [
      '.mu-math-render .katex',
      '.mu-ruby-render ruby',
      '.mu-emoji-marked-text',
      '.mu-html-escape'
    ]) {
      const element = page.locator(`.mu-editor ${selector}`).first()
      await expect(element).toBeAttached()
      expect(
        await element.evaluate((el) => {
          for (let node: Element | null = el; node; node = node.parentElement) {
            if (getComputedStyle(node).display === 'none') return false
          }
          return true
        })
      ).toBe(true)
    }
    await expect(page.locator('.mu-math-render .katex')).toBeVisible()
    await expect(page.locator('.mu-ruby-render ruby')).toBeVisible()
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  }
})
