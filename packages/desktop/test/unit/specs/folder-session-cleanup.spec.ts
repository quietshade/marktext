import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import EditorBufferStore from 'main_renderer/editorBufferStore'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const seed = (state: unknown) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mt-folder-cleanup-'))
  directories.push(directory)
  const store = new EditorBufferStore({ editorBufferStorePath: directory })
  const entry = store.getBufferStoreInfo('folder-window')
  store.writeBufferStoreFile(entry.filePath, state)
  return { store, entry }
}

const otherWindows = [{}, {}] as Parameters<EditorBufferStore['handleClose']>[1]

describe('folder sessions during normal window cleanup', () => {
  it.each([
    { tabs: [], project: { roots: [{ pathname: '/work', collapsedPaths: ['nested'] }] } },
    { tabs: [{ isSaved: true, readOnly: true }], project: { roots: [{ pathname: '/work', collapsedPaths: [] }, { pathname: '/notes', collapsedPaths: [''] }] } },
    { tabs: [], project: { rootDirectory: '/legacy' } },
    { tabs: [], project: { projectTree: { pathname: '/legacy-tree' } } }
  ])('retains a folder session regardless of saved tab count: %j', (state) => {
    const { store, entry } = seed(state)
    store.handleClose(entry.id, otherWindows)
    expect(existsSync(entry.filePath)).toBe(true)
    expect(JSON.parse(readFileSync(entry.filePath, 'utf8'))).toEqual(state)
    expect(store.getAll()[entry.id]).toEqual(entry)
  })

  it.each([
    { tabs: [] },
    { tabs: [{ isSaved: true }], project: { roots: [] } }
  ])('still removes an expendable clean session without folders: %j', (state) => {
    const { store, entry } = seed(state)
    store.handleClose(entry.id, otherWindows)
    expect(existsSync(entry.filePath)).toBe(false)
    expect(store.getAll()[entry.id]).toBeUndefined()
  })

  it.each([
    { tabs: [{ isSaved: false, markdown: 'unsaved' }] },
    { tabs: [{ isSaved: true, isPendingCreation: true, markdown: 'not on disk' }] }
  ])('retains unsaved and pending documents without folders: %j', (state) => {
    const { store, entry } = seed(state)
    store.handleClose(entry.id, otherWindows)
    expect(JSON.parse(readFileSync(entry.filePath, 'utf8'))).toEqual(state)
  })

  it('retains the last window session even when clean and without folders', () => {
    const state = { tabs: [{ isSaved: true }] }
    const { store, entry } = seed(state)
    store.handleClose(entry.id, [{}] as Parameters<EditorBufferStore['handleClose']>[1])
    expect(JSON.parse(readFileSync(entry.filePath, 'utf8'))).toEqual(state)
  })
})
