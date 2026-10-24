import { beforeEach, describe, expect, it, vi } from 'vitest'

const { load, error } = vi.hoisted(() => ({ load: vi.fn(), error: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { emit: vi.fn() }, app: {}, dialog: {} }))
vi.mock('electron-log', () => ({ default: { error } }))
vi.mock('electron-window-state', () => ({ default: vi.fn() }))
vi.mock('main_renderer/config', () => ({ editorWinOptions: {}, isLinux: false, isOsx: false }))
vi.mock('main_renderer/windows/utils', () => ({}))
vi.mock('main_renderer/contextMenu/editor', () => ({}))
vi.mock('main_renderer/spellchecker', () => ({}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('main_renderer/filesystem/markdown', () => ({ loadMarkdownFile: load, loadCliMarkdownFile: load }))

import EditorWindow from 'main_renderer/windows/editor'
import { WindowLifecycle } from 'main_renderer/windows/base'

describe('main-process sidebar open ownership', () => {
  const pending = new Map<string, { resolve: (document: unknown) => void; reject: (error: Error) => void }>()
  beforeEach(() => {
    vi.clearAllMocks()
    pending.clear()
    load.mockImplementation((pathname: string) => new Promise((resolve, reject) => pending.set(pathname, { resolve, reject })))
  })

  const create = () => {
    const send = vi.fn()
    const editor = new EditorWindow({
      preferences: { getAll: () => ({}), getPreferredEol: () => 'lf', getItem: () => 'edit' },
      menu: { addRecentlyUsedDocument: vi.fn() }
    } as never)
    editor.lifecycle = WindowLifecycle.READY
    editor.browserWindow = {
      webContents: { send, once: vi.fn() }, destroy: vi.fn(), reload: vi.fn()
    } as never
    return { editor, send }
  }

  const open = (editor: EditorWindow, name: string, requestId: number) => {
    editor.openTab(`/notes/${name}.md`, { preview: true, requestId })
  }
  const finish = async(name: string, reject = false) => {
    const pathname = `/notes/${name}.md`
    const read = pending.get(pathname)
    if (!read) throw new Error(`No pending read for ${pathname}`)
    if (reject) read.reject(new Error('Read failed'))
    else read.resolve({ pathname, filename: `${name}.md`, markdown: `# ${name}\n` })
    // Drain the load continuation and its error handler without a timing delay.
    await Promise.resolve()
    await Promise.resolve()
  }

  it('retains a promoted disk read when a later preview is opened', async() => {
    const { editor, send } = create()
    open(editor, 'a', 1)
    editor.promotePendingPreview(1)
    open(editor, 'b', 2)
    await finish('b')
    await finish('a')
    const opened = send.mock.calls.filter(([channel]) => channel === 'mt::open-new-tab')
    expect(opened.map(([, doc]) => doc.pathname)).toEqual(['/notes/b.md', '/notes/a.md'])
    expect(opened[1]?.[2]).toMatchObject({ preview: false, requestId: 1 })
    expect(error).not.toHaveBeenCalled()
  })

  it('still discards unpromoted stale and canceled reads', async() => {
    const { editor, send } = create()
    open(editor, 'a', 1)
    open(editor, 'b', 2)
    editor.cancelPendingPreview(2)
    await finish('a')
    await finish('b')
    expect(send).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it.each([
    { action: 'destroy', reject: false }, { action: 'destroy', reject: true },
    { action: 'reload', reject: false }, { action: 'reload', reject: true }
  ] as const)('cancels promoted reads on $action (read fails: $reject)', async({ action, reject }) => {
    const { editor, send } = create()
    open(editor, 'a', 1)
    editor.promotePendingPreview(1)
    editor[action]()
    // A completed reload has a live window again, but belongs to a fresh renderer session.
    if (action === 'reload') editor.lifecycle = WindowLifecycle.READY
    send.mockClear()
    await finish('a', reject)
    expect(send).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
