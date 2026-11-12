import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  Object.assign(window, {
    path: {
      sep: '/',
      dirname: (p: string) => p.substring(0, p.lastIndexOf('/')),
      basename: (p: string) => p.split('/').pop()
    },
    fileUtils: { isSamePathSync: (a: string, b: string) => a === b },
    electron: {
      clipboard: { writeText: vi.fn() },
      ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn(async() => {}) }
    }
  })
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { createDocumentState } from '@/store/help'
import { registerDocumentView } from '@/services/documentMode'
import notice from '@/services/notification'
import bus from '@/bus'
import { isReadingCommandAllowed } from 'common/commands/readingMode'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  registerDocumentView(null)
  vi.useRealTimers()
})

describe('per-tab reading state', () => {
  it('retains dirty content and cancels a scheduled auto save before locking', async() => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSave = true
    const tab = createDocumentState({
      pathname: '/notes/a.md',
      markdown: 'retained',
      isSaved: false
    })
    store.tabs = [tab]
    store.currentFile = tab
    store.updateTabIdToIndex()
    store.HANDLE_AUTO_SAVE(tab)
    await store.SET_READ_ONLY(tab.id, true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(tab.readOnly).toBe(true)
    expect(tab.markdown).toBe('retained')
    expect(tab.isSaved).toBe(false)
    expect(
      vi
        .mocked(window.electron.ipcRenderer.send)
        .mock.calls.some(([channel]) => channel === 'mt::response-file-save')
    ).toBe(false)
    store.FILE_SAVE()
    store.FILE_SAVE_AS()
    store.LISTEN_FOR_CONTENT_CHANGE({ id: tab.id, markdown: 'late async change' })
    expect(tab.markdown).toBe('retained')
  })

  it('resolves defaults for existing files but preserves explicit mode and editable new documents', () => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.defaultOpenMode = 'read'
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { pathname: '/notes/a.md', filename: 'a.md', markdown: 'a' }
    })
    expect(store.currentFile?.readOnly).toBe(true)
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { pathname: '/notes/a.md', filename: 'a.md', markdown: 'different' },
      options: { readOnly: false }
    })
    expect(store.currentFile?.readOnly).toBe(true)
    expect(store.currentFile?.markdown).toBe('a')
    store.NEW_UNTITLED_TAB({})
    expect(store.currentFile?.readOnly).toBe(false)
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { pathname: '/notes/b.md', filename: 'b.md', markdown: 'b' },
      options: { readOnly: false }
    })
    expect(store.currentFile?.readOnly).toBe(false)
  })

  it('flushes pending edits before locking and never schedules a save merely by unlocking', async() => {
    const store = useEditorStore()
    usePreferencesStore().autoSave = true
    const tab = createDocumentState({ pathname: '/notes/a.md', markdown: 'before', isSaved: true })
    store.tabs = [tab]
    store.currentFile = tab
    store.updateTabIdToIndex()
    const flush = () => store.LISTEN_FOR_CONTENT_CHANGE({ id: tab.id, markdown: 'pending' })
    bus.on('flush-active-editor', flush)
    try {
      await store.SET_READ_ONLY(tab.id, true)
      expect(tab.markdown).toBe('pending')
      expect(tab.isSaved).toBe(false)
      await store.SET_READ_ONLY(tab.id, false)
      await vi.advanceTimersByTimeAsync(5000)
      expect(vi.mocked(window.electron.ipcRenderer.send).mock.calls.some(
        ([channel]) => channel === 'mt::response-file-save'
      )).toBe(false)
      expect(tab.markdown).toBe('pending')
      expect(tab.isSaved).toBe(false)
    } finally {
      bus.off('flush-active-editor', flush)
    }
  })

  it('allows source and find commands while keeping mutation commands blocked', () => {
    for (const id of ['view.source-code-mode', 'edit.find', 'edit.find-next', 'edit.find-previous', 'edit.copy']) {
      expect(isReadingCommandAllowed(id)).toBe(true)
    }
    for (const id of ['edit.replace', 'edit.undo', 'edit.paste', 'format.strong', 'paragraph.table', 'file.save']) {
      expect(isReadingCommandAllowed(id)).toBe(false)
    }
  })

  it('keeps restored pending documents editable when the default is reading', () => {
    const store = useEditorStore()
    usePreferencesStore().defaultOpenMode = 'read'
    const tab = createDocumentState({
      pathname: '/notes/new.md',
      isPendingCreation: true
    })
    store.tabs = [tab]
    store.currentFile = tab
    const snapshot = store.CREATE_BUFFERED_STATE()!
    delete snapshot.tabs[0].readOnly
    store.RESTORE_BUFFERED_STATE(snapshot)
    expect(store.currentFile?.readOnly).toBe(false)
  })

  it('restores the editor and reports failure even when rollback IPC also fails', async() => {
    const store = useEditorStore()
    const tab = createDocumentState({ markdown: 'retained', isSaved: false })
    store.tabs = [tab]
    store.currentFile = tab
    const setReadOnly = vi.fn()
    registerDocumentView(setReadOnly)
    const error = new Error('IPC disconnected')
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke)
    invoke.mockRejectedValueOnce(error).mockRejectedValueOnce(error)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(store.SET_READ_ONLY(tab.id, true)).resolves.toBeUndefined()
      expect(tab.readOnly).toBe(false)
      expect(tab.modeChanging).toBe(false)
      expect(setReadOnly).toHaveBeenCalledWith(false)
      expect(notice.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    } finally {
      logged.mockRestore()
    }
  })

  it('serializes locked dirty state independently of the saved marker', () => {
    const store = useEditorStore()
    const tab = createDocumentState({
      pathname: '/notes/a.md',
      markdown: 'retained',
      isSaved: false,
      readOnly: true
    })
    store.tabs = [tab]
    store.currentFile = tab
    const snapshot = store.CREATE_BUFFERED_STATE()
    expect(snapshot?.tabs[0]).toMatchObject({
      readOnly: true,
      isSaved: false,
      markdown: 'retained'
    })
    usePreferencesStore().defaultOpenMode = 'edit'
    store.RESTORE_BUFFERED_STATE(snapshot)
    expect(store.currentFile).toMatchObject({
      readOnly: true, isSaved: false, markdown: 'retained'
    })
    if (!store.currentFile) throw new Error('Restoration did not select a document')
    store.currentFile.readOnly = false
    const editableSnapshot = store.CREATE_BUFFERED_STATE()
    usePreferencesStore().defaultOpenMode = 'read'
    store.RESTORE_BUFFERED_STATE(editableSnapshot)
    expect(store.currentFile).toMatchObject({
      readOnly: false, isSaved: false, markdown: 'retained'
    })
  })
})
