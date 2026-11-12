import { expect, test } from '@playwright/test'
import type CodeMirror from 'codemirror'
import { readFileSync, statSync } from 'node:fs'
import { clickMenuById, expectNoRendererErrors, launchWithMarkdown, toggleReadingMode } from './helpers'

const markdown = [
  '# Diagram lifecycle fixture', '',
  '```mermaid', 'flowchart LR', 'A[Start] --> B[Finish]', '```', '',
  '```flowchart', 'st=>start: Start', 'e=>end: Finish', 'st->e', '```', '',
  '```sequence', 'Alice->Bob: Hello', '```', '',
  '```vega-lite',
  '{"data":{"values":[{"category":"A","amount":2},{"category":"B","amount":3}]},"mark":"bar","encoding":{"x":{"field":"category","type":"nominal"},"y":{"field":"amount","type":"quantitative"}}}',
  '```', ''
].join('\n')

for (const readOnly of [false, true]) {
  test(`native diagrams survive layout disposal and recreation in ${readOnly ? 'Reading' : 'Edit'} Mode`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(markdown, {
      preferences: { autoSave: false, defaultOpenMode: 'edit' },
      suppressErrorDialog: true
    })
    const bytes = readFileSync(filePath)
    const modified = statSync(filePath).mtimeMs
    try {
      if (readOnly) await toggleReadingMode(page)
      for (const layout of ['wysiwyg', 'preview', 'source', 'preview', 'wysiwyg']) {
        await clickMenuById(app, `documentLayout-${layout}`)
        await expect(page.locator('.editor-with-tabs')).toHaveAttribute('data-document-layout', layout)
        if (layout === 'source') {
          expect(await page.locator('.CodeMirror').evaluate((host: HTMLElement & { CodeMirror: CodeMirror.Editor }) => host.CodeMirror.getValue())).toBe(markdown)
        } else {
          const previews = page.locator('.editor-component .mu-diagram-preview')
          await expect(previews).toHaveCount(4)
          for (let index = 0; index < 4; index++) {
            await expect(previews.nth(index)).toHaveAttribute('role', 'img')
            await expect(previews.nth(index).locator('svg').first()).toBeAttached()
            const fits = await previews.nth(index).evaluate(root => {
              const svg = root.querySelector('svg')
              if (!svg) throw new Error('Rendered diagram SVG is missing')
              return svg.getBoundingClientRect().width <= root.getBoundingClientRect().width + 1
            })
            expect(fits).toBe(true)
          }
          await expect(page.locator('.mu-editor')).toHaveAttribute('contenteditable', readOnly || layout === 'preview' ? 'false' : 'true')
        }
        await expect(page.locator('.document-mode [role=status]')).toHaveText(readOnly ? 'Reading Mode' : 'Edit Mode')
      }
      expect(readFileSync(filePath)).toEqual(bytes)
      expect(statSync(filePath).mtimeMs).toBe(modified)
      await expectNoRendererErrors(app)
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    }
  })
}
