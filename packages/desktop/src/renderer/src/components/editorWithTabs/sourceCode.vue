<template>
  <div
    ref="sourceCodeContainer"
    class="source-code"
    @scroll.passive="updateActiveHeadingFromScroll"
  />
</template>

<script setup lang="ts">
import {
  registerSourceView,
  captureSourceHistory,
  restoreSourceHistory
} from '../../services/documentMode'
import { computed, ref, shallowRef, markRaw, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import {
  findMarkdownHeadingLine,
  getMarkdownHeadingLines,
  scrollSourceEditorToLine
} from '@/util/sourceModeToc'
import { storeToRefs } from 'pinia'
import type CodeMirror from 'codemirror'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import { wordCount as getWordCount } from '@muyajs/core'
import { adjustCursor, isWindows } from '../../util'
import { getSourceExtraKeys } from '../../codeMirror/keybindings'
import bus from '../../bus'
import { oneDarkThemes, railscastsThemes } from '@/config'
import { SourceSearch } from '../../codeMirror/sourceSearch'
import { popupContextMenu } from '../../contextMenu/popupMenu'
import { t } from '../../i18n'

interface MuyaIndexCursorLike {
  anchor: CodeMirror.Position
  focus: CodeMirror.Position
}

const props = defineProps<{
  markdown?: string
  muyaIndexCursor?: unknown
  textDirection: string
}>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const sourceCodeContainer = ref<HTMLDivElement | null>(null)

const editor = shallowRef<CodeMirror.Editor | null>(null)
const viewDestroyed = ref(false)
const tabId = ref<string | null>(null)
let loadingContent = false
let committedMarkdown = ''
let sourceSearch: SourceSearch | null = null

const {
  theme,
  sourceCodeLineNumbers,
  texMathDollars,
  texMathGfm,
  texMathSingleBackslash,
  texMathDoubleBackslash
} = storeToRefs(preferencesStore)
const { currentFile: currentTab } = storeToRefs(editorStore)
const sourceCode = computed(() => editorStore.isSourceLayout)

const isLocked = () => !!editorStore.documentEditingBlocked

watch(
  () => [currentTab.value?.readOnly, currentTab.value?.modeChanging, currentTab.value?.documentLayout],
  () => editor.value?.setOption('readOnly', isLocked()),
  { flush: 'sync' }
)

const isValidMuyaIndexCursor = (cursor: unknown): cursor is MuyaIndexCursorLike => {
  const c = cursor as MuyaIndexCursorLike | null | undefined
  return !!(c && c.anchor && c.focus)
}

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      setTextDirection(editor.value, value)
    }
  }
)

watch(sourceCodeLineNumbers, (value) => {
  editor.value?.setOption('lineNumbers', value)
})

// A fresh instance reads these at mount; the watch is for a preference changed
// while the source view is already open (#5446).
const markdownMathMode = () => ({
  name: 'markdown-math',
  texMathDollars: texMathDollars.value,
  texMathGfm: texMathGfm.value,
  texMathSingleBackslash: texMathSingleBackslash.value,
  texMathDoubleBackslash: texMathDoubleBackslash.value
})

watch([texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash], () => {
  editor.value?.setOption('mode', markdownMathMode())
})

const getMarkdownAndCursor = (cm: CodeMirror.Editor) => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')

  const markdown: string = cm.getValue()
  const convertToMuyaCursor = (cursor: CodeMirror.Position) => {
    const line = cm.getLine(cursor.line)
    const preLine = cm.getLine(cursor.line - 1)
    const nextLine = cm.getLine(cursor.line + 1)
    return adjustCursor(
      cursor,
      preLine,
      line,
      nextLine,
      (lineNumber) => {
        return cm.getLine(lineNumber)
      },
      cm.lineCount()
    )
  }

  anchor = convertToMuyaCursor(anchor)
  focus = convertToMuyaCursor(focus)

  // Normalize cursor that `anchor` is always before `focus` because
  // this is the expected behavior in Muya.
  if (anchor && focus && anchor.line > focus.line) {
    const tmpCursor = focus
    focus = anchor
    anchor = tmpCursor
  }
  return { cursor: { focus, anchor }, markdown }
}

const prepareTabSwitch = () => {
  if (tabId.value && editor.value) {
    saveContent(editor.value)
    captureSourceHistory(
      tabId.value,
      editor.value,
      editorStore.tabs.find((tab) => tab.id === tabId.value)?.markdown
    )
    tabId.value = null
  }
}

interface FileChangePayloadLike {
  reason?: string
  id: string
  markdown?: string
  muyaIndexCursor?: unknown
}

const handleFileChange = (payload: unknown) => {
  const { id, markdown: newMarkdown, muyaIndexCursor, reason } = payload as FileChangePayloadLike
  if (reason === 'source-handoff') return
  if (!editor.value) return

  if (!editorStore.isSourceLayout) {
    prepareTabSwitch()
    return
  }

  // On same-tab reload (external file change), preserve scroll across
  // setValue. Snapshot every plausible scroll element (the outer
  // .source-code div, CodeMirror's own scroller, and the nearest scrollable
  // ancestor) and restore each, since which one is actually active depends
  // on CodeMirror's height:auto + outer overflow:auto interplay. Re-apply
  // on nextTick and the next animation frame to outlast layout side-effects
  // from sibling handlers: muya editor.vue also listens for file-changed.
  // A cross-tab switch must instead commit the outgoing tab's state; the
  // fresh markdown from disk would otherwise overwrite uncommitted edits.
  const isSameTabReload = tabId.value && tabId.value === id
  const scrollTargets: Array<{ el: HTMLElement; top: number }> = []
  if (isSameTabReload) {
    const seen = new Set<HTMLElement>()
    const consider = (el: HTMLElement | null | undefined) => {
      if (el && !seen.has(el)) {
        seen.add(el)
        scrollTargets.push({ el, top: el.scrollTop })
      }
    }
    consider(sourceCodeContainer.value)
    consider(editor.value.getScrollerElement?.() as HTMLElement | null | undefined)
    let node: HTMLElement | null = sourceCodeContainer.value?.parentElement ?? null
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        consider(node)
        break
      }
      node = node.parentElement
    }
  } else {
    prepareTabSwitch()
    tabId.value = id
  }

  loadingContent = true
  try {
    if (typeof newMarkdown === 'string' && editor.value.getValue() !== newMarkdown) {
      editor.value.setValue(newMarkdown)
    }
    if (!isSameTabReload) restoreSourceHistory(id, editor.value)
    committedMarkdown = editor.value.getValue()
  } finally {
    loadingContent = false
  }
  sourceSearch?.search('', { selectHighlight: false })

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor

    editor.value.setSelection(anchor, focus, { scroll: true })
  } else if (scrollTargets.length) {
    const restoreScroll = () => {
      for (const { el, top } of scrollTargets) el.scrollTop = top
    }
    restoreScroll()
    nextTick(restoreScroll)
    requestAnimationFrame(restoreScroll)
  } else {
    setCursorAtFirstLine(editor.value)
  }
}

const handleSelectAll = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.execCommand('selectAll')
  } else {
    const activeElement = document.activeElement as HTMLElement | null
    const nodeName = activeElement?.nodeName
    if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
      const selectable = activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (selectable && typeof selectable.select === 'function') {
        selectable.select()
      }
    }
  }
}

const handleUndo = () => {
  if (!sourceCode.value || isLocked()) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('undo')
  }
}

const handleRedo = () => {
  if (!sourceCode.value || isLocked()) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('redo')
  }
}

interface ImageActionPayload {
  id: string
  result: string
  alt: string
}

const handleImageAction = (payload: unknown) => {
  const cm = editor.value
  if (!cm || isLocked()) return

  const { id, result, alt } = payload as ImageActionPayload
  const value: string = cm.getValue()
  const focus = cm.getCursor('focus')
  const anchor = cm.getCursor('anchor')
  const lines: string[] = value.split('\n')
  const index = lines.findIndex((line: string) => line.indexOf(id) > 0)

  if (index > -1) {
    const oldLine = lines[index]
    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
    const newValue = lines.join('\n')
    cm.setValue(newValue)
    const match = /(!\[.*\]\(.*\))/.exec(oldLine)
    if (!match) {
      return
    }
    const range = {
      start: match.index,
      end: match.index + match[1].length
    }
    const delta = alt.length + result.length + 5 - match[1].length

    const adjustPointer = (pointer: CodeMirror.Position) => {
      if (!pointer) {
        return
      }
      if (pointer.line !== index) {
        return
      }
      if (pointer.ch <= range.start) {
        // do nothing.
      } else if (pointer.ch > range.start && pointer.ch < range.end) {
        pointer.ch = range.start + alt.length + result.length + 5
      } else {
        pointer.ch += delta
      }
    }

    adjustPointer(focus)
    adjustPointer(anchor)
    if (focus && anchor) {
      cm.setSelection(anchor, focus, { scroll: true })
    } else {
      setCursorAtFirstLine(cm)
    }
  }
}

// `cursorActivity` fires per drag step, so key the dedup on the ranges rather
// than on `getSelection()`, which copies the whole selection.
let lastSelectionKey = ''

const selectionKey = (cm: CodeMirror.Editor): string =>
  cm
    .listSelections()
    .map(({ anchor, head }) => `${anchor.line}:${anchor.ch}-${head.line}:${head.ch}`)
    .join(',')

const updateSelectionWordCount = (cm: CodeMirror.Editor) => {
  const key = selectionKey(cm)
  if (key === lastSelectionKey && editorStore.selectionWordCount != null) return
  lastSelectionKey = key

  const selectedText = cm.getSelection()
  const hasSelection = selectedText.trim().length > 0
  if (!hasSelection && editorStore.selectionWordCount == null) return

  editorStore.SET_SELECTION_WORD_COUNT(hasSelection ? getWordCount(selectedText) : null)
}

const saveContent = (cm: CodeMirror.Editor) => {
  if (loadingContent || cm.getValue() === committedMarkdown) return
  const tab = editorStore.tabs.find(tab => tab.id === tabId.value)
  if (!tab || tab.readOnly) return
  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(cm)
  const wordCount = getWordCount(newMarkdown)
  if (!viewDestroyed.value) {
    if (tabId.value) {
      editorStore.LISTEN_FOR_CONTENT_CHANGE({
        id: tabId.value,
        markdown: newMarkdown,
        wordCount,
        muyaIndexCursor: cursor
      })
      committedMarkdown = newMarkdown
    } else {
      // This may occur during tab switching but should not occur otherwise.
      console.warn('LISTEN_FOR_CONTENT_CHANGE: Cannot commit changes because not tab id was set!')
    }
  }
}

let headingMarkdown = ''
let headingLines: number[] = []

const setActiveHeadingAtLine = (line: number): void => {
  if (!editor.value) return
  const markdown = editor.value.getValue()
  if (markdown !== headingMarkdown) {
    headingMarkdown = markdown
    headingLines = getMarkdownHeadingLines(markdown)
  }
  let slug: string | null = null
  for (let index = 0; index < editorStore.listToc.length; index++) {
    const headingLine = headingLines[index] ?? -1
    if (headingLine < 0 || headingLine > line) break
    slug = editorStore.listToc[index].slug ?? null
  }
  editorStore.SET_ACTIVE_HEADING(slug)
}

const updateActiveHeadingFromScroll = (): void => {
  const container = sourceCodeContainer.value
  if (!container || !editor.value) return
  const tab = editorStore.tabs.find(tab => tab.id === tabId.value)
  if (tab) tab.sourceScrollTop = container.scrollTop
  const top = container.getBoundingClientRect().top + 80
  const line = editor.value.lineAtHeight(top, 'window')
  setActiveHeadingAtLine(line)
}

const listenChange = (cm: CodeMirror.Editor) => {
  cm.on('beforeChange', (_instance, change) => {
    if (!loadingContent && isLocked()) change.cancel()
  })
  cm.on('changes', (instance) => {
    saveContent(instance)
    if (!loadingContent) sourceSearch?.refresh()
  })
  cm.on('cursorActivity', (instance: CodeMirror.Editor) => {
    const tab = editorStore.tabs.find(tab => tab.id === tabId.value)
    if (tab && !loadingContent) tab.muyaIndexCursor = getMarkdownAndCursor(instance).cursor
    updateSelectionWordCount(instance)
    setActiveHeadingAtLine(instance.getCursor().line)
  })
}

const flushSource = () => {
  if (editor.value) saveContent(editor.value)
}
const focusSource = () => editor.value?.focus()
const copySource = () => {
  if (editor.value) window.electron.clipboard.writeText(editor.value.getSelection())
}
const pasteSource = async() => {
  if (isLocked()) return
  const id = tabId.value
  const value = await window.electron.clipboard.readText()
  if (!isLocked() && tabId.value === id) editor.value?.replaceSelection(value, 'around', '+input')
}
const searchSource = (payload: unknown) => {
  const { value, opt } = payload as { value: string; opt?: Parameters<SourceSearch['search']>[1] }
  sourceSearch?.search(value, opt)
}
const findSource = (action: unknown) => sourceSearch?.find(action as 'previous' | 'next')
const replaceSource = (payload: unknown) => {
  const { value, opt } = payload as { value: string; opt?: { isSingle?: boolean } }
  sourceSearch?.replace(value, opt?.isSingle)
}

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
const handleScrollToHeader = (slug: unknown) => {
  if (!editor.value) return
  const index = editorStore.listToc.findIndex((item) => item.slug === slug)
  if (index < 0) return
  const line = findMarkdownHeadingLine(editor.value.getValue(), index)
  if (line < 0) return
  // `.source-code` is the scroll container (CodeMirror renders full-height with
  // viewportMargin: Infinity, so its own scroller never scrolls).
  scrollSourceEditorToLine(editor.value, line, sourceCodeContainer.value)
}

onMounted(() => {
  if (!currentTab.value) return
  const { id } = currentTab.value
  // Reset WYSIWYG scroll, block and cursor state; source mode uses different coordinates.
  currentTab.value.scrollTop = 0
  currentTab.value.blocks = undefined
  currentTab.value.cursor = undefined

  const { markdown, muyaIndexCursor, textDirection } = props
  const container = sourceCodeContainer.value
  const codeMirrorConfig: Record<string, unknown> = {
    value: markdown,
    lineNumbers: sourceCodeLineNumbers.value,
    autofocus: true,
    lineWrapping: true,
    styleActiveLine: true,
    extraKeys: getSourceExtraKeys(isWindows),
    direction: textDirection,
    viewportMargin: Infinity,
    readOnly: isLocked()
  }

  if (railscastsThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  bus.on('file-loaded', handleFileChange)
  bus.on('file-changed', handleFileChange)
  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('image-action', handleImageAction)
  bus.on('scroll-to-header', handleScrollToHeader)
  bus.on('flush-active-editor', flushSource)
  bus.on('editor-focus', focusSource)
  bus.on('searchValue', searchSource)
  bus.on('find-action', findSource)
  bus.on('replaceValue', replaceSource)
  bus.on('copyAsRich', copySource)
  bus.on('copyAsHtml', copySource)
  bus.on('pasteAsPlainText', pasteSource)

  // CodeMirror's line tree relies on object identity and must not be proxied by Vue.
  const codeMirrorInstance = markRaw(codeMirror(container, codeMirrorConfig))

  codeMirrorInstance.setOption('mode', markdownMathMode())

  codeMirrorInstance.on('contextmenu', (_cm: CodeMirror.Editor, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    popupContextMenu([
      { label: t('menu.edit.copy'), enabled: !!codeMirrorInstance.getSelection(), click: copySource },
      { label: t('menu.edit.selectAll'), click: handleSelectAll }
    ], { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY })
  })

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor
    codeMirrorInstance.setSelection(anchor, focus, { scroll: true })
  } else {
    setCursorAtFirstLine(codeMirrorInstance)
  }

  restoreSourceHistory(id, codeMirrorInstance)
  editor.value = codeMirrorInstance
  tabId.value = id
  committedMarkdown = codeMirrorInstance.getValue()
  sourceSearch = new SourceSearch(
    codeMirrorInstance,
    result => editorStore.SEARCH(result),
    line => scrollSourceEditorToLine(codeMirrorInstance, line, sourceCodeContainer.value),
    isLocked
  )
  updateSelectionWordCount(codeMirrorInstance)

  listenChange(codeMirrorInstance)
  registerSourceView(value => codeMirrorInstance.setOption('readOnly', value))
  if (currentTab.value.sourceScrollTop) {
    const top = currentTab.value.sourceScrollTop
    nextTick(() => { if (container) container.scrollTop = top })
  }
})

onBeforeUnmount(() => {
  registerSourceView(null)
  if (editor.value) {
    saveContent(editor.value)
    captureSourceHistory(
      tabId.value,
      editor.value,
      editorStore.tabs.find((tab) => tab.id === tabId.value)?.markdown
    )
  }
  viewDestroyed.value = true

  bus.off('file-loaded', handleFileChange)
  bus.off('file-changed', handleFileChange)
  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('image-action', handleImageAction)
  editorStore.SET_SELECTION_WORD_COUNT(null)
  lastSelectionKey = ''
  bus.off('scroll-to-header', handleScrollToHeader)
  bus.off('flush-active-editor', flushSource)
  bus.off('editor-focus', focusSource)
  bus.off('searchValue', searchSource)
  bus.off('find-action', findSource)
  bus.off('replaceValue', replaceSource)
  bus.off('copyAsRich', copySource)
  bus.off('copyAsHtml', copySource)
  bus.off('pasteAsPlainText', pasteSource)
  sourceSearch?.clear()

  if (editor.value && tabId.value === currentTab.value?.id) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    bus.emit('file-changed', {
      reason: 'source-handoff',
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor,
      renderCursor: true
    })
  }
})
</script>

<style>
.source-code {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
}
.source-code .CodeMirror {
  height: auto;
  margin: 50px auto;
  max-width: var(--editorAreaWidth);
  background: transparent;
}
.source-code .CodeMirror-gutters {
  border-right: none;
  background-color: transparent;
}
.source-search-match {
  background: var(--highlightColor);
}
.source-search-active {
  background: var(--highlightColor);
  outline: 1px solid var(--themeColor);
}
.source-code .CodeMirror-activeline-background,
.source-code .CodeMirror-activeline-gutter {
  background: var(--floatHoverColor);
}
/* Fade the delimiters against the formula. Dimming the inherited colour rather
   than naming one is what carries across every theme; 0.65 is the lowest value
   still clearing 3:1 in all of them, with one-dark at 3.67 setting the floor. */
.source-code .CodeMirror .cm-formatting-math {
  opacity: 0.65;
}
</style>
