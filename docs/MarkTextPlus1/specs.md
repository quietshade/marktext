# MarkText+1 — Software Requirements & Implementation Specification

**Specification version:** 1.0  
**Date:** 23 October 2026  
**Status:** Ready for iterative implementation by Codex; not an assertion that the app has been built  
**Upstream:** https://github.com/marktext/marktext  
**Specification location:** `docs/MarkTextPlus1/specs.md` (preserve upstream root `README.md`)  
**Primary baseline:** Pin and verify `v0.23.0` (or document a justified, tested alternative SHA)  
**Primary OS:** Windows 10/11 x64  
**Implementation language:** TypeScript (existing Electron/Vue/Muya/CodeMirror stack)  
**Related document:** [README.md](README.md) (this directory)

---

## 1. Goals and project principles

### 1.1 Product goal

Deliver a full-featured Markdown editor/viewer retaining the features of the selected MarkText baseline, with a compact configurable top toolbar, a resizable side-by-side raw-Markdown/rendered layout and a reliable read-only viewing workflow that can be the default when opening documents.

### 1.2 Non-negotiable principles

1. **Fork and extend; do not rewrite.** Use upstream command, layout, preference, editor, export and session infrastructure wherever possible.
2. **Preserve upstream features.** Identify and regression-test rather than independently recreate all MarkText features.
3. **No silent document modification.** Opening, viewing, switching layouts, reading and closing an unchanged document must never rewrite it.
4. **One document, one authoritative Markdown value.** No diverging copies of a document across source/editor/preview panes.
5. **Explicit editing.** When Reading Mode is enabled, the user must choose Edit Mode before changing document content. A layout change is not consent to edit.
6. **Local-first and private.** Do not add mandatory network access, accounts, tracking or cloud sync.
7. **Accessible and configurable.** All new functionality must work with keyboard controls, dark/light themes and normal Windows scaling.
8. **Maintainable changes.** Prefer small components, typed command IDs, automated tests and reviewable pull requests.

### 1.3 Meaning of “all MarkText features”

The requirement is feature parity with the **pinned tested upstream baseline**, not an unbounded promise to support every variant of Markdown. Before implementation, Codex must produce a baseline capability inventory and identify whether each requested behaviour exists already, needs extension or is new. Preserve the behaviour of features offered by the baseline, including preferences and command shortcuts.

Do not replace/disable the original live WYSIWYG editor simply because the new split view is built around source plus preview.

## 2. Existing functionality vs required work

| ID     | Area               | Observed upstream capability                                                                       | Required work                                                      |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| EX-01  | Sidebar            | Toggle/resizable sidebar; Windows `Ctrl+J`                                                         | Preserve and add easy toolbar access; remember and test visibility |
| EX-02  | Reading Mode       | Per-tab read-only; Windows `Ctrl+Alt+R`; default mode for existing files (`defaultOpenMode: read`) | Preserve and enforce for new split/preview/toolbar paths           |
| EX-03  | Editors            | Muya WYSIWYG and CodeMirror 5 source editor                                                        | Reuse and coordinate with new split layout                         |
| EX-04  | Commands           | Menu actions, command palette, registered keyboard shortcuts                                       | Reuse through command ID/availability adapter for custom toolbar   |
| EX-05  | Documents          | Tabs, open folder, files sidebar, search, table of contents, preferences, document statistics      | Regression-test                                                    |
| NEW-01 | Toolbar            | No equivalent universal user-configurable pinned top command toolbar documented                    | Implement                                                          |
| NEW-02 | Split view         | Existing separate editors; no documented simultaneous two-pane view                                | Implement                                                          |
| NEW-03 | Layout preferences | Existing editor modes and session layout                                                           | Extend with split/preview and persisted width/order                |

**Important:** Upstream v0.23.0 already meets the basic sidebar and default read-only requests. Don't create redundant systems or accidentally change their defaults without a user-controlled option.

## 3. Technology and architecture decision

### 3.1 Chosen implementation

Continue with MarkText's existing monorepo and libraries:

- **TypeScript + Electron** for the desktop application, OS integration and packaging.
- **Vue 3 + Pinia** for the interface and application state.
- **Muya (`@muyajs/core`)** for the existing rich Markdown editor.
- **CodeMirror 5** for the existing raw Markdown source editor.
- Existing rendering facilities, sanitisation, KaTeX, diagram engines, themes, output/export and preferences.
- Existing **Vitest** unit tests and **Playwright** end-to-end tests.

Use upstream architecture as actually found in the pinned checkout. The inspected `develop` structure included:

```text
packages/desktop/src/main/                Electron main process and disk writes
packages/desktop/src/preload/             Sandboxed renderer bridge
packages/desktop/src/renderer/src/        Vue UI, stores, editor components
packages/desktop/src/renderer/src/store/  Document/layout/command state
packages/desktop/src/renderer/src/commands/
packages/desktop/src/shared/types/        Shared interfaces and IPC
packages/desktop/test/                    Desktop tests
packages/muya/                            WYSIWYG Markdown editor
```

Inspect actual source before choosing precise extension points; paths and commands can differ between stable and `develop`.

### 3.2 Safety boundary

Retain Electron renderer sandboxing, context isolation and disabled Node integration. Follow existing typed preload/IPC (inter-process communication) contracts. Do not grant renderers unrestricted file-system access to implement the toolbar or preview. Render Markdown/HTML through existing sanitisation mechanisms; do not execute embedded arbitrary scripts or inadvertently load untrusted remote assets. Preserve documented user-controlled external-link/image behaviour.

### 3.3 C# alternative — considered, not selected

If the owner later insists on C# and Windows-only, a greenfield design could use **.NET + WPF** (desktop UI), **WebView2** (rendered HTML and rich editor), **Markdig** (Markdown parsing/rendering) and a source control such as **AvalonEdit** or a web-based CodeMirror. This remains a hybrid C#/JavaScript editor, not a full native C# replacement. It would require substantial work to reproduce Muya-style direct manipulation, complex tables/images, Pandoc-style extensions, diagram rendering, export fidelity, encoding handling and all MarkText workflows. Therefore it is _not_ the preferred Codex brief.

## 4. Existing MarkText feature parity (P0)

Codex must build a `baseline-feature-matrix.md` **during Stage 0** and add a smoke or automated test for each significant category. The checklist must include, at minimum:

- [ ] Live WYSIWYG editing, inline formatting overlays and keyboard editing.
- [ ] Source code editing, syntax/line-number preferences and switching editor modes.
- [ ] CommonMark and GitHub Flavoured Markdown: headings, paragraphs, links, images, blockquotes, code, tables, lists, task lists and strikethrough.
- [ ] Supported optional syntax, where enabled: front matter, footnotes, superscript/subscript, LaTeX/KaTeX mathematics, emojis, GitHub Alerts, highlight and other extensions shipped by the selected upstream version.
- [ ] Supported diagram renderers (e.g. Mermaid, flowchart.js, Vega-Lite and others actually supported by that baseline), syntax-highlighted code and media viewer.
- [ ] Image insertion, paste from clipboard, configured image storage, resize and tools.
- [ ] Table creation, formatting, row/column operations and supported drag handling.
- [ ] File open/save/save-as, tabs, folders, recent files, search/replace, folder search and quick-open.
- [ ] Sidebar file browser, heading outline/table of contents, keyboard navigation and session restoration.
- [ ] Focus and typewriter modes; theme selection, dark mode and existing appearance preferences.
- [ ] HTML and PDF export, print and document statistics.
- [ ] Encodings, UTF-8/UTF-16 handling as supported, line endings, unsaved-change prompts, external file modification warnings and autosave.
- [ ] Menu commands, command palette, existing keyboard shortcuts and any upstream platform support retained by the fork.
- [ ] Existing Reading Mode semantics and `defaultOpenMode = read`.

Do not claim a feature works based solely on a source file existing. Validate manually or with an automated test, and record any upstream failures separately from introduced regressions.

## 5. Main UI and layouts

### 5.1 Window structure (REQ-UI-01)

A compact toolbar sits **below the native/custom title bar and above the document content**, not over editor text. Preserve the menu, window controls, tabs, file tree, outline and bottom status/notification areas. Layout must work at 100%, 125%, 150% and 200% Windows display scaling without missing controls or unreachable actions.

### 5.2 Layout states (REQ-UI-02)

Define layout as a separate property from edit permissions:

| Layout ID | Left/primary pane          | Right/secondary pane  | Editing behaviour                                                              |
| --------- | -------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `wysiwyg` | Existing Muya editor       | None                  | Editable only in Edit Mode                                                     |
| `source`  | Existing CodeMirror editor | None                  | Editable only in Edit Mode                                                     |
| `split`   | CodeMirror source          | Rendered HTML preview | Source editable only in Edit Mode; preview never editable                      |
| `preview` | Rendered HTML preview      | None                  | No inline editing, even when Edit Mode flag is set; use another layout to edit |

`wysiwyg` must remain selectable and must not be replaced by rendered HTML. Allow swapping left/right order in `split`. Store the user's preferred layout. A document in Reading Mode remains read-only whichever layout is selected.

**Default:** retain existing WYSIWYG layout for backward compatibility. Provide `Preferences > View > Default layout` with WYSIWYG, Source, Split and Preview. When Default Opening Mode is Reading, show the requested layout in a non-editable state.

### 5.3 Split pane interactions (REQ-UI-03)

- Use a drag handle/divider with a minimum practical width for each pane (suggest 250 px where window permits).
- Default divider: 50/50. Restore previously chosen proportion; clamp to current window bounds.
- Default raw Markdown left and rendered preview right. Allow `Swap panes` setting/action.
- Panes scroll independently. Provide **Sync scrolling** toggle (default on) where reliable; map positions approximately by headings/blocks rather than assuming equal total heights. Disable gracefully for unsupported content and avoid jitter/feedback loops.
- Render changes as text is edited (target 150–300 ms debounce for typical documents). Rapid typing must not freeze the interface.
- Source caret/selection and scroll positions should be preserved across split/source switches where feasible. Do not reset both panes to the beginning on each change.
- Preview remains selectable (copy text), supports internal anchors/navigation and safe link opening; it never becomes contenteditable.
- Provide buttons/menu/keyboard commands: WYSIWYG, Source, Split, Preview, Swap panes, Sync scrolling, Hide/Show sidebar.
- Keep tabs, outline and notifications working while split view is active.

### 5.4 Sidebar (REQ-UI-04)

- Retain upstream hide/show (`Ctrl+J` on Windows), width adjustment and folder explorer/search behaviours.
- Show an optional toolbar button for sidebar toggle; it must behave the same as the existing menu/shortcut.
- When hidden, source/rendered layout expands to use available space.
- Remember sidebar visibility and width using the existing layout persistence model. No separate competing preference store.
- Restore the document outline independently if the selected upstream version treats it independently.

## 6. Custom top toolbar

### 6.1 Functional requirements (REQ-TB-01 to 12)

| ID    | Requirement                                                               | Acceptance                                                                               |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| TB-01 | Small toolbar (around 36–40 logical px high; may adapt for accessibility) | Does not obscure content/window controls                                                 |
| TB-02 | Toolbar visible/hidden via View menu and shortcut/action                  | Hidden mode retains full functionality through menus/commands                            |
| TB-03 | `Customise toolbar` dialog/settings                                       | User can find every **executable user-facing command** in the baseline command catalogue |
| TB-04 | Add/remove commands                                                       | Any eligible command can be added to a toolbar slot, not just formatting commands        |
| TB-05 | Rearrange commands with drag/drop and keyboard Move Left/Right            | Order saved and restored on restart                                                      |
| TB-06 | Add separators/spacers                                                    | Layout remains understandable and compact                                                |
| TB-07 | Icons and text labels                                                     | User chooses icons-only, labels-only or icons+labels; fallback label if icon missing     |
| TB-08 | Overflow (`...`) for narrow windows                                       | No commands become inaccessible; overflow retains correct order                          |
| TB-09 | Tooltips and command descriptions                                         | Name and keyboard shortcut shown, where known                                            |
| TB-10 | Dynamic enabled/disabled state                                            | Save/edit actions disabled when inappropriate (not merely hidden)                        |
| TB-11 | Default layout, Reset to defaults and optional Save/Load preset JSON      | Never destroy a custom layout without confirmation; validate imported IDs                |
| TB-12 | Keyboard access and theme support                                         | Tab focus, Enter/Space invoke, visible focus, sufficient contrast, high DPI              |

### 6.2 Command integration (REQ-TB-13)

**Do not create a second independent implementation of each menu command.** Build a typed adapter from upstream's command IDs to the same handlers invoked by menu/palette/shortcuts. Command metadata includes at least:

```ts
interface ToolbarCommandDescriptor {
  id: string // Stable existing command ID if available
  title: string // Localisable text
  category: string
  icon?: string
  description?: string
  shortcut?: string
  isAvailable: () => boolean // Current tab, mode, selection, document, OS
  execute: () => void | Promise<void>
}

type ToolbarItem =
  { kind: 'command'; commandId: string } | { kind: 'separator' } | { kind: 'spacer' }
```

Treat this as a **conceptual API**; adapt to the actual existing command framework. Command catalogue coverage must include File, Edit, Format, Paragraph, Insert, View, navigation, export, clipboard, search, settings and modes **where upstream exposes executable actions**. Commands requiring contextual input may open their normal dialog. OS-only or unsafe internal commands should be excluded with an explicit reason recorded in the feature matrix. Do not invoke privileged Electron functionality directly from a toolbar component.

### 6.3 Suggested initial toolbar (REQ-TB-14)

Sidebar Toggle | Open | Save | separator | Bold | Italic | Link | Table | Code | separator | Reading/Edit toggle | Source | Split | Preview | Export | overflow.

Toolbar is user-customisable; these are **defaults, not hard-coded restrictions**.

## 7. Reading Mode and default open safeguards

### 7.1 Read-only behaviour (REQ-RO-01)

Use upstream per-document Reading Mode rather than inventing another read-only flag. Its meaning must extend to every new editor/preview/toolbar action:

- **Blocked:** typing, paste, cut that mutates content, delete/backspace, drag-to-edit, formatting actions, image insertion, task checkbox toggling, inline editing, table edit, undo/redo that changes document content, source text manipulation, programmatic document writes, content autosave and Save if it would commit pending changes while Reading Mode remains active.
- **Allowed:** scrolling, text selection, copying, find, heading navigation, clicking safe links, showing menus, changing themes, changing layout, printing and exports that do not alter the source document.
- Editing commands in menus, shortcuts, context menus, quick-insert and toolbar must be disabled or safely rejected, not merely greyed out visually.
- Show a clear, low-clutter `Reading Mode` / `Read only` indicator (title/status bar and an accessible mode switch). Avoid relying only on colour.
- An explicit `Edit document` action toggles into Edit Mode. Do not implicitly enable editing when the user clicks the source pane or changes layout.
- `Ctrl+Alt+R` continues to work, as supported in the selected upstream version.

### 7.2 Open in Reading Mode by default (REQ-RO-02)

Keep the existing preference `defaultOpenMode = 'read' | 'edit'` and its UI; expose it clearly. Requirements:

- Applies to existing Markdown files opened through File Open, file association, drag/drop, sidebar/folder, command line and restored session as appropriate to upstream session semantics.
- An explicitly user-chosen per-tab mode should be restored for tabs already open in a session; newly opened existing files use the configured default.
- A **new empty/untitled document** defaults to Edit Mode so it can be authored; document this exception.
- The existing `--read-only` CLI flag, when supported by the baseline, must continue to override a preference for that invocation.
- Changing the default preference does not silently switch unsaved documents currently open.
- For a document already dirty _before_ entering Reading Mode, retain unsaved changes in memory exactly as upstream does, pause autosave, show unsaved indication and resume normal save workflows only after explicit return to Edit Mode. Do not discard changes.
- This is an application safeguard, not a system-level ACL, file attribute or encrypted lock. Do not mark disk files read-only unless the user independently does so in Windows.

### 7.3 Guard write paths (REQ-RO-03)

Retain/enhance read-mode enforcement at the document command/editing layer **and** all existing save/autosave/file-operation entry points. Prevent future toolbar/layout code from bypassing it. `Save As` of a separate copy from a read-only source is acceptable only if it is an explicit, distinct user operation and leaves the original untouched; document that behaviour. Exports to PDF/HTML are permitted because they don't modify the original Markdown file.

## 8. Data ownership, synchronisation and file safety

### 8.1 Canonical document model (REQ-DATA-01)

The current document's authoritative Markdown content remains in the upstream document/tab store. The CodeMirror source pane edits that model; the HTML preview is **derived** from it. Do not maintain independently editable copies of Muya and CodeMirror simultaneously in split mode.

- In `split`, raw/source is the only editor (if Edit Mode); preview is never an editor.
- In `wysiwyg`, use the existing Muya editing and conversion paths.
- On switching `wysiwyg` ↔ `source`/`split`, use the existing upstream content-transfer logic and flush pending changes first.
- Avoid repeated parse/serialise cycles merely to refresh preview. Preview rendering must not modify Markdown or mark it dirty.
- Track document revisions/sequence numbers so delayed rendering of revision N never overwrites revision N+1.
- Make updates safe during rapid keystrokes, IME composition, save, tab switch, close and external file changes.
- Preserve undo/redo integrity in the active editor to the extent supported by upstream; switching layouts must never silently lose pending edits.

### 8.2 Disk operations (REQ-DATA-02)

- Opening then closing a document without editing must leave **file bytes, modification time and content** unchanged.
- Respect detected encoding/BOM and LF/CRLF preferences/behaviour already supported by upstream. Do not normalise text on read or preview.
- Saving an edited document follows upstream atomic/safe-write semantics; do not implement competing write logic.
- Honor unsaved prompts when closing/changing documents and external-change conflict detection.
- Crash recovery/session restoration must not turn an unedited read-only tab into a dirty one.
- Relative links and images must resolve relative to the source document directory; do not permit untrusted Markdown to escape intended file access boundaries or execute local code.

### 8.3 Performance targets (REQ-DATA-03)

Targets, not claims about current MarkText performance:

- Typing in split source should remain responsive for a representative 1 MB Markdown document on a typical Windows desktop.
- A normal edit should update preview within approximately 300 ms after input settles; use a cancellable/debounced rendering path.
- Large diagrams and large files should show progress or a safe fallback instead of hanging or truncating content silently.
- Profiling and documented limitations take precedence over premature performance rewriting.

## 9. Preferences, persistence and compatibility

### 9.1 Settings (REQ-PREF-01)

Extend **existing** MarkText Preferences; avoid separate random JSON files. Proposed conceptual fields:

```json
{
  "defaultOpenMode": "read",
  "defaultViewLayout": "wysiwyg",
  "toolbar": {
    "visible": true,
    "displayStyle": "icons-and-labels",
    "items": [
      { "kind": "command", "commandId": "<actual-upstream-command-id>" },
      { "kind": "separator" }
    ]
  },
  "splitView": {
    "sourcePosition": "left",
    "sourceWidthRatio": 0.5,
    "syncScrolling": true
  }
}
```

The `commandId` placeholder above is illustrative, **not an actual upstream ID**. Codex must discover real command IDs. `defaultOpenMode` is upstream's existing setting; do not register it twice. Use the existing preference schema, migration/version system, validation, and per-window/per-tab layout session model where applicable.

### 9.2 Persistence rules (REQ-PREF-02)

- Toolbar settings persist across restart and are applied to new windows.
- Sidebar state, split percentage, pane order and selected layout restore consistently with upstream's existing `restoreLayoutState` setting.
- Respect user choice not to restore layout; apply configured defaults instead.
- If an upstream update removes a toolbar command, skip/flag it without crashing or deleting the entire layout.
- Invalid or corrupt preferences result in a recoverable default; don't delete user documents, tabs or unrelated settings.
- Version settings migrations, include test fixtures for old MarkText preferences and avoid breaking upstream preferences.

## 10. Keyboard shortcuts, accessibility and usability

- Preserve existing upstream keyboard shortcuts and `keybindings.json` customisation.
- Add new commands to command palette and View menu even if toolbar is hidden.
- Any proposed new default shortcut must be checked against the actual Windows bindings and must not silently override one. If conflict exists, leave unassigned or select an unused key and document it.
- Customise toolbar dialog supports keyboard search/filter, focus traversal, accessible names, reorder via buttons/keyboard, and Reset to Defaults.
- Reading Mode is unmistakable in both dark and light themes and does not rely exclusively on a coloured badge.
- Commands that cannot run in the current state are visibly disabled and cannot mutate content when invoked through other routes.
- Support Windows keyboard navigation, tooltips, zoom, high-DPI displays and screen-reader labelling of new controls.
- Keep editor usable at 1024×768; overflow actions rather than truncating essential UI.

## 11. Security, privacy and licensing

- No newly introduced telemetry, mandatory sign-in or cloud service.
- Continue using MarkText's HTML sanitisation and Electron security model; use vetted diagram/rendering libraries already in the repo where possible.
- Do not evaluate HTML scripts, execute document-supplied code or load arbitrary remote resources without the user's existing explicit permission/settings.
- No new generic renderer-to-disk IPC APIs. Validate file paths and operations through existing main/preload layers.
- Preserve upstream MIT licence/copyright and third-party attributions. Track new dependencies and their licence obligations.
- Rename app metadata, shortcuts, executable, installer and icon appropriately for a personal fork, but do not misrepresent it as an official upstream release.

## 12. Tests and acceptance criteria

### 12.1 Automated test requirements

Implement tests at the appropriate existing unit/integration/Playwright levels:

| Test ID | Scenario                                                    | Pass condition                                                              |
| ------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| AT-01   | Open existing MD in default Reading Mode                    | Reading indicator visible; no document content edit possible                |
| AT-02   | Type, paste, cut, task toggle, format, drag in Reading Mode | All fail safely to mutate source/document                                   |
| AT-03   | Activate Split in Reading Mode                              | Both source and rendered panes view-only; copying works                     |
| AT-04   | Explicitly switch to Edit Mode in Split                     | Source becomes editable; preview follows after debounce                     |
| AT-05   | Rapid source edits                                          | Preview eventually matches most recent revision, not stale render           |
| AT-06   | Switch Source/Split/WYSIWYG with unsaved changes            | No lost content or unintended dirty flag from mode switch alone             |
| AT-07   | Open then close without editing                             | SHA-256 bytes, length and modified timestamp unchanged                      |
| AT-08   | Open in Reading Mode with autosave configured               | No disk write; existing dirty content preserved in memory                   |
| AT-09   | Add/rearrange/remove toolbar commands; restart              | Custom items/order/visibility persist                                       |
| AT-10   | Add an upstream file/export/insert command to toolbar       | Invokes same handler as menu and palette                                    |
| AT-11   | Editing command on toolbar in Reading Mode                  | Disabled and safely rejected if invoked programmatically                    |
| AT-12   | Narrow window and keyboard-only use                         | Overflow works, all commands remain reachable                               |
| AT-13   | Hide/show sidebar while Split active                        | Both panes resize properly; state restored on restart                       |
| AT-14   | Divider drag and swap pane positions                        | Saved ratio and order restored, within valid bounds                         |
| AT-15   | Encoding/BOM and CRLF fixtures                              | Unmodified files remain byte-identical; edited save follows upstream policy |
| AT-16   | Malicious raw HTML/URLs in preview                          | No script execution or unintended privileged file access                    |
| AT-17   | Export PDF/HTML in Reading Mode                             | Export succeeds without modifying original Markdown                         |
| AT-18   | External modification and close with dirty content          | Existing conflict/unsaved warnings preserved                                |
| AT-19   | Markdown fixture with tables/math/footnotes/diagrams/images | Rendered output consistent with pinned MarkText baseline                    |
| AT-20   | Light/dark mode and scaling                                 | Toolbar, source, preview and indicators readable; no inaccessible controls  |
| AT-21   | Existing shortcut/command palette and options               | No regression to baseline behaviour                                         |
| AT-22   | `defaultOpenMode` preference changes                        | New existing-file opens follow setting; untitled doc editable               |

### 12.2 Mandatory manual acceptance walkthrough

1. Set default opening mode to **Reading** and default layout to **Split**. Restart.
2. Open an existing `.md` containing headings, a table, code, an image, a Mermaid diagram and a relative link.
3. Verify raw Markdown left and rendered document right, clear read-only indication, sidebar optionally collapsed, link navigation/copy permitted.
4. Try editing in both panes and via menus, shortcuts, paste, context menu and a toolbar edit command; **no document modification** must be possible.
5. Close the file and confirm unchanged disk contents and timestamp.
6. Reopen, explicitly select Edit Mode and change the source; verify preview updates correctly and save/reopen reflects the change.
7. Rearrange the toolbar; pin Open, Save, Export, Sidebar Toggle, Reading Mode and Split; restart and verify persistence.
8. Resize divider, swap panes, hide/show sidebar, switch among layout modes, confirm theme support and session recovery.
9. Export PDF and HTML. Compare output and editing behaviour with the selected upstream baseline.
10. Run all existing upstream tests plus new tests, build a Windows x64 installer and confirm licence attribution.

## 13. Delivery stages — Codex execution order

**Rule:** one stage per Codex task/PR. First inspect, then modify. Each stage must include tests and a short changes/verification report. Do not claim a test passed unless it actually ran.

### Stage 0 — Baseline and architecture (must be first)

- Fork and pin known MarkText baseline (`v0.23.0` recommended); record source SHA.
- Validate Windows development build, existing tests and installer process before code modifications.
- Catalogue actual commands/IDs, WYSIWYG and source hosts, renderer pipeline, document stores, read-mode guards and preferences.
- Create `baseline-feature-matrix.md`, document upstream issues and identify exact extension points.
- Confirm default Reading Mode and sidebar keyboard behaviour in selected revision.
- Commit documentation and one harmless baseline/smoke test if useful.

**Gate:** pinned app launches; important commands and file/mode state paths understood; no features removed.

### Stage 1 — Reading Mode and sidebar preservation

- Keep upstream implementation; fix only any demonstrated read-only or layout integration gaps.
- Expose simple Sidebar Toggle and Reading/Edit Toggle commands in the shared command surface if needed.
- Add tests for default open in read mode and no-op disk change, including autosave guard.

**Gate:** AT-01, AT-02 (where supported by current UI), AT-07, AT-08 and AT-22 passing.

### Stage 2 — Layout framework and split view

- Extend layout store and component hierarchy without creating duplicate editable document models.
- Add rendered-only preview component, source + preview splitter and all view selection actions.
- Implement debounced, revision-aware source-to-preview updates; no render-to-disk writes.
- Add resizable divider, swap positions and responsive resizing.

**Gate:** AT-03–06, AT-13–15, AT-19 passing; WYSIWYG and Source retained.

### Stage 3 — Toolbar and command customiser

- Build unified command metadata/availability adapter using existing registered commands.
- Build compact toolbar, overflow, initial items and customiser UI with search, add/remove, reorder, separators, display modes and reset.
- Persist preferences through upstream schema/store; add keyboard accessibility and disabled states.

**Gate:** AT-09–12 passing; every eligible command pin-able; no second command implementation.

### Stage 4 — Usability, accessibility and resilience

- Add scroll sync with safe fallback; caret/scroll preservation; dark/light and 125–200% display support.
- Improve reading-mode visual indicator across panes and command surfaces.
- Harden external-file changes, dirty state, large documents, links and rendering security.
- Add preference migration and backwards compatibility tests.

**Gate:** AT-16, AT-18, AT-20, AT-21 passing; no new regression.

### Stage 5 — Packaging and release

- Rebrand app as MarkText+1 (working name) while respecting existing copyrights and third-party notices.
- Build and smoke-test Windows 10/11 x64 setup/portable output where upstream supports it.
- Add user instructions, screenshot(s), troubleshooting, `CHANGELOG.md` and concise build/release notes with upstream SHA.
- Perform full parity and automated/manual regression run. Deliver installable binary and source changes through the fork's GitHub Releases only after tests pass.

**Gate:** Full acceptance walkthrough passes and any known exceptions are documented.

## 14. Implementation notes to Codex

1. **Always inspect the selected revision.** Upstream `develop` docs (0.24.0-dev at time of research) are useful references but may differ from pinned `v0.23.0`. Do not blindly copy file paths, shortcuts or settings between revisions.
2. Prioritise **existing command infrastructure**. In the inspected development branch, likely starting points include:
   - `packages/desktop/src/renderer/src/commands/`
   - `packages/desktop/src/renderer/src/store/commandCenter.ts`
   - `packages/desktop/src/renderer/src/store/layout.ts`
   - `packages/desktop/src/main/menu/templates/view.ts`
   - `packages/desktop/src/renderer/src/components/commandPalette/`
     These are **inspection leads**, not guaranteed extension APIs.
3. Treat preview as a derived, read-only rendering. Keep one authoritative Markdown buffer and ensure async rendering cannot race newer edits.
4. Treat read-only as enforcement across all editing entry points, not an HTML `readonly` property alone.
5. No uncontrolled refactoring of Muya, package upgrades, new frameworks, source-editor replacement or CSS overhaul in the first stages.
6. Record dependency versions, tests run, results, performance/encoding caveats and any functionality left incomplete.
7. If a feature is unexpectedly unsupported by the pinned baseline, report it and document a deliberate decision (backport a particular upstream commit, implement separately or defer). Do not silently omit it.
8. For each stage, supply a PR with an overview, modified files, screenshots for visible UI changes, tests and manual verification steps.

## 15. Definition of done

MarkText+1 is complete for v1 only when:

- The selected MarkText baseline's documented major capabilities remain available.
- Collapsible sidebar, visible/hideable customisable toolbar and true simultaneous source/rendered split view work reliably.
- Any executable user-facing command can be added to the toolbar or a specific exclusion is justified/documented.
- Per-tab Reading Mode and a default-open-in-Reading setting work across all relevant document entry paths and new layout states.
- Viewing does not modify file bytes, timestamps or unsaved content; editing requires an explicit mode change.
- Settings persist, keyboard use and dark mode are workable, and rendering cannot execute unsafe document code.
- Automated checks, full manual acceptance and Windows packaging succeed; licence/attribution is preserved.

## 16. References

Sources reviewed **23 October 2026**. Documentation on `develop` can change; compare it with the chosen stable tag during Stage 0.

1. Repo and licence: https://github.com/marktext/marktext
2. Stable release: https://github.com/marktext/marktext/releases/tag/v0.23.0
3. User basics, sidebar, Reading Mode and default-open setting: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/BASICS.md
4. Features, formatting and editor tools: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/EDITING.md
5. Syntax, diagrams and extensions: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/MARKDOWN_SYNTAX.md
6. Preferences and settings: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/PREFERENCES.md
7. Export capabilities: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/EXPORT.md
8. Developer architecture: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/dev/ARCHITECTURE.md
9. Build and testing: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/dev/BUILD.md
10. Interface architecture: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/dev/INTERFACE.md
11. Microsoft WPF WebView2 (C# alternative): https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf
