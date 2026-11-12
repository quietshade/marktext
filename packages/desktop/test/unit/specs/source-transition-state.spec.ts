import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureSourceHistory, preventSourceFocusScroll, pruneSourceHistory, restoreSourceHistory } from '@/services/documentMode'
import { SourceTransitions } from '@/services/sourceTransitions'

afterEach(() => pruneSourceHistory(new Set()))

const sourceView = (initial = 'source') => {
  let markdown = initial
  let ranges = [
    { anchor: { line: 2, ch: 8 }, head: { line: 0, ch: 1 } },
    { anchor: { line: 4, ch: 3 }, head: { line: 4, ch: 3 } }
  ]
  let history: unknown = { done: ['first', 'second'], undone: ['redo'] }
  const view = {
    getValue: () => markdown,
    setValue: vi.fn((value: string) => { markdown = value }),
    getHistory: () => history,
    setHistory: vi.fn((value: unknown) => { history = value }),
    clearHistory: vi.fn(() => { history = {} }),
    listSelections: () => ranges,
    getCursor: (which: 'anchor' | 'head') => ranges[1][which],
    setSelections: vi.fn((value: typeof ranges, _primary: number, _options: { scroll: boolean }) => { ranges = value.map(({ anchor, head }) => ({ anchor, head })) })
  }
  return view
}

describe('native Source view state', () => {
  it('preserves keyboard vertical-navigation columns, including zero, independently per range', () => {
    const outgoing = sourceView()
    Object.assign(outgoing.listSelections()[0], { goalColumn: 0 })
    Object.assign(outgoing.listSelections()[1], { goalColumn: 93 })
    captureSourceHistory('a', outgoing)
    Object.assign(outgoing.listSelections()[1], { goalColumn: 10 })
    const incoming = sourceView()
    restoreSourceHistory('a', incoming)
    expect(incoming.listSelections()).toMatchObject([{ goalColumn: 0 }, { goalColumn: 93 }])
  })

  it('prevents implicit input focus scrolling while respecting an explicit focus option', () => {
    const input = document.createElement('textarea')
    const focus = vi.spyOn(input, 'focus').mockImplementation(() => {})
    preventSourceFocusScroll(input)
    input.focus()
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    input.focus({ preventScroll: false })
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: false })
  })

  it('retains backwards/multiple selections, primary caret, history and scroll without replacing equal content', () => {
    const outgoing = sourceView()
    const ranges = structuredClone(outgoing.listSelections())
    const history = outgoing.getHistory()
    captureSourceHistory('a', outgoing, 'canonical', 482)
    outgoing.listSelections()[0].anchor.ch = 0
    const incoming = sourceView()
    expect(restoreSourceHistory('a', incoming)).toEqual({ scrollTop: 482 })
    expect(incoming.setSelections).toHaveBeenCalledWith(ranges, 1, { scroll: false })
    expect(incoming.getHistory()).toEqual(history)
    expect(incoming.setValue).not.toHaveBeenCalled()
  })

  it('restores the raw source buffer when canonical trailing-newline policy differs', () => {
    const outgoing = sourceView('source\n\n')
    captureSourceHistory('a', outgoing, 'source\n', 50)
    const incoming = sourceView('source\n')
    expect(restoreSourceHistory('a', incoming)).toEqual({ scrollTop: 50 })
    expect(incoming.getValue()).toBe('source\n\n')
    expect(incoming.getHistory()).toEqual(outgoing.getHistory())
  })

  it('does not replay history or selections over an external replacement or another document', () => {
    captureSourceHistory('a', sourceView())
    for (const [id, value] of [['a', 'external replacement'], ['b', 'source']]) {
      const incoming = sourceView(value)
      expect(restoreSourceHistory(id, incoming)).toBeUndefined()
      expect(incoming.clearHistory).toHaveBeenCalledOnce()
      expect(incoming.setHistory).not.toHaveBeenCalled()
      expect(incoming.setSelections).not.toHaveBeenCalled()
    }
  })

  it('prunes closed documents', () => {
    captureSourceHistory('a', sourceView())
    pruneSourceHistory(new Set())
    expect(restoreSourceHistory('a', sourceView())).toBeUndefined()
  })
})

const visualView = () => {
  let markdown = 'visual baseline'
  let history = ['visual edit']
  return {
    getMarkdown: () => markdown,
    getHistory: () => [...history],
    getSelection: () => 'visual caret',
    setContent: vi.fn((value: string) => { markdown = value; history = [] }),
    setHistory: vi.fn((value: string[]) => { history = [...value] }),
    replaceContent: vi.fn((value: string, _selection: string) => {
      if (value === markdown) return false
      history.push(markdown)
      markdown = value
      return true
    })
  }
}

describe('document-owned Source reconciliation', () => {
  it('retains one checkpoint across repeated Source-family activation without touching history', () => {
    const sessions = new SourceTransitions<string[], string>()
    const view = visualView()
    const token = sessions.begin('a', 'canonical baseline', view)
    expect(sessions.begin('a', 'later source', view)).toBe(token)
    expect(view.setContent).not.toHaveBeenCalled()
    expect(view.setHistory).not.toHaveBeenCalled()
    expect(view.replaceContent).not.toHaveBeenCalled()
  })

  it('restores the correct visual baseline after tab hydration and records at most one source boundary', () => {
    const sessions = new SourceTransitions<string[], string>()
    const view = visualView()
    const token = sessions.begin('a', 'canonical baseline', view)
    view.setContent('new source already hydrated during tab activation')
    const handoff = { documentId: 'a', activeDocumentId: 'a', loadedDocumentId: 'a', token, canonicalMarkdown: 'edited', markdown: 'edited' }
    expect(sessions.reconcile(handoff, view)).toBe('changed')
    expect(view.getHistory()).toEqual(['visual edit', 'visual baseline'])
    expect(view.replaceContent).toHaveBeenCalledExactlyOnceWith('edited', 'visual caret')
    expect(sessions.reconcile(handoff, view)).toBe('stale')
    expect(view.replaceContent).toHaveBeenCalledOnce()
  })

  it('leaves no boundary for no-op source sessions despite noncanonical rendered serialization', () => {
    const sessions = new SourceTransitions<string[], string>()
    const view = visualView()
    const token = sessions.begin('a', 'raw canonical spacing  \n', view)
    expect(sessions.reconcile({ documentId: 'a', activeDocumentId: 'a', loadedDocumentId: 'a', token, canonicalMarkdown: 'raw canonical spacing  \n', markdown: 'raw canonical spacing  \n' }, view)).toBe('unchanged')
    expect(view.replaceContent).not.toHaveBeenCalled()
    expect(view.getHistory()).toEqual(['visual edit'])
  })

  it.each(['active', 'loaded', 'token'] as const)('rejects stale %s ownership without consuming a valid pending transition', (mismatch) => {
    const sessions = new SourceTransitions<string[], string>()
    const view = visualView()
    const token = sessions.begin('a', 'base', view)
    const handoff = { documentId: 'a', activeDocumentId: 'a', loadedDocumentId: 'a', token, canonicalMarkdown: 'edited', markdown: 'edited' }
    if (mismatch === 'active') handoff.activeDocumentId = 'b'
    if (mismatch === 'loaded') handoff.loadedDocumentId = 'b'
    if (mismatch === 'token') handoff.token++
    expect(sessions.reconcile(handoff, view)).toBe('stale')
    expect(sessions.tokenFor('a')).toBe(token)
    expect(view.setHistory).not.toHaveBeenCalled()
    expect(view.replaceContent).not.toHaveBeenCalled()
  })

  it('keeps checkpoints independent and invalidates old tokens on replacement and closure', () => {
    const sessions = new SourceTransitions<string[], string>()
    const view = visualView()
    const old = sessions.begin('a', 'a', view)
    const second = sessions.begin('b', 'b', view)
    sessions.discard('a')
    expect(sessions.begin('a', 'replacement', view)).not.toBe(old)
    sessions.prune(new Set(['b']))
    expect(sessions.tokenFor('a')).toBeUndefined()
    expect(sessions.tokenFor('b')).toBe(second)
  })
})
