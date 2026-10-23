import type CodeMirror from 'codemirror'
import 'codemirror/addon/search/searchcursor'

interface SearchOptions {
  isCaseSensitive?: boolean
  isRegexp?: boolean
  isWholeWord?: boolean
  selectHighlight?: boolean
}

interface Match {
  from: CodeMirror.Position
  to: CodeMirror.Position
}

export class SourceSearch {
  private value = ''
  private options: SearchOptions = {}
  private matches: Match[] = []
  private markers: CodeMirror.TextMarker[] = []
  private index = -1

  constructor(
    private cm: CodeMirror.Editor,
    private publish: (result: { value: string; index: number; matches: Match[] }) => void,
    private reveal: (line: number) => void,
    private locked: () => boolean
  ) {}

  search(value: string, options: SearchOptions = {}): void {
    this.value = value
    this.options = options
    this.matches = []
    if (value) {
      const escaped = options.isRegexp ? value : value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = options.isWholeWord ? `\\b(?:${escaped})\\b` : escaped
      try {
        const query = new RegExp(pattern, options.isCaseSensitive ? 'gu' : 'giu')
        const cursor = this.cm.getSearchCursor(query)
        while (cursor.findNext()) {
          this.matches.push({ from: cursor.from(), to: cursor.to() })
        }
      } catch {
        this.matches = []
      }
    }
    this.index = this.matches.length ? 0 : -1
    this.highlight(options.selectHighlight !== false)
  }

  find(action: 'previous' | 'next'): void {
    if (!this.matches.length) return
    this.index = (this.index + (action === 'previous' ? -1 : 1) + this.matches.length) % this.matches.length
    this.highlight(true)
  }

  replace(value: string, isSingle = true): void {
    if (this.locked()) return
    const targets = isSingle ? this.matches.slice(this.index, this.index + 1) : [...this.matches]
    this.cm.operation(() => {
      for (const { from, to } of targets.reverse()) this.cm.replaceRange(value, from, to, '+input')
    })
    this.search(this.value, this.options)
  }

  clear(): void {
    for (const marker of this.markers) marker.clear()
    this.markers = []
  }

  refresh(): void {
    if (!this.value) return
    this.search(this.value, { ...this.options, selectHighlight: false })
  }

  private highlight(select: boolean): void {
    this.clear()
    this.markers = this.matches.map(({ from, to }, index) => this.cm.markText(from, to, {
      className: index === this.index ? 'source-search-active' : 'source-search-match'
    }))
    const match = this.matches[this.index]
    if (select && match) {
      this.cm.setSelection(match.from, match.to)
      this.reveal(match.from.line)
    }
    this.publish({ value: this.value, index: this.index, matches: this.matches })
  }
}
