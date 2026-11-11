import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { clickMenuById, launchWithMarkdown, sendIpcToRenderer } from './helpers'
import { nativeKeys, nativeMenu } from './nativeApplicationMenu'

type SourceHost = HTMLElement & { CodeMirror: CodeMirror.Editor }
const markdown = Array.from({ length: 180 }, (_, i) => `Line ${String(i + 1).padStart(3, '0')}: numbered source text`).join('\n') + '\n'
const originalMarkdown = ['# Source state test', '', ...Array.from({ length: 180 }, (_, i) => `Line ${String(i + 1).padStart(3, '0')}: Alpha Bravo Charlie Delta Echo Foxtrot`)].join('\r\n')
const source = (page: Page) => page.locator('.source-code .CodeMirror')
const pressSourceKeys = async(page: Page, keys: '^{END}+({UP}{UP})' | '+({UP}{UP})' | '+{RIGHT}' | '^c') => {
  if (process.platform === 'win32') {
    await nativeKeys(keys)
  } else if (keys === '^c') {
    await page.keyboard.press('ControlOrMeta+c')
  } else if (keys === '+{RIGHT}') {
    await page.keyboard.press('Shift+ArrowRight')
  } else {
    if (keys === '^{END}+({UP}{UP})') await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.up('Shift')
  }
}
const physicalMenuLayout = async(app: ElectronApplication, page: Page, value: 'source' | 'preview') => {
  if (process.platform !== 'win32') {
    await clickMenuById(app, `documentLayout-${value}`)
    await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
    await record(`menu-${value}-${test.info().attachments.length}`, { platform: process.platform, route: 'non-Windows command-handler fallback' })
    return
  }
  const button = page.getByRole('button', { name: 'Application Menu', exact: true })
  if (await button.isVisible()) await button.click()
  else if (!await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible())) await nativeKeys('{F10}')
  const pid = await app.evaluate(() => process.pid)
  await record(`menu-${value}-${test.info().attachments.length}`, await nativeMenu(pid, ['View', 'Document Layout', value === 'source' ? 'Markdown Source' : 'Preview Only']))
  await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
}
const paletteLayout = async(app: ElectronApplication, page: Page, value: 'source' | 'preview') => {
  if (process.platform === 'win32') await nativeKeys('^+p')
  else await sendIpcToRenderer(app, 'mt::show-command-palette')
  const input = page.locator('.search-wrapper input.search').first()
  await expect(input).toBeFocused()
  await input.pressSequentially(value === 'source' ? 'Markdown Source' : 'Preview Only')
  await expect(page.locator('.command-item').filter({ hasText: value === 'source' ? 'Markdown Source' : 'Preview Only' })).toHaveCount(1)
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
  await expect(input).toBeHidden()
}
const diskState = (pathname: string) => ({ bytes: readFileSync(pathname).toString('hex'), mtime: statSync(pathname).mtimeMs })
const layout = async(app: ElectronApplication, page: Page, value: 'source' | 'preview' | 'wysiwyg') => {
  await page.getByRole('button', { name: 'Application Menu', exact: true }).click()
  await app.evaluate(({ Menu, BrowserWindow }, layout) => {
    const menu = Menu.getApplicationMenu()
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!menu || !win) throw new Error('Application menu/window missing')
    const item = menu.getMenuItemById(`documentLayout-${layout}`)
    if (!item) throw new Error('Layout menu item missing')
    item.checked = true
    item.click(undefined, win, win.webContents)
  }, value)
  await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', value)
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.closePopup(BrowserWindow.getAllWindows()[0])
  })
}
const record = async(name: string, value: unknown) => {
  const path = test.info().outputPath(`${name}.json`)
  writeFileSync(path, JSON.stringify(value, null, 2))
  await test.info().attach(name, { path, contentType: 'application/json' })
}
const snapshot = (page: Page) => source(page).evaluate((host: SourceHost) => {
  const cm = host.CodeMirror
  const container = host.closest('.source-code')
  if (!container) throw new Error('Source scroll container is missing')
  return {
    ranges: cm.listSelections(),
    anchor: cm.getCursor('anchor'),
    head: cm.getCursor('head'),
    primary: cm.getCursor(),
    selectedText: cm.getSelection(),
    selectedTexts: cm.getSelections(),
    markdown: cm.getValue(),
    scrollTop: container.scrollTop,
    cmScroll: cm.getScrollInfo(),
    topLine: cm.lineAtHeight(container.getBoundingClientRect().top + 1, 'window'),
    hasFocus: cm.hasFocus()
  }
})
const traceFrames = (page: Page) => source(page).evaluate(async(host: SourceHost) => {
  const cm = host.CodeMirror
  const container = host.closest('.source-code')
  if (!container) throw new Error('Source scroll container is missing')
  const frames = []
  for (let frame = 0; frame < 60; frame++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    frames.push({ frame, ranges: structuredClone(cm.listSelections()), selectedText: cm.getSelection(), scrollTop: container.scrollTop, cmScroll: cm.getScrollInfo(), hasFocus: cm.hasFocus() })
  }
  return frames
})
const selectionState = (state: Awaited<ReturnType<typeof snapshot>>) => ({
  ranges: state.ranges, anchor: state.anchor, head: state.head, primary: state.primary,
  selectedText: state.selectedText, selectedTexts: state.selectedTexts, markdown: state.markdown
})

test('disposable physical-selection diagnostic observes transitions without exposing source text or changing history', async() => {
  const { app, page, filePath } = await launchWithMarkdown(originalMarkdown, { preferences: { autoSave: false } })
  const disk = diskState(filePath)
  try {
    await clickMenuById(app, 'documentLayout-source')
    await expect(source(page)).toBeVisible()
    const history = await source(page).evaluate((host: SourceHost) => host.CodeMirror.getHistory())
    const diagnostic = readFileSync(resolve(__dirname, '../../../../docs/MarkTextPlus1/source-selection-diagnostic.js'), 'utf8')
    await page.evaluate(diagnostic)
    expect(await source(page).evaluate((host: SourceHost) => host.CodeMirror.getHistory())).toEqual(history)
    await pressSourceKeys(page, '^{END}+({UP}{UP})')
    const before = await snapshot(page)
    await physicalMenuLayout(app, page, 'preview')
    await physicalMenuLayout(app, page, 'source')
    const after = await snapshot(page)
    const trace = await page.evaluate(async() => {
      const diagnostic = (window as typeof window & { marktextSourceTrace: { stop(): Promise<unknown> } }).marktextSourceTrace
      return diagnostic.stop()
    }) as { diagnosticErrors: number; events: { event: string; selectedSHA256: string }[] }
    await record('physical-selection-diagnostic', trace)
    await record('diagnostic-selection', { before, after })
    expect(trace.diagnosticErrors).toBe(0)
    expect(selectionState(after)).toEqual(selectionState(before))
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain('Alpha Bravo')
    expect(serialized).not.toContain('Source state test')
    expect(serialized).not.toContain(filePath)
    expect(trace.events.map(event => event.event)).toEqual(expect.arrayContaining(['source-removed', 'source-added', 'getHistory:before', 'setSelections:after']))
    expect(trace.events.map(event => event.selectedSHA256)).toContain(createHash('sha256').update(before.selectedText).digest('hex'))
    expect(diskState(filePath)).toEqual(disk)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('the physical-selection diagnostic refuses a document other than the exact disposable fixture', async() => {
  const { app, page } = await launchWithMarkdown('private-document-placeholder\n', { preferences: { autoSave: false } })
  try {
    await clickMenuById(app, 'documentLayout-source')
    await expect(source(page)).toBeVisible()
    const diagnostic = readFileSync(resolve(__dirname, '../../../../docs/MarkTextPlus1/source-selection-diagnostic.js'), 'utf8')
    await expect(page.evaluate(diagnostic)).rejects.toThrow('only the exact disposable')
    expect(await page.evaluate(() => 'marktextSourceTrace' in window)).toBe(false)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

test('exact-fixture source selections remain independent across tabs and repeated palette transitions', async() => {
  const { app, page, filePath } = await launchWithMarkdown(originalMarkdown, { preferences: { autoSave: false } })
  const disk = diskState(filePath)
  try {
    await clickMenuById(app, 'documentLayout-source')
    await expect(source(page)).toBeVisible()
    await source(page).click()
    await pressSourceKeys(page, '^{END}+({UP}{UP})')
    const a = await snapshot(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, originalMarkdown)
    await expect(page.locator('.tabs-container li')).toHaveCount(2)
    await clickMenuById(app, 'documentLayout-source')
    await expect(source(page)).toBeVisible()
    await source(page).evaluate((host: SourceHost) => host.CodeMirror.setCursor({ line: 90, ch: 20 }))
    await pressSourceKeys(page, '+({UP}{UP})')
    const b = await snapshot(page)
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const [index, before] of [a, b].entries()) {
        await sendIpcToRenderer(app, 'mt::switch-tab-by-index', index)
        await expect.poll(async() => (await snapshot(page)).anchor).toEqual(before.anchor)
        await paletteLayout(app, page, 'preview')
        await paletteLayout(app, page, 'source')
        const after = await snapshot(page)
        await record(`exact-tab-${index}-${cycle}`, { before, after })
        expect(selectionState(after)).toEqual(selectionState(before))
      }
    }
    expect(diskState(filePath)).toEqual(disk)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})

for (const fixture of ['original-crlf', 'previous-lf'] as const) {
  for (const route of ['popup', 'native-bar', 'palette'] as const) {
    for (const position of ['end', 'middle'] as const) {
      test(`physical fixture ${fixture} via ${route} at ${position} retains exact backwards selection`, async() => {
        const contents = fixture === 'original-crlf' ? originalMarkdown : markdown
        const { app, page, filePath } = await launchWithMarkdown(contents, { preferences: { autoSave: false, titleBarStyle: route === 'native-bar' ? 'native' : 'custom' } })
        const disk = diskState(filePath)
        try {
          expect(readFileSync(filePath, 'utf8')).toBe(contents)
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0]
            win.unmaximize()
          })
          expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false)
          await clickMenuById(app, 'documentLayout-source')
          await expect(source(page)).toBeVisible()
          await source(page).click()
          if (position === 'middle') {
            await source(page).evaluate((host: SourceHost) => host.CodeMirror.setCursor({ line: 90, ch: 20 }))
            await pressSourceKeys(page, '+({UP}{UP})')
          } else {
            await pressSourceKeys(page, '^{END}+({UP}{UP})')
          }
          const before = await snapshot(page)
          expect(before.anchor.line).toBeGreaterThan(before.head.line)
          expect(before.markdown).toBe(fixture === 'original-crlf' ? originalMarkdown.replaceAll('\r\n', '\n') : markdown)
          expect(before.markdown.endsWith('\n')).toBe(fixture === 'previous-lf')
          await pressSourceKeys(page, '^c')
          const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText())
          expect(clipboardBefore).toBe(process.platform === 'win32' ? before.selectedText.replaceAll('\n', '\r\n') : before.selectedText)
          const switchLayout = (value: 'source' | 'preview') => route === 'palette' ? paletteLayout(app, page, value) : physicalMenuLayout(app, page, value)
          await switchLayout('preview')
          await switchLayout('source')
          const immediatelyAfter = await snapshot(page)
          await pressSourceKeys(page, '^c')
          const clipboardAfter = await app.evaluate(({ clipboard }) => clipboard.readText())
          const copied = await snapshot(page)
          const frames = await traceFrames(page)
          const focused = await snapshot(page)
          await pressSourceKeys(page, '+{RIGHT}')
          const extended = await snapshot(page)
          await record('original-fixture-selection', { before, clipboardBefore, immediatelyAfter, frames, focused, copied, clipboardAfter, extended, clipboardBeforeHex: Buffer.from(clipboardBefore).toString('hex'), clipboardAfterHex: Buffer.from(clipboardAfter).toString('hex') })
          for (const frame of frames) {
            expect(frame.ranges).toEqual(before.ranges)
            expect(frame.selectedText).toBe(before.selectedText)
          }
          expect(selectionState(immediatelyAfter)).toEqual(selectionState(before))
          expect(immediatelyAfter.hasFocus).toBe(true)
          expect(selectionState(focused)).toEqual(selectionState(before))
          expect(selectionState(copied)).toEqual(selectionState(before))
          expect(clipboardAfter).toBe(clipboardBefore)
          expect(extended.anchor).toEqual(before.anchor)
          const atLineEnd = before.head.ch === before.markdown.split('\n')[before.head.line].length
          expect(extended.head).toMatchObject(atLineEnd ? { line: before.head.line + 1, ch: 0 } : { line: before.head.line, ch: before.head.ch + 1 })
          expect(extended.selectedText).toBe(before.selectedText.slice(1))
          await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
          expect(diskState(filePath)).toEqual(disk)
        } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
      })
    }
  }
}

for (const destination of ['preview', 'wysiwyg'] as const) {
  for (const readOnly of [false, true]) {
    test(`keyboard backwards selection survives Source ${destination} with Reading=${readOnly}`, async() => {
      const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { autoSave: false, defaultOpenMode: readOnly ? 'read' : 'edit' } })
      const disk = diskState(filePath)
      try {
        await layout(app, page, 'source')
        await source(page).click()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.down('Shift')
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('ArrowUp')
        await page.keyboard.up('Shift')
        const before = await snapshot(page)
        expect(before.anchor.line).toBe(180)
        expect(before.head.line).toBe(178)
        expect(before.selectedText).toBe('Line 179: numbered source text\nLine 180: numbered source text\n')
        await page.keyboard.press('ControlOrMeta+c')
        const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText())
        // Windows native plain-text clipboard uses CRLF; the source buffer remains LF.
        expect(clipboardBefore).toBe(process.platform === 'win32' ? before.selectedText.replace(/\n/g, '\r\n') : before.selectedText)
        for (let cycle = 0; cycle < 2; cycle++) {
          await layout(app, page, destination)
          await layout(app, page, 'source')
          const frames = await traceFrames(page)
          const after = await snapshot(page)
          expect(selectionState(after)).toEqual(selectionState(before))
          for (const frame of frames) {
            expect(frame.ranges).toEqual(before.ranges)
            expect(frame.selectedText).toBe(before.selectedText)
          }
          await page.keyboard.press('ControlOrMeta+c')
          const clipboardAfter = await app.evaluate(({ clipboard }) => clipboard.readText())
          await record(`keyboard-selection-round-trip-${cycle}`, { before, frames, after, clipboardBefore, clipboardAfter })
          expect(clipboardAfter).toBe(clipboardBefore)
        }
        await page.keyboard.press('Shift+ArrowRight')
        const extended = await snapshot(page)
        expect(extended.anchor).toEqual(before.anchor)
        expect(extended.head).toMatchObject({ line: 178, ch: 1 })
        expect(extended.selectedText).toBe(before.selectedText.slice(1))
        await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
        expect(diskState(filePath)).toEqual(disk)
      } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
    })

    test(`wheel-scrolled Source survives ${destination} and late focus with Reading=${readOnly}`, async() => {
      const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { autoSave: false, defaultOpenMode: readOnly ? 'read' : 'edit' } })
      const disk = diskState(filePath)
      try {
        await layout(app, page, 'source')
        await source(page).click()
        await page.keyboard.press('ControlOrMeta+Home')
        const target = await source(page).evaluate((host: SourceHost) => host.CodeMirror.heightAtLine(89, 'local'))
        await page.mouse.wheel(0, target)
        await expect.poll(() => page.locator('.source-code').evaluate(el => el.scrollTop)).toBeGreaterThan(1500)
        await traceFrames(page)
        const before = await snapshot(page)
        expect(before.primary).toMatchObject({ line: 0, ch: 0 })
        await layout(app, page, destination)
        await layout(app, page, 'source')
        const frames = await traceFrames(page)
        const immediatelyAfter = await snapshot(page)
        await page.getByRole('button', { name: 'Application Menu', exact: true }).focus()
        await source(page).evaluate((host: SourceHost) => host.CodeMirror.focus())
        const focusFrames = await traceFrames(page)
        const after = await snapshot(page)
        await record('wheel-scroll-round-trip', { before, frames, immediatelyAfter, focusFrames, after })
        expect(immediatelyAfter.scrollTop).toBe(before.scrollTop)
        for (const frame of [...frames, ...focusFrames]) expect(frame.scrollTop).toBe(before.scrollTop)
        expect(after.scrollTop).toBe(before.scrollTop)
        expect(after.topLine).toBe(before.topLine)
        expect(selectionState(after)).toEqual(selectionState(before))
        expect(diskState(filePath)).toEqual(disk)
      } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
    })
  }
}

test('different source tabs retain independent keyboard and multiple selections through repeated layouts', async() => {
  const { app, page, filePath } = await launchWithMarkdown(markdown, { preferences: { autoSave: false } })
  const disk = diskState(filePath)
  try {
    await layout(app, page, 'source')
    await source(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Shift+ArrowUp')
    await source(page).evaluate((host: SourceHost) => {
      const container = host.closest('.source-code')
      if (!container) throw new Error('Source scroll container is missing')
      container.scrollTop = 870
    })
    const a = await snapshot(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, markdown.replaceAll('numbered', 'second'))
    await expect(page.locator('.tabs-container li')).toHaveCount(2)
    await layout(app, page, 'source')
    await source(page).evaluate((host: SourceHost) => {
      const cm = host.CodeMirror
      cm.setSelections([
        { anchor: { line: 8, ch: 10, sticky: 'before' }, head: { line: 4, ch: 2, sticky: 'after' } },
        { anchor: { line: 15, ch: 5, sticky: 'after' }, head: { line: 15, ch: 2, sticky: 'before' } }
      ], 1, { scroll: false })
      const container = host.closest('.source-code')
      if (!container) throw new Error('Source scroll container is missing')
      container.scrollTop = 1490
    })
    const b = await snapshot(page)
    for (const destination of ['preview', 'wysiwyg', 'preview'] as const) {
      for (const [index, before] of [a, b].entries()) {
        await sendIpcToRenderer(app, 'mt::switch-tab-by-index', index)
        await expect.poll(async() => (await snapshot(page)).markdown).toBe(before.markdown)
        await layout(app, page, destination)
        await layout(app, page, 'source')
        const frames = await traceFrames(page)
        const after = await snapshot(page)
        await record(`tab-${index}-${destination}-${test.info().attachments.length}`, { before, frames, after })
        expect(selectionState(after)).toEqual(selectionState(before))
        expect(after.scrollTop).toBe(before.scrollTop)
        for (const frame of frames) expect(frame.scrollTop).toBe(before.scrollTop)
      }
    }
    expect(diskState(filePath)).toEqual(disk)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
})
