import type { IHistorySelection, ISerializedHistory } from '@muyajs/core'

interface VisualHistoryView<History, Selection> {
  getMarkdown(): string
  getHistory(): History
  getSelection(): Selection
  setContent(markdown: string): void
  setHistory(history: History): void
  replaceContent(markdown: string, selection: Selection): boolean
}

interface SourceCheckpoint<History, Selection> {
  token: number
  canonicalMarkdown: string
  renderedMarkdown: string
  history: History
  selection: Selection
}

interface SourceHandoff {
  documentId: string
  activeDocumentId: string | undefined
  loadedDocumentId: string | undefined
  token: number | undefined
  canonicalMarkdown: string
  markdown: string
}

// Checkpoints belong to source editing sessions, not to the currently loaded visual tree.
export class SourceTransitions<History, Selection> {
  private checkpoints = new Map<string, SourceCheckpoint<History, Selection>>()
  private nextToken = 0

  begin(id: string, canonicalMarkdown: string, view: VisualHistoryView<History, Selection>): number {
    const existing = this.checkpoints.get(id)
    if (existing) return existing.token
    const token = ++this.nextToken
    this.checkpoints.set(id, {
      token,
      canonicalMarkdown,
      renderedMarkdown: view.getMarkdown(),
      history: view.getHistory(),
      selection: view.getSelection()
    })
    return token
  }

  tokenFor(id: string): number | undefined {
    return this.checkpoints.get(id)?.token
  }

  reconcile(handoff: SourceHandoff, view: VisualHistoryView<History, Selection>): 'stale' | 'unchanged' | 'changed' {
    const { documentId, activeDocumentId, loadedDocumentId, token, canonicalMarkdown, markdown } = handoff
    const checkpoint = this.checkpoints.get(documentId)
    if (!checkpoint || checkpoint.token !== token || documentId !== activeDocumentId || documentId !== loadedDocumentId) return 'stale'

    // Tab activation may have hydrated newer source text into the hidden engine.
    // Rebuild the original history base before recording the single source boundary.
    if (view.getMarkdown() !== checkpoint.renderedMarkdown) view.setContent(checkpoint.renderedMarkdown)
    view.setHistory(checkpoint.history)
    const changed = canonicalMarkdown !== checkpoint.canonicalMarkdown && view.replaceContent(markdown, checkpoint.selection)
    this.checkpoints.delete(documentId)
    return changed ? 'changed' : 'unchanged'
  }

  discard(id: string): void {
    this.checkpoints.delete(id)
  }

  prune(ids: Set<string>): void {
    for (const id of this.checkpoints.keys()) if (!ids.has(id)) this.checkpoints.delete(id)
  }
}

export const sourceTransitions = new SourceTransitions<ISerializedHistory, IHistorySelection | null>()
