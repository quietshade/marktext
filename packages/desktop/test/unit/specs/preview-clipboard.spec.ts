import { afterEach, describe, expect, it } from 'vitest'
import {
  installPreviewClipboard,
  previewSelectionHtml
} from '../../../src/renderer/src/util/previewClipboard'

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

const fixture = (html: string) => {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe('Preview rich clipboard selection', () => {
  it('preserves partial inline formatting without serializing Markdown offsets', () => {
    const root = fixture(
      '<p><span class="mu-remove">**</span><strong>Bold text</strong><span class="mu-remove">**</span></p>'
    )
    const range = document.createRange()
    const text = root.querySelector('strong')?.firstChild
    if (!text) throw new Error('Bold fixture has no text')
    range.setStart(text, 2)
    range.setEnd(text, 6)
    expect(previewSelectionHtml(root, range)).toBe('<p><strong>ld t</strong></p>')
  })

  it('removes editing artifacts and unsafe HTML, retaining useful semantics and link targets', () => {
    const root = fixture(
      '<h1 id="editor" contenteditable="true"><span class="mu-remove"># </span>Title</h1><p><span class="mu-link" href="https://example.com" data-raw="[Link](url)">Link</span><span class="mu-hide">hidden</span><button>Edit</button><img src="image.png" onerror="alert(1)"><a href="javascript:alert(1)">Unsafe</a></p><script>alert(1)</script><pre><code>a\n  b</code></pre>'
    )
    const before = root.innerHTML
    const range = document.createRange()
    range.selectNodeContents(root)
    const html = previewSelectionHtml(root, range)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<a href="https://example.com">Link</a>')
    expect(html).toContain('<pre><code>a\n  b</code></pre>')
    expect(html).not.toMatch(/mu-|hidden|button|script|javascript|onerror|contenteditable|data-raw/)
    expect(root.innerHTML).toBe(before)
  })

  it('leaves non-Preview copies and selections outside the viewer to their owner', () => {
    const root = fixture('<p>Viewer</p>')
    let preview = false
    const clipboard = installPreviewClipboard(root, () => preview)
    try {
      const range = document.createRange()
      range.selectNodeContents(root)
      document.getSelection()?.addRange(range)
      const ordinary = new Event('copy', { bubbles: true, cancelable: true })
      root.dispatchEvent(ordinary)
      expect(ordinary.defaultPrevented).toBe(false)
      preview = true
      const outside = document.createElement('p')
      outside.textContent = 'Another panel'
      document.body.append(outside)
      range.selectNodeContents(outside)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
      const outsideCopy = new Event('copy', { bubbles: true, cancelable: true })
      outside.dispatchEvent(outsideCopy)
      expect(outsideCopy.defaultPrevented).toBe(false)
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()
      const searchCopy = new Event('copy', { bubbles: true, cancelable: true })
      input.dispatchEvent(searchCopy)
      expect(searchCopy.defaultPrevented).toBe(false)
    } finally {
      clipboard.dispose()
    }
  })
})
