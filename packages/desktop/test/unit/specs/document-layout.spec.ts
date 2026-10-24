import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  Object.assign(window, {
    path: { dirname: (p: string) => p.slice(0, p.lastIndexOf('/')), basename: (p: string) => p.split('/').pop() },
    fileUtils: { isSamePathSync: (a: string, b: string) => a === b },
    electron: { ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn(async() => {}) } }
  })
})
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { createDocumentState } from '@/store/help'
import { registerDocumentView } from '@/services/documentMode'
import bus from '@/bus'
import { DOCUMENT_LAYOUTS, isAvailableDocumentLayout, resolveDocumentLayout } from '@shared/types/documentLayout'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  registerDocumentView(null)
  vi.useRealTimers()
})

const open = (readOnly = false) => {
  const store = useEditorStore()
  const tab = createDocumentState({ pathname: '/notes/a.md', markdown: 'original\n', readOnly })
  store.tabs = [tab]
  store.currentFile = tab
  store.updateTabIdToIndex()
  return { store, tab: store.currentFile }
}

describe('document layout and permission are independent', () => {
  it('defines four identities but does not activate deferred Split or invalid layouts', () => {
    expect(DOCUMENT_LAYOUTS).toEqual(['wysiwyg', 'source', 'split', 'preview'])
    const { store } = open()
    for (const value of ['split', 'unknown', null]) {
      expect(isAvailableDocumentLayout(value)).toBe(false)
      store.SET_DOCUMENT_LAYOUT(value)
      expect(store.documentLayout).toBe('wysiwyg')
    }
    expect(resolveDocumentLayout('split', true)).toBe('source')
  })

  it.each([false, true])('keeps permission %s across all implemented layouts', async(readOnly) => {
    const { store, tab } = open(readOnly)
    for (const layout of ['source', 'preview', 'wysiwyg']) {
      store.SET_DOCUMENT_LAYOUT(layout)
      expect(store.documentLayout).toBe(layout)
      expect(tab.readOnly).toBe(readOnly)
      expect(tab.markdown).toBe('original\n')
      expect(tab.isSaved).toBe(true)
    }
    store.SET_DOCUMENT_LAYOUT('preview')
    await store.SET_READ_ONLY(tab.id, !readOnly)
    expect(store.documentLayout).toBe('preview')
    expect(store.documentReadOnly).toBe(true)
  })

  it('flushes the outgoing editor before Preview blocks updates, retaining dirty text and history', () => {
    const { store, tab } = open()
    const history = { stack: [{ id: 3 }], index: 0, lastEditIndex: 0 }
    const flush = () => store.LISTEN_FOR_CONTENT_CHANGE({ id: tab.id, markdown: 'pending\n', history })
    bus.on('flush-active-editor', flush)
    try { store.SET_DOCUMENT_LAYOUT('preview') } finally { bus.off('flush-active-editor', flush) }
    expect(tab.markdown).toBe('pending\n')
    expect(tab.history).toEqual(history)
    expect(tab.isSaved).toBe(false)
    store.LISTEN_FOR_CONTENT_CHANGE({ id: tab.id, markdown: 'must not enter the model' })
    store.FILE_SAVE()
    store.FILE_SAVE_AS()
    expect(tab.markdown).toBe('pending\n')
    expect(vi.mocked(window.electron.ipcRenderer.send).mock.calls.some(([channel]) => channel.startsWith('mt::response-file-save'))).toBe(false)
  })

  it('suspends pending autosave in Preview without saving merely on return', async() => {
    const { store, tab } = open()
    usePreferencesStore().autoSave = true
    tab.isSaved = false
    store.HANDLE_AUTO_SAVE(tab)
    store.SET_DOCUMENT_LAYOUT('preview')
    await vi.advanceTimersByTimeAsync(4000)
    store.SET_DOCUMENT_LAYOUT('wysiwyg')
    await vi.advanceTimersByTimeAsync(4000)
    expect(tab.isSaved).toBe(false)
    expect(vi.mocked(window.electron.ipcRenderer.send).mock.calls.some(([channel]) => channel === 'mt::response-file-save')).toBe(false)
  })

  it.each([false, true])('restores per-tab layouts only when restoreLayoutState is %s', (restoreLayoutState) => {
    const { store, tab } = open()
    const preferences = usePreferencesStore()
    preferences.restoreLayoutState = restoreLayoutState
    preferences.sourceCode = true
    store.SET_DOCUMENT_LAYOUT('preview')
    const state = store.CREATE_BUFFERED_STATE()
    expect(state?.tabs[0].documentLayout).toBe('preview')
    store.RESTORE_BUFFERED_STATE(state)
    expect(store.documentLayout).toBe(restoreLayoutState ? 'preview' : 'source')
    expect(store.currentFile?.readOnly).toBe(tab.readOnly)
    expect(store.currentFile?.markdown).toBe(tab.markdown)
  })

  it('keeps layouts with their documents and preserves the configured source fallback for new tabs', () => {
    const { store, tab } = open()
    store.SET_DOCUMENT_LAYOUT('preview')
    const second = createDocumentState({ pathname: '/notes/b.md', markdown: 'second\n', documentLayout: 'source' })
    store.UPDATE_CURRENT_FILE(second)
    expect(store.isSourceLayout).toBe(true)
    store.UPDATE_CURRENT_FILE(tab)
    expect(store.isPreviewLayout).toBe(true)
    store.NEW_UNTITLED_TAB({})
    expect(store.documentLayout).toBe('wysiwyg')
    expect(store.currentFile?.readOnly).toBe(false)
  })
})
