(() => {
  const window = globalThis
  const { document, crypto, performance, MutationObserver, TextEncoder, getComputedStyle, requestAnimationFrame } = window
  if (window.marktextSourceTrace) throw new Error('Stop the existing trace and reload before reinstalling it.')
  if (!crypto?.subtle) throw new Error('The diagnostic requires the browser SHA-256 API.')
  const CodeMirror = window.CodeMirror
  if (!CodeMirror?.prototype) throw new Error('Open Markdown Source before installing this diagnostic.')
  const fixture = ['# Source state test', '', ...Array.from({ length: 180 }, (_, i) => `Line ${String(i + 1).padStart(3, '0')}: Alpha Bravo Charlie Delta Echo Foxtrot`)].join('\n')
  const current = () => document.querySelector('.source-code .CodeMirror')?.CodeMirror
  if (current()?.getValue() !== fixture) throw new Error('This diagnostic accepts only the exact disposable Source state fixture.')

  let active = true
  let sequence = 0
  let nextInstance = 0
  let ignored = 0
  let diagnosticErrors = 0
  let last = current()
  const instances = new WeakMap()
  const events = []
  const pending = new Set()
  const restores = []
  const attached = new WeakSet()
  const initialStyle = getComputedStyle(current().getWrapperElement())
  const environment = { font: { family: initialStyle.fontFamily, size: initialStyle.fontSize, lineHeight: initialStyle.lineHeight } }
  const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), value => value.toString(16).padStart(2, '0')).join('')

  const captureState = (event, cm = current() ?? last, inputEvent) => {
    if (!active || events.length >= 2000) return
    if (!cm || cm.getValue() !== fixture) {
      ignored++
      return
    }
    if (!instances.has(cm)) instances.set(cm, ++nextInstance)
    last = cm
    const selected = cm.getSelection()
    const host = cm.getWrapperElement()
    const textarea = cm.getInputField()
    const record = {
      sequence: ++sequence,
      time: performance.now(),
      event,
      instance: instances.get(cm),
      layout: document.querySelector('.editor-with-tabs')?.getAttribute('data-document-layout'),
      connected: host.isConnected,
      ranges: cm.listSelections().map(range => ({ ...range, anchor: { ...range.anchor }, head: { ...range.head } })),
      anchor: { ...cm.getCursor('anchor') },
      head: { ...cm.getCursor('head') },
      primary: { ...cm.getCursor() },
      hasFocus: cm.hasFocus(),
      documentHasFocus: document.hasFocus(),
      activeElement: document.activeElement === textarea ? 'source-input' : document.activeElement?.tagName,
      inputSelection: [textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection],
      scrollTop: host.closest('.source-code')?.scrollTop,
      selectedLength: selected.length,
      selectedLF: (selected.match(/\n/g) ?? []).length,
      selectedCR: (selected.match(/\r/g) ?? []).length,
      sourceLength: fixture.length,
      sourceEndsWithNewline: cm.getValue().endsWith('\n'),
      readOnly: cm.getOption('readOnly'),
      lineWrapping: cm.getOption('lineWrapping'),
      searchVisible: !!document.querySelector('.search-bar')?.offsetParent,
      viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      modifiers: inputEvent ? { shift: !!inputEvent.shiftKey, ctrl: !!inputEvent.ctrlKey, alt: !!inputEvent.altKey, meta: !!inputEvent.metaKey } : undefined,
      selectedSHA256: null
    }
    events.push(record)
    const work = digest(selected).then(value => { record.selectedSHA256 = value }, error => { record.digestError = error.name })
    pending.add(work)
    work.finally(() => pending.delete(work))
  }
  const capture = (...args) => {
    try {
      captureState(...args)
    } catch (error) {
      diagnosticErrors++
      events.push({ sequence: ++sequence, event: 'diagnostic-error', name: error.name })
    }
  }

  // Observe public operations without changing their arguments, return values or selection state.
  for (const method of ['setSelections', 'setSelection', 'setCursor', 'setValue', 'focus', 'setHistory', 'getHistory', 'clearHistory']) {
    const original = CodeMirror.prototype[method]
    const wrapper = function (...args) {
      capture(`${method}:before`, this)
      try {
        return Reflect.apply(original, this, args)
      } finally {
        capture(`${method}:after`, this)
      }
    }
    CodeMirror.prototype[method] = wrapper
    restores.push(() => { if (CodeMirror.prototype[method] === wrapper) CodeMirror.prototype[method] = original })
  }

  const attach = cm => {
    if (!cm || attached.has(cm) || cm.getValue() !== fixture) return
    attached.add(cm)
    for (const name of ['cursorActivity', 'focus', 'blur', 'changes']) {
      const listener = () => capture(`codemirror:${name}`, cm)
      cm.on(name, listener)
      restores.push(() => cm.off(name, listener))
    }
  }
  attach(current())
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') capture('layout-attribute')
      for (const node of record.removedNodes) {
        const cm = node.CodeMirror ?? node.querySelector?.('.CodeMirror')?.CodeMirror
        if (cm) capture('source-removed', cm)
      }
      for (const node of record.addedNodes) {
        const cm = node.CodeMirror ?? node.querySelector?.('.CodeMirror')?.CodeMirror
        if (cm) {
          attach(cm)
          capture('source-added', cm)
        }
      }
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-document-layout'] })
  restores.push(() => observer.disconnect())

  const navigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Shift', 'Control', 'Alt', 'Escape', 'Tab', 'F10', 'F12', 'c', 'C'])
  for (const name of ['keydown', 'keyup', 'mousedown', 'mouseup', 'focusin', 'focusout', 'copy', 'selectionchange']) {
    const listener = event => {
      const key = 'key' in event ? `:${navigationKeys.has(event.key) ? event.key : '[other]'}` : ''
      capture(`dom:${name}${key}`, undefined, event)
      requestAnimationFrame(() => capture(`frame-after:${name}${key}`))
    }
    document.addEventListener(name, listener, true)
    restores.push(() => document.removeEventListener(name, listener, true))
  }
  for (const name of ['focus', 'blur']) {
    const listener = () => capture(`window:${name}`)
    window.addEventListener(name, listener)
    restores.push(() => window.removeEventListener(name, listener))
  }

  window.marktextSourceTrace = {
    mark: name => capture(`mark:${name}`),
    export: async () => {
      await Promise.all([...pending])
      return { version: 1, fixture: 'source-state-180', environment, diagnosticErrors, ignoredNonFixtureEvents: ignored, truncated: events.length >= 2000, events: structuredClone(events) }
    },
    stop: async () => {
      capture('stop')
      active = false
      for (const restore of restores.reverse()) restore()
      return window.marktextSourceTrace.export()
    }
  }
  capture('installed')
  return 'Source selection trace installed for the exact disposable fixture only.'
})()
