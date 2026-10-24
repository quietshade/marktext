import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getFileOpenDirectory, getFolderOpenDirectory } from 'main_renderer/menu/fileOpenDirectory'

describe('File Open directory precedence', () => {
  let directory: string
  beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'mt-open-dir-unit-')) })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  it('uses the newest existing file, ignoring folders and unavailable files', () => {
    const file = path.join(directory, 'note.md')
    const configured = path.join(directory, 'configured')
    mkdirSync(configured)
    writeFileSync(file, '# Note')
    expect(getFileOpenDirectory([
      { pathname: configured, isDirectory: true },
      { pathname: path.join(configured, 'missing.md'), isDirectory: false },
      { pathname: file, isDirectory: false }
    ], { startUpAction: 'folder', defaultDirectoryToOpen: configured })).toBe(directory)
  })

  it('falls back to the explicitly selected startup folder without recent files', () => {
    expect(getFileOpenDirectory([], { startUpAction: 'folder', defaultDirectoryToOpen: directory })).toBe(directory)
  })

  it('does not repurpose an inactive or missing startup directory', () => {
    expect(getFileOpenDirectory([], { startUpAction: 'restoreAll', defaultDirectoryToOpen: directory })).toBeUndefined()
    expect(getFileOpenDirectory([], { startUpAction: 'folder', defaultDirectoryToOpen: path.join(directory, 'missing') })).toBeUndefined()
    expect(getFileOpenDirectory([], {})).toBeUndefined()
  })

  it('prefers the remembered folder over the configured startup folder', () => {
    const configured = path.join(directory, 'configured')
    mkdirSync(configured)
    expect(getFolderOpenDirectory({ lastOpenedFolder: directory, startUpAction: 'folder', defaultDirectoryToOpen: configured })).toBe(directory)
  })

  it('falls back to the active startup folder when the remembered folder was deleted', () => {
    const removed = path.join(directory, 'removed')
    mkdirSync(removed)
    rmSync(removed, { recursive: true })
    expect(getFolderOpenDirectory({ lastOpenedFolder: removed, startUpAction: 'folder', defaultDirectoryToOpen: directory })).toBe(directory)
    expect(getFolderOpenDirectory({ startUpAction: 'folder', defaultDirectoryToOpen: directory })).toBe(directory)
  })

  it('does not use a file as a folder or an unavailable startup fallback', () => {
    const file = path.join(directory, 'note.md')
    writeFileSync(file, '# Note')
    expect(getFolderOpenDirectory({ lastOpenedFolder: file, startUpAction: 'folder', defaultDirectoryToOpen: directory })).toBe(directory)
    expect(getFolderOpenDirectory({ lastOpenedFolder: file, startUpAction: 'folder', defaultDirectoryToOpen: file })).toBeUndefined()
    expect(getFolderOpenDirectory({ lastOpenedFolder: path.join(directory, 'missing'), startUpAction: 'folder', defaultDirectoryToOpen: path.join(directory, 'also-missing') })).toBeUndefined()
  })

  it('leaves the native chooser default when no valid history or active fallback exists', () => {
    for (const startUpAction of ['restoreAll', 'blank', 'openLastFolder']) {
      expect(getFolderOpenDirectory({ lastOpenedFolder: path.join(directory, 'missing'), startUpAction, defaultDirectoryToOpen: directory })).toBeUndefined()
    }
    expect(getFolderOpenDirectory({})).toBeUndefined()
  })

  it('keeps folder and file directory selection independent', () => {
    const fileDirectory = path.join(directory, 'files')
    mkdirSync(fileDirectory)
    const file = path.join(fileDirectory, 'note.md')
    writeFileSync(file, '# Note')
    const preferences = { lastOpenedFolder: directory, startUpAction: 'folder', defaultDirectoryToOpen: directory }
    const history = [{ pathname: directory, isDirectory: true }, { pathname: file, isDirectory: false }]
    expect(getFileOpenDirectory(history, preferences)).toBe(fileDirectory)
    expect(getFolderOpenDirectory(preferences)).toBe(directory)
  })
})
