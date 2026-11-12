# MarkText+1

> **Status:** Proposed project; specifications prepared for implementation with Codex.  
> **Application name:** MarkText+1 (custom fork; not an official MarkText release).  
> **Target:** Windows 10/11, x64 first; retain other MarkText platforms where practical.

MarkText+1 is a local-first Markdown viewer and editor based on [MarkText](https://github.com/marktext/marktext). It preserves MarkText's existing editing and document features while adding a compact, fully customisable command toolbar and a split layout showing raw Markdown beside a rendered preview. It also makes existing read-only functionality prominent, so files can be browsed without accidental changes.

**The detailed, testable requirements are in [`specs.md`](specs.md).** Read that file before changing code.

## Technology decision

**Recommended implementation: fork MarkText and use its existing TypeScript, Vue 3, Electron, Muya and CodeMirror codebase.** MarkText is MIT-licensed. This provides the closest possible feature parity and avoids rebuilding a mature visual Markdown editor.

C# is technically possible for a Windows-only application (for example WPF + WebView2 + a web-based rich-text editor), but reproducing all of MarkText's editing behaviours, extensions, exports and compatibility would be considerably more work. **Do not replace this project's architecture with C# unless the project owner explicitly changes this decision.** A comparison is included in `specs.md`.

As checked on **23 October 2026**, the latest stable upstream release was **v0.23.0** (21 October 2026), and the upstream `develop` branch identified itself as **0.24.0-dev**. Base the first implementation on a **pinned, tested upstream commit/tag** (prefer stable `v0.23.0` initially) rather than following an unpinned moving branch. Document the actual base SHA in the project's release notes.

## Features retained from MarkText

MarkText already provides:

- WYSIWYG (what-you-see-is-what-you-get) Markdown editing and a separate raw/source Markdown editor.
- CommonMark and GitHub Flavoured Markdown, plus supported optional Pandoc-style extensions.
- Headings, links, images, blockquotes, lists, tasks, tables, code highlighting, inline formatting and editing shortcuts.
- Mathematical expressions, front matter, footnotes, emojis, diagrams and other supported Markdown extensions.
- Document tabs, folder/file browser, file search, outline/table of contents, quick-open and command palette.
- Find/replace, clipboard image handling, editing overlays, table and image tools.
- Themes (including dark themes), focus mode and typewriter mode.
- Export to HTML/PDF and printing.
- Document statistics, session restoration, preferences, encoding/line-ending handling and file-change warnings.
- **An already collapsible sidebar** (`Ctrl+J` on Windows).
- **An existing per-tab Reading Mode** (`Ctrl+Alt+R` on Windows) that disables editing, and the `defaultOpenMode = read` preference for opening existing documents read-only.

**Definition of “all MarkText features”:** maintain the tested capabilities present in the chosen pinned MarkText baseline. Avoid claiming every Markdown/Pandoc feature is supported. Use the official upstream documentation and baseline tests as the parity inventory. No upstream capability may be knowingly removed without an explicit documented decision.

## Enhancements to develop

| Feature                                 | Required behaviour                                                                                                                                        | Starting point                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Collapsible sidebar                     | Show/hide with button, View menu and shortcut; remember state; resizable when open                                                                        | **Already exists**; expose conveniently and regression-test |
| Custom command toolbar                  | Small toolbar below title bar; add/remove/reorder commands and separators; hide/restore; overflow; remember layout; use the existing command system       | **New**                                                     |
| Side-by-side Markdown and rendered view | Source on left, rendered preview on right by default; drag divider; live updates; configurable order; keep one document and one authoritative text buffer | **New**                                                     |
| Safe viewer mode                        | Read-only for both visual and source panes, clear visible indicator, explicit switch to editing; allow selection, links and copying                       | **Already exists**; extend to new layouts and toolbar       |
| Open in viewer mode by default          | Setting for existing documents, honoured for file open, command-line open and session restore; new empty documents remain editable                        | **Already exists**; verify and regression-test              |
| Layout preferences                      | Choose editor, source, split or preview-only; persist sensible layout/split settings                                                                      | **New**                                                     |

### Proposed window layout

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ MarkText+1   Document.md                       [Reading Mode]     −  □  ×      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ☰  Open  Save  │  B  I  Link  Table  │  Source/Split/Preview  │  ⋯  [Customise]  │
├───────────────────┬────────────────────────────┬────────────────────────────────────┤
│ Files / Search    │ Raw Markdown               │ Rendered document                  │
│                   │                            │                                    │
│ ▸ My folder       │ # My document              │ My document                        │
│   Document.md     │                            │                                    │
│   Notes.md        │ A **bold** sentence.       │ A bold sentence.                   │
│                   │                            │                                    │
│ [Hide sidebar]    │                            │                                    │
├───────────────────┴────────────────────────────┴────────────────────────────────────┤
│ Document.md  •  Read only  •  Markdown  •  UTF-8                  250 words         │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

_Illustrative design only; align controls with upstream application conventions and accessibility._

### Editing and viewing rules

- **Reading Mode:** neither pane accepts document edits; changing view, scrolling, navigating and copying are permitted; saving/autosaving must not write content. It is a **UI/document safeguard**, not an operating-system file-permissions change.
- **Edit Mode + visual editor:** MarkText's existing WYSIWYG editing remains available.
- **Edit Mode + raw source:** source text is editable; the rendered preview tracks edits without itself being editable in split mode.
- **Split view:** one editable source pane (only in Edit Mode) and one always-non-editable preview. This avoids conflicting simultaneous editing engines.
- All layout and mode changes must preserve unsaved document content and must not alter the file merely by opening or previewing it.

## Development setup (Windows, PowerShell)

The working directory for this fork is:

```text
C:\Users\QuietShade\Documents\+Coding\Projects\MarkText+1
```

The fork and clone should already have been created. Do not clone a second time or overwrite the existing repository. Open PowerShell in the local project folder and verify the Git remotes:

```powershell
Set-Location "$HOME\Documents\+Coding\Projects\MarkText+1"
git remote -v
code .
```

`origin` should point to your fork; `upstream` should point to `https://github.com/marktext/marktext.git`.

**Keep the upstream root `README.md` unchanged.** This customised project brief and its specification belong under:

```text
docs/MarkTextPlus1/README.md
docs/MarkTextPlus1/specs.md
```

**Prerequisites for building:** Git; a Node.js version compatible with the chosen baseline (the inspected development branch requires at least Node 20.19.0); pnpm with the repository-pinned version; Python 3; Visual Studio 2022 C++ Build Tools and Windows SDK for native modules; VS Code and Codex. Check the exact pinned baseline's build instructions before installing dependencies.

**Once Codex has confirmed the baseline**, the usual commands in the inspected upstream development tree are:

```powershell
corepack enable
pnpm install
pnpm run dev
```

`pnpm install` may require native build tools, and the chosen pinned release may differ. Before creating feature branches, Codex should inspect the current Git branch and test the pinned baseline. Never reset or overwrite working files without review.

## How to instruct Codex

Open this fork in VS Code, select Codex, and paste the following as the **first task**:

> Read `docs/MarkTextPlus1/README.md` and `docs/MarkTextPlus1/specs.md` completely. Inspect the actual pinned MarkText source and upstream test structure before modifying anything. First produce a short implementation plan identifying existing functionality and exact files that will change. Preserve the full MarkText feature set and its MIT attribution. Implement only Stage 0 (baseline, feature inventory, smoke tests) from `docs/MarkTextPlus1/specs.md`. Do not rewrite MarkText or introduce C#. Run appropriate checks and report what passed, failed or could not run. Stop at the Stage 0 acceptance criteria.

After Stage 0, ask Codex to implement **one stage at a time**, including tests, with a reviewable pull request for each stage. Do not ask it to build the entire app in one request.

## Verification

Use the scripts actually provided by the selected upstream version; in the inspected `develop` workspace the principal commands were:

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run test:e2e
pnpm run build:win:x64
```

`pnpm run build:win:x64` creates Windows distribution artefacts under `dist/` in the inspected workspace. Tests must cover source/preview synchronisation, read-only protection, no-op open/close (no document rewrite), toolbar persistence, keyboard access and the preservation of existing MarkText capabilities.

## Non-goals for the first release

No cloud accounts or sync backend, collaboration, proprietary document format, plugin marketplace, smartphone port or complete rewrite of the Muya editor. Keep files as portable `.md`/`.markdown` text documents and avoid collecting document content or telemetry.

## Licence and attribution

This project is intended as a derivative of [MarkText](https://github.com/marktext/marktext), which is licensed under the [MIT License](https://github.com/marktext/marktext/blob/develop/LICENSE). Preserve the MIT copyright/license notice and check third-party dependencies and artwork before redistributing binaries. Rename/rebrand the fork's executable, icons and installers rather than implying an official MarkText release. Consult [`specs.md`](specs.md) for release requirements.

## References (reviewed 23 October 2026)

- MarkText repository: https://github.com/marktext/marktext
- Stable v0.23.0: https://github.com/marktext/marktext/releases/tag/v0.23.0
- End-user basics/Reading Mode: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/BASICS.md
- Markdown syntax/extensions: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/MARKDOWN_SYNTAX.md
- Editing features: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/EDITING.md
- Preferences: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/PREFERENCES.md
- Developer architecture: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/dev/ARCHITECTURE.md
- Build instructions: https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/dev/BUILD.md
