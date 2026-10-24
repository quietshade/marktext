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

  const open = (editor: EditorWindow, name: string, requestId: number, preview = true) => {
    editor.openTab(`/notes/${name}.md`, { preview, requestId })
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

  it('reports the exact failed promoted request while keeping the existing error notification', async() => {
    const { editor, send } = create()
    for (const id of [1, 2, 3]) {
      open(editor, `unavailable-${id}`, id)
      editor.promotePendingPreview(id)
      await finish(`unavailable-${id}`, true)
    }
    expect(send.mock.calls.filter(([channel]) => channel === 'mt::sidebar-open-failed')).toEqual([
      ['mt::sidebar-open-failed', 1, '/notes/unavailable-1.md'],
      ['mt::sidebar-open-failed', 2, '/notes/unavailable-2.md'],
      ['mt::sidebar-open-failed', 3, '/notes/unavailable-3.md']
    ])
    expect(send.mock.calls.filter(([channel]) => channel === 'mt::show-notification')).toHaveLength(3)
    expect(send.mock.calls.filter(([channel]) => channel === 'mt::open-new-tab')).toHaveLength(0)
  })

  it('a failed older read does not remove the newer pending promotion of the same path', async() => {
    const { editor, send } = create()
    open(editor, 'retry', 1)
    editor.promotePendingPreview(1)
    const first = pending.get('/notes/retry.md')
    if (!first) throw new Error('Missing first read')
    open(editor, 'retry', 2)
    editor.promotePendingPreview(2)
    first.reject(new Error('Read failed'))
    await Promise.resolve()
    await Promise.resolve()
    await finish('retry')
    expect(send).toHaveBeenCalledWith('mt::sidebar-open-failed', 1, '/notes/retry.md')
    expect(send.mock.calls.filter(([channel]) => channel === 'mt::open-new-tab').map(([, , options]) => options)).toEqual([
      { preview: false, requestId: 2, readOnly: false }
    ])
  })

  it('also identifies failed sidebar opens when temporary preview tabs are disabled', async() => {
    const { editor, send } = create()
    open(editor, 'disabled-preview', 1, false)
    await finish('disabled-preview', true)
    expect(send).toHaveBeenCalledWith('mt::sidebar-open-failed', 1, '/notes/disabled-preview.md')
  })

  it.each([
    { action: 'destroy', reject: false }, { action: 'destroy', reject: true },
    { action: 'reload', reject: false }, { action: 'reload', reject: true }
  ].flatMap(value => [true, false].map(preview => ({ ...value, preview }))) as Array<{
    action: 'destroy' | 'reload'; reject: boolean; preview: boolean
  }>)('cancels promoted reads on $action (read fails: $reject, preview: $preview)', async({ action, reject, preview }) => {
    const { editor, send } = create()
    open(editor, 'a', 1, preview)
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
