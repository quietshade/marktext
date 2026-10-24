import { beforeEach, describe, expect, it, vi } from 'vitest'
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

type EditorStore = ReturnType<typeof useEditorStore>

const documentFor = (name: string) => ({
  pathname: `/notes/${name}.md`,
  filename: `${name}.md`,
  markdown: `# ${name}\n`
})

const beginOpen = (store: EditorStore, pathname: string): number => {
  const requestId = store.BEGIN_SIDEBAR_OPEN(pathname, true)
  if (requestId == null) throw new Error(`Could not begin sidebar open for ${pathname}`)
  return requestId
}

const currentFile = (store: EditorStore) => {
  if (!store.currentFile) throw new Error('Expected a current file')
  return store.currentFile
}

const capturePromotionIds = (store: EditorStore, pathname: string, requestId: number): Set<number> => {
  const add = vi.spyOn(Set.prototype, 'add')
  try {
    store.FOCUS_FILE(pathname)
    const index = add.mock.calls.findIndex(([value]) => value === requestId)
    const ids = add.mock.contexts[index]
    if (!(ids instanceof Set)) throw new Error('The pending promotion was not recorded')
    return ids as Set<number>
  } finally {
    add.mockRestore()
  }
}

const failOpen = (requestId: number, pathname: string): void => {
  for (const [channel, listener] of vi.mocked(window.electron.ipcRenderer.on).mock.calls) {
    if (channel === 'mt::sidebar-open-failed') {
      (listener as unknown as (...args: unknown[]) => void)({}, requestId, pathname)
    }
  }
}

describe('sidebar preview tabs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    usePreferencesStore().openFilesInPreviewMode = true
  })

  it('replaces the existing preview tab in place', () => {
    const store = useEditorStore()
    const firstRequest = beginOpen(store, '/notes/a.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('a'),
      options: { preview: true, requestId: firstRequest }
    })

    const firstTab = store.tabs[0]
    if (!firstTab) throw new Error('Expected the first preview tab')
    expect(firstTab.isPreview).toBe(true)
    vi.clearAllMocks()

    const secondRequest = beginOpen(store, '/notes/b.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('b'),
      options: { preview: true, requestId: secondRequest }
    })

    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0]).toMatchObject({
      pathname: '/notes/b.md',
      isPreview: true
    })
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::forget-document',
      firstTab.id
    )
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::window-tab-closed',
      '/notes/a.md'
    )
  })

  it('pins a preview on its first real content change', () => {
    const store = useEditorStore()
    const requestId = beginOpen(store, '/notes/a.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('a'),
      options: { preview: true, requestId }
    })
    const tab = currentFile(store)
    expect(tab.isPreview).toBe(true)

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: tab.id,
      markdown: '# a edited\n'
    })

    expect(tab.isPreview).toBe(false)
    expect(tab.isSaved).toBe(false)
  })

  it('pins an existing preview on double click without moving it', () => {
    const store = useEditorStore()
    const requestId = beginOpen(store, '/notes/a.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('a'),
      options: { preview: true, requestId }
    })
    const tab = currentFile(store)

    store.FOCUS_FILE('/notes/a.md')

    expect(store.tabs).toEqual([tab])
    expect(tab.isPreview).toBe(false)
  })

  it('honours the preference when a preview request is already in flight', () => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    const requestId = beginOpen(store, '/notes/a.md')
    preferences.openFilesInPreviewMode = false

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('a'),
      options: { preview: true, requestId }
    })

    expect(store.currentFile?.isPreview).toBe(false)
  })

  it('retains a pending permanent open after a later preview completes', () => {
    const store = useEditorStore()
    const firstRequest = beginOpen(store, '/notes/pinned.md')
    store.FOCUS_FILE('/notes/pinned.md')
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith('mt::promote-pending-preview', firstRequest)
    const secondRequest = beginOpen(store, '/notes/next.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('next'), options: { preview: true, requestId: secondRequest }
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('pinned'), options: { preview: true, requestId: firstRequest }
    })
    expect(store.tabs).toHaveLength(2)
    expect(store.tabs.find(tab => tab.pathname === '/notes/pinned.md')?.isPreview).toBe(false)
    expect(store.tabs.find(tab => tab.pathname === '/notes/next.md')?.isPreview).toBe(true)
  })

  it('releases every failed promotion instead of accumulating renderer request IDs', () => {
    const store = useEditorStore()
    store.LISTEN_FOR_NEW_TAB()
    const requests: Array<{ id: number; pathname: string; ids: Set<number> }> = []
    try {
      for (let index = 0; index < 3; index++) {
        const pathname = `/notes/unavailable-${index}.md`
        const id = beginOpen(store, pathname)
        const ids = capturePromotionIds(store, pathname, id)
        requests.push({ id, pathname, ids })
        expect(ids.has(id)).toBe(true)
        failOpen(id, pathname)
      }
      expect(requests.filter(({ id, ids }) => ids.has(id)).map(({ id }) => id)).toEqual([])
      expect(requests.map(({ pathname }) => store.PEEK_OPEN_INTENT(pathname))).toEqual([null, null, null])
      expect(store.tabs).toHaveLength(0)
    } finally {
      for (const { id, pathname, ids } of requests) {
        ids.delete(id)
        store.DISCARD_OPEN_INTENT(pathname)
      }
    }
  })

  it('releases a successful queued promotion only when its document is delivered', () => {
    const store = useEditorStore()
    const pathname = '/notes/delivered.md'
    const id = beginOpen(store, pathname)
    const ids = capturePromotionIds(store, pathname, id)
    const next = beginOpen(store, '/notes/next.md')
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('next'), options: { preview: true, requestId: next } })
    expect(ids.has(id)).toBe(true)
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('delivered'), options: { preview: true, requestId: id } })
    expect(ids.has(id)).toBe(false)
    expect(store.tabs.find(tab => tab.pathname === pathname)?.isPreview).toBe(false)
    expect(store.tabs).toHaveLength(2)
  })

  it('a failed promotion leaves other promotions and the newest preview pending', () => {
    const store = useEditorStore()
    store.LISTEN_FOR_NEW_TAB()
    const firstPath = '/notes/failed.md'
    const first = beginOpen(store, firstPath)
    const ids = capturePromotionIds(store, firstPath, first)
    const secondPath = '/notes/retained.md'
    const second = beginOpen(store, secondPath)
    store.FOCUS_FILE(secondPath)
    const third = beginOpen(store, '/notes/next.md')
    failOpen(first, firstPath)
    expect(ids.has(first)).toBe(false)
    expect(ids.has(second)).toBe(true)
    expect(store.IS_LATEST_SIDEBAR_OPEN(third, '/notes/next.md')).toBe(true)
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('next'), options: { preview: true, requestId: third } })
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('retained'), options: { preview: true, requestId: second } })
    expect(ids.has(second)).toBe(false)
    expect(store.tabs.find(tab => tab.pathname === secondPath)?.isPreview).toBe(false)
    expect(store.tabs.find(tab => tab.pathname === '/notes/next.md')?.isPreview).toBe(true)
  })

  it('an older failure cannot clear a newer promoted retry of the same path', () => {
    const store = useEditorStore()
    store.LISTEN_FOR_NEW_TAB()
    const pathname = '/notes/retry.md'
    const first = beginOpen(store, pathname)
    const ids = capturePromotionIds(store, pathname, first)
    const retry = beginOpen(store, pathname)
    store.FOCUS_FILE(pathname)
    failOpen(first, pathname)
    expect(ids.has(first)).toBe(false)
    expect(ids.has(retry)).toBe(true)
    expect(store.PEEK_OPEN_INTENT(pathname)).toMatchObject({ focus: true, preview: false })
    const next = beginOpen(store, '/notes/next.md')
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('next'), options: { preview: true, requestId: next } })
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('retry'), options: { preview: true, requestId: retry } })
    expect(ids.has(retry)).toBe(false)
    expect(store.tabs.find(tab => tab.pathname === pathname)?.isPreview).toBe(false)
    expect(store.tabs).toHaveLength(2)
  })

  it('a failed unpromoted open permits an immediate retry without touching a newer request', () => {
    const store = useEditorStore()
    store.LISTEN_FOR_NEW_TAB()
    const pathname = '/notes/retry.md'
    const first = beginOpen(store, pathname)
    failOpen(first, pathname)
    expect(store.PEEK_OPEN_INTENT(pathname)).toBeNull()
    const retry = beginOpen(store, pathname)
    failOpen(first, pathname)
    expect(store.IS_LATEST_SIDEBAR_OPEN(retry, pathname)).toBe(true)
    expect(store.PEEK_OPEN_INTENT(pathname)).toMatchObject({ focus: false, preview: true })
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('retry'), options: { preview: true, requestId: retry } })
    expect(store.currentFile?.isPreview).toBe(true)
  })

  it('cancelling a later preview does not discard an earlier pending promotion', () => {
    const store = useEditorStore()
    const pathname = '/notes/pinned.md'
    const pinned = beginOpen(store, pathname)
    const ids = capturePromotionIds(store, pathname, pinned)
    const canceled = beginOpen(store, '/notes/canceled.md')
    store.CANCEL_PENDING_SIDEBAR_OPEN()
    expect(ids.has(pinned)).toBe(true)
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('canceled'), options: { preview: true, requestId: canceled } })
    expect(store.tabs).toHaveLength(0)
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: documentFor('pinned'), options: { preview: true, requestId: pinned } })
    expect(ids.has(pinned)).toBe(false)
    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile?.isPreview).toBe(false)
  })

  it('layout and permission changes do not pin a temporary tab', async() => {
    const store = useEditorStore()
    const requestId = beginOpen(store, '/notes/layout.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('layout'), options: { preview: true, requestId }
    })
    const tab = currentFile(store)
    for (const layout of ['source', 'preview', 'wysiwyg'] as const) {
      await store.SET_DOCUMENT_LAYOUT(layout)
      await store.SET_READ_ONLY(tab.id, true)
      expect(tab.isPreview).toBe(true)
      expect(tab.documentLayout).toBe(layout)
    }
    store.FOCUS_FILE('/notes/layout.md')
    expect(tab.isPreview).toBe(false)
    expect(tab.readOnly).toBe(true)
    expect(tab.documentLayout).toBe('wysiwyg')
  })

  it('explicit File Open pins an existing preview and refreshes recents without resetting state', () => {
    const store = useEditorStore()
    const requestId = beginOpen(store, '/notes/reopen.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('reopen'), options: { preview: true, requestId, readOnly: true }
    })
    const tab = currentFile(store)
    store.SET_DOCUMENT_LAYOUT('preview')
    store.SWITCH_TAB_BY_FILEPATH('/notes/reopen.md')
    expect(store.tabs).toEqual([tab])
    expect(tab).toMatchObject({ isPreview: false, readOnly: true, documentLayout: 'preview', isSaved: true })
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith('mt::add-recently-used-document', '/notes/reopen.md')
  })

  it('drops a response that is no longer the latest sidebar request', () => {
    const store = useEditorStore()
    const firstRequest = beginOpen(store, '/notes/a.md')
    const secondRequest = beginOpen(store, '/notes/b.md')

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('a'),
      options: { preview: true, requestId: firstRequest }
    })
    expect(store.tabs).toHaveLength(0)

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('b'),
      options: { preview: true, requestId: secondRequest }
    })
    expect(store.tabs.map((tab) => tab.pathname)).toEqual(['/notes/b.md'])
  })

  it('does not persist preview state in the buffer store', () => {
    const store = useEditorStore()
    const requestId = beginOpen(store, '/notes/a.md')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: documentFor('a'),
      options: { preview: true, requestId }
    })

    const snapshot = store.CREATE_BUFFERED_STATE()
    if (!snapshot) throw new Error('Expected buffered editor state')
    expect(snapshot.tabs[0]).not.toHaveProperty('isPreview')
  })

  it('cancels a pending preview through the request channel', () => {
    const store = useEditorStore()
    const requestId = beginOpen(store, '/notes/a.md')

    store.CANCEL_PENDING_SIDEBAR_OPEN()

    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::cancel-pending-preview',
      requestId
    )
  })
})
