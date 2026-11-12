import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clickMenuById, launchElectron, openProjectFolder, sendIpcToRenderer } from './helpers'

const names = ['alpha', 'beta', 'gamma']
interface GeometrySample {
  rowTop: number
  treeTop: number
  scrollTop: number
  target: string
}
type Position = 'top' | 'middle' | 'bottom'
interface Scenario {
  title: string
  existingDocument: boolean
  names: string[]
  position?: Position
  openedFiles?: boolean
  autoReveal?: boolean
  extraDocuments?: number
}
const scenarios: Scenario[] = [
  { title: 'three files from blank', existingDocument: false, names },
  { title: 'three files with existing document', existingDocument: true, names },
  { title: 'crossing the opened-files resize-handle threshold', existingDocument: true, names, extraDocuments: 3 },
  ...names.map(name => ({ title: `first ${name}`, existingDocument: true, names: [name] })),
  ...(['top', 'middle', 'bottom'] as const).flatMap(position => names.map(name => ({
    title: `first ${name} scrolled ${position}`, existingDocument: true, names: [name], position
  }))),
  { title: 'control auto-reveal off', existingDocument: true, names: ['alpha'], autoReveal: false },
  { title: 'control opened-files off', existingDocument: true, names: ['alpha'], openedFiles: false }
]

for (const scenario of scenarios) {
  test(`fixed-coordinate double-click: ${scenario.title}`, async() => {
    const testInfo = test.info()
    const directory = mkdtempSync(join(tmpdir(), 'mt-sidebar-pointer-'))
    const root = join(directory, 'FolderA')
    mkdirSync(root)
    const files = names.map(name => join(root, `${name}.md`))
    for (const file of files) writeFileSync(file, `# ${file}\n`)
    if (scenario.position) {
      for (let i = 0; i < 30; i++) {
        for (const prefix of ['00', 'zz']) writeFileSync(join(root, `${prefix}-${String(i).padStart(2, '0')}.md`), '# Filler\n')
      }
    }
    const existing = join(directory, 'existing.md')
    writeFileSync(existing, '# Existing\n')
    const extra = Array.from({ length: scenario.extraDocuments ?? 0 }, (_, index) => join(directory, `existing-${index}.md`))
    for (const file of extra) writeFileSync(file, '# Existing extra\n')
    const snapshot = () => files.map(file => ({ bytes: readFileSync(file).toString('hex'), mtime: statSync(file).mtimeMs }))
    const before = snapshot()
    const { app, page } = await launchElectron(scenario.existingDocument ? [existing, ...extra] : [], {
      preferences: { language: 'en', fileSortBy: 'title', fileSortOrder: 'asc', sideBarVisibility: true, tabBarVisibility: true, openedFilesInSidebar: scenario.openedFiles ?? true, openFilesInPreviewMode: true, autoRevealInSidebar: scenario.autoReveal ?? true, defaultOpenMode: 'read' }
    })
    const observations: unknown[] = []
    try {
      await openProjectFolder(app, page, root, files[0])
      await expect(page.locator('.tree-wrapper .side-bar-file')).toHaveCount(scenario.position ? 63 : 3)
      await expect(page.locator('.tabs-container > li')).toHaveCount(1 + extra.length)
      for (const name of scenario.names) {
        const file = join(root, `${name}.md`)
        const row = page.locator('.tree-wrapper .side-bar-file').and(page.getByTitle(file, { exact: true }))
        if (scenario.position) {
          await row.evaluate((row, position) => {
            const tree = row.closest('.tree-wrapper') as HTMLElement
            const offset = position === 'top' ? 40 : position === 'middle' ? tree.clientHeight / 2 : tree.clientHeight - 40
            tree.scrollTop += row.getBoundingClientRect().top - tree.getBoundingClientRect().top - offset
          }, scenario.position)
        }
        const rect = await row.boundingBox()
        if (!rect) throw new Error(`Missing row ${file}`)
        const point = { x: rect.x + 60, y: rect.y + rect.height / 2 }
        await page.evaluate(({ file, point }) => {
          const samples: unknown[] = []
          const clicks: unknown[] = []
          const sample = () => {
            const tree = document.querySelector('.tree-wrapper') as HTMLElement
            const row = Array.from(tree.querySelectorAll('.side-bar-file')).find(row => row.getAttribute('title') === file)
            const opened = document.querySelector('.opened-files-list') as HTMLElement | null
            return {
              time: performance.now(), rowTop: row?.getBoundingClientRect().top,
              treeTop: tree.getBoundingClientRect().top, treeHeight: tree.clientHeight, scrollTop: tree.scrollTop,
              openedHeight: opened?.clientHeight ?? 0, openedScrollTop: opened?.scrollTop ?? 0,
              rows: Array.from(tree.querySelectorAll('.side-bar-file')).filter(row => /(?:alpha|beta|gamma)\.md$/.test(row.getAttribute('title') ?? '')).map(row => ({ title: row.getAttribute('title'), top: row.getBoundingClientRect().top })),
              target: document.elementFromPoint(point.x, point.y)?.closest('[title]')?.getAttribute('title')
            }
          }
          const click = (event: MouseEvent) => {
            clicks.push({ detail: event.detail, target: (event.target as Element).closest('[title]')?.getAttribute('title'), time: event.timeStamp, trusted: event.isTrusted })
          }
          document.addEventListener('click', click, true)
          Object.assign(window, { pointerObservation: { samples, clicks, sample, stop: () => document.removeEventListener('click', click, true) } })
          samples.push(sample())
        }, { file, point })
        await page.mouse.click(point.x, point.y)
        // Model an inter-click interval, not a wait for the application to settle.
        await page.evaluate(() => new Promise<void>(resolve => {
          const state = (window as unknown as { pointerObservation: { samples: unknown[]; sample: () => unknown } }).pointerObservation
          const start = performance.now()
          const frame = () => {
            state.samples.push(state.sample())
            if (performance.now() - start >= 120) resolve()
            else requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        }))
        await page.mouse.down({ clickCount: 2 })
        await page.mouse.up({ clickCount: 2 })
        const observed = await page.evaluate(() => {
          const state = (window as unknown as { pointerObservation: { samples: GeometrySample[]; clicks: Array<{ target: string; detail: number; time: number; trusted: boolean }>; stop: () => void } }).pointerObservation
          state.stop()
          return { samples: state.samples, clicks: state.clicks }
        })
        observations.push({ file, point, ...observed })
        expect(observed.clicks.map(click => click.target)).toEqual([file, file])
        expect(observed.clicks.map(click => click.detail)).toEqual([1, 2])
        expect(observed.clicks.every(click => click.trusted)).toBe(true)
        expect(observed.clicks[1].time - observed.clicks[0].time).toBeLessThan(500)
        const first = observed.samples[0]
        expect(observed.samples.every(sample => Math.abs(sample.rowTop - first.rowTop) < 1)).toBe(true)
        expect(observed.samples.every(sample => sample.scrollTop === first.scrollTop && sample.treeTop === first.treeTop)).toBe(true)
        await expect(page.locator('.tabs-container > li').and(page.getByTitle(file, { exact: true }))).not.toHaveClass(/preview/)
        if (scenario.autoReveal !== false) await expect(row).toBeInViewport({ ratio: 1 })
      }
      await expect(page.locator('.tabs-container > li')).toHaveCount(scenario.names.length + (scenario.existingDocument ? 1 + extra.length : 0))
      expect(snapshot()).toEqual(before)
    } finally {
      const artifact = testInfo.outputPath('pointer-observations.json')
      writeFileSync(artifact, JSON.stringify(observations, null, 2))
      await testInfo.attach('pointer-observations', { path: artifact, contentType: 'application/json' })
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const release of ['pointer leave', 'wheel', 'keyboard', 'window resize', 'sidebar hide', 'preference change']) {
  test(`single-click preview stays stable and releases allocation on ${release}`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'mt-sidebar-single-pointer-'))
    const root = join(directory, 'FolderA')
    mkdirSync(root)
    const existing = join(directory, 'existing.md')
    const alpha = join(root, 'alpha.md')
    const beta = join(root, 'beta.md')
    for (const file of [existing, alpha, beta]) writeFileSync(file, '# Untouched\n')
    const snapshot = () => [existing, alpha, beta].map(file => ({ bytes: readFileSync(file).toString('hex'), mtime: statSync(file).mtimeMs }))
    const before = snapshot()
    const { app, page } = await launchElectron([existing], {
      preferences: { sideBarVisibility: true, tabBarVisibility: true, openedFilesInSidebar: true, openFilesInPreviewMode: true, autoRevealInSidebar: true, defaultOpenMode: 'read' }
    })
    try {
      await openProjectFolder(app, page, root, alpha)
      const section = page.locator('.opened-files')
      const height = () => section.evaluate(element => element.getBoundingClientRect().height)
      const originalHeight = await height()
      const savedHeight = await page.evaluate(() => localStorage.getItem('side-bar-opened-files-height'))
      const row = page.locator('.tree-wrapper .side-bar-file').and(page.getByTitle(alpha, { exact: true }))
      const box = await row.boundingBox()
      if (!box) throw new Error('Missing alpha')
      await page.mouse.click(box.x + 60, box.y + box.height / 2)
      const tab = page.locator('.tabs-container > li').and(page.getByTitle(alpha, { exact: true }))
      await expect(tab).toHaveClass(/preview/)
      expect((await row.boundingBox())?.y).toBe(box.y)
      expect(await height()).toBe(originalHeight)
      if (release === 'pointer leave') {
        const editor = await page.locator('.editor-with-tabs').boundingBox()
        if (!editor) throw new Error('Missing editor')
        await page.mouse.move(editor.x + 80, editor.y + 80)
      } else if (release === 'wheel') await page.mouse.wheel(0, 80)
      else if (release === 'keyboard') await page.keyboard.press('ArrowDown')
      else if (release === 'window resize') {
        await app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          const [width, height] = win.getContentSize()
          win.setContentSize(width, height + 24)
        })
      } else if (release === 'sidebar hide') {
        await clickMenuById(app, 'sideBarMenuItem')
        await expect(page.locator('.side-bar')).toBeHidden()
        await clickMenuById(app, 'sideBarMenuItem')
      } else {
        await sendIpcToRenderer(app, 'mt::user-preference', { openedFilesInSidebar: false })
        await expect(section).toHaveCount(0)
        await sendIpcToRenderer(app, 'mt::user-preference', { openedFilesInSidebar: true })
      }
      await expect.poll(height).toBeGreaterThan(originalHeight)
      await expect(tab).toHaveClass(/preview/)
      expect(await page.evaluate(() => localStorage.getItem('side-bar-opened-files-height'))).toBe(savedHeight)
      await page.locator('.tree-wrapper .side-bar-file').and(page.getByTitle(beta, { exact: true })).click()
      await expect(page.locator('.tabs-container > li').and(page.getByTitle(beta, { exact: true }))).toHaveClass(/preview/)
      await expect(tab).toHaveCount(0)
      await expect(page.locator('.tabs-container > li')).toHaveCount(2)
      expect(snapshot()).toEqual(before)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
