export const DOCUMENT_LAYOUTS = ['wysiwyg', 'source', 'split', 'preview'] as const
export type DocumentLayout = typeof DOCUMENT_LAYOUTS[number]
export type AvailableDocumentLayout = Exclude<DocumentLayout, 'split'>

export const isAvailableDocumentLayout = (value: unknown): value is AvailableDocumentLayout =>
  value === 'wysiwyg' || value === 'source' || value === 'preview'

// Missing, future and invalid session layouts fall back to the existing source preference.
export const resolveDocumentLayout = (value: unknown, sourceDefault = false): AvailableDocumentLayout =>
  isAvailableDocumentLayout(value) ? value : sourceDefault ? 'source' : 'wysiwyg'

// A view capability; the persisted document permission remains readOnly.
export const isDocumentReadOnly = (document: { readOnly?: boolean; documentLayout?: DocumentLayout } | null | undefined): boolean =>
  !!document?.readOnly || document?.documentLayout === 'preview'
