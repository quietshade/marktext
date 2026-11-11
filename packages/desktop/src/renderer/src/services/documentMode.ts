let documentView: ((readOnly: boolean) => void) | null = null
let sourceView: ((readOnly: boolean) => void) | null = null

export const registerDocumentView = (view: typeof documentView): void => {
  documentView = view
}

export const registerSourceView = (view: typeof sourceView): void => {
  sourceView = view
}

export const prepareReading = async(): Promise<void> => {
  applyReadOnly(true)
}

export const applyReadOnly = (value: boolean): void => {
  documentView?.(value)
  sourceView?.(value)
}

export const preventSourceFocusScroll = (input: HTMLElement): void => {
  const focus = input.focus.bind(input)
  // CodeMirror places this input beside the caret, which may be outside the saved viewport.
  input.focus = options => focus({ preventScroll: true, ...options })
}

interface SourcePosition {
  line: number
  ch: number
  sticky?: string
}

interface SourceRange {
  anchor: SourcePosition
  head: SourcePosition
  goalColumn?: number
}

interface SourceHistoryView {
  getValue: () => string
  getHistory: () => unknown
  setHistory: (history: unknown) => void
  setValue: (value: string) => void
  clearHistory: () => void
  listSelections: () => SourceRange[]
  getCursor: (which: 'anchor' | 'head') => SourcePosition
  setSelections: (ranges: SourceRange[], primary: number, options: { scroll: boolean }) => void
}

const sourceHistory = new Map<
  string,
  { markdown: string; canonicalMarkdown: string; history: unknown; ranges: SourceRange[]; primary: number; scrollTop?: number }
>()

export const captureSourceHistory = (
  id: string | null,
  view: SourceHistoryView,
  canonicalMarkdown = view.getValue(),
  scrollTop?: number
): void => {
  if (id) {
    const ranges = view.listSelections().map(range => ({ ...range, anchor: { ...range.anchor }, head: { ...range.head } }))
    const anchor = view.getCursor('anchor')
    const head = view.getCursor('head')
    const primary = ranges.findIndex(range => range.anchor.line === anchor.line && range.anchor.ch === anchor.ch && range.head.line === head.line && range.head.ch === head.ch)
    sourceHistory.set(id, {
      markdown: view.getValue(),
      canonicalMarkdown,
      history: view.getHistory(),
      ranges,
      primary: Math.max(0, primary),
      scrollTop
    })
  }
}

export const restoreSourceHistory = (id: string, view: SourceHistoryView): { scrollTop?: number } | undefined => {
  const cached = sourceHistory.get(id)
  // CodeMirror retains undo history across setValue, even when the next tab has identical text.
  view.clearHistory()
  if (
    cached &&
    (cached.markdown === view.getValue() || cached.canonicalMarkdown === view.getValue())
  ) {
    if (cached.markdown !== view.getValue()) view.setValue(cached.markdown)
    view.setSelections(cached.ranges, cached.primary, { scroll: false })
    // setSelections copies endpoints, but omits CodeMirror's vertical-navigation column.
    for (const [index, range] of view.listSelections().entries()) {
      const goalColumn = cached.ranges[index]?.goalColumn
      if (goalColumn !== undefined) range.goalColumn = goalColumn
    }
    view.setHistory(cached.history)
    return { scrollTop: cached.scrollTop }
  }
}

export const pruneSourceHistory = (ids: Set<string>): void => {
  for (const id of sourceHistory.keys()) if (!ids.has(id)) sourceHistory.delete(id)
}
