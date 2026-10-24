import { sanitize } from './dompurify'

const editorOnly = [
  '.mu-remove',
  '.mu-hide:not(.mu-math, .mu-ruby, .mu-emoji-marked-text, .mu-html-escape)',
  '.mu-math-text',
  '.mu-ruby-text',
  '.katex-mathml',
  '.mu-line-numbers-rows',
  'button',
  'input',
  '.mu-language-input'
].join(', ')

// Clone the native range, including its enclosing inline formatting. Engine
// offsets describe Markdown and cannot represent a rendered partial selection.
export const previewSelectionHtml = (root: HTMLElement, range: Range): string => {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return ''
  let fragment: Node = range.cloneContents()
  let ancestor = range.commonAncestorContainer
  if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode ?? root
  while (ancestor !== root) {
    const wrapper = ancestor.cloneNode(false)
    wrapper.appendChild(fragment)
    fragment = wrapper
    ancestor = ancestor.parentNode ?? root
  }
  const container = document.createElement('div')
  container.appendChild(fragment)
  container.querySelectorAll(editorOnly).forEach((el) => el.remove())
  container.querySelectorAll<HTMLElement>('[data-emoji], [data-character]').forEach((el) => {
    el.textContent = el.dataset.emoji ?? el.dataset.character ?? el.textContent
  })
  container.querySelectorAll('span.mu-link[href]').forEach((el) => {
    const link = document.createElement('a')
    link.setAttribute('href', el.getAttribute('href') ?? '')
    link.append(...el.childNodes)
    el.replaceWith(link)
  })
  container.querySelectorAll('span').forEach((el) => el.replaceWith(...el.childNodes))
  return sanitize(container.innerHTML, {
    ALLOWED_TAGS: [
      'div',
      'span',
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'del',
      's',
      'mark',
      'sub',
      'sup',
      'a',
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'blockquote',
      'ul',
      'ol',
      'li',
      'pre',
      'code',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
      'ruby',
      'rt',
      'rp'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start'],
    ALLOW_DATA_ATTR: false,
    RETURN_TRUSTED_TYPE: false
  })
}

export const installPreviewClipboard = (root: HTMLElement, isPreview: () => boolean) => {
  let htmlSource = false
  const copy = (event: ClipboardEvent) => {
    if (
      !isPreview() ||
      document.activeElement?.matches('input, textarea, [contenteditable="true"]')
    )
      return
    const selection = document.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    // Chromium's rendered selection excludes display:none markers and supplies
    // native block/cell separators, independently of selection direction.
    const text = selection.toString()
    const html = previewSelectionHtml(root, range)
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.clipboardData || !text) return
    event.clipboardData.setData('text/plain', htmlSource ? html : text)
    event.clipboardData.setData('text/html', htmlSource ? '' : html)
  }
  document.addEventListener('copy', copy, true)
  return {
    copyHtml: () => {
      htmlSource = true
      try {
        document.execCommand('copy')
      } finally {
        htmlSource = false
      }
    },
    dispose: () => document.removeEventListener('copy', copy, true)
  }
}
