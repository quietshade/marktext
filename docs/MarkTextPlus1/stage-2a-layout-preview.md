# Stage 2A — Document layouts and Preview Only

Date: 23 October 2026. Approved starting commit: `d7c3baf3b9004068e2fe74ea92725b269bb5048d`, branch `feature/marktext-plus-one`. The working tree was clean before this task. Requirements and prior evidence: [project brief](README.md), [specification](specs.md), [baseline matrix](baseline-feature-matrix.md), [Stage 1](stage-1-viewer-mode.md) and [folder restoration](stage-1-folder-restoration.md).

This implements **Stage 2A only**. Split has a type identity but no renderer, menu entry or executable command. No toolbar, dependency upgrade, packaging, branding or commit is included.

## Layout state and ownership

The canonical document remains `IFileState.markdown`. `IFileState.readOnly` remains the existing persisted Reading/Edit permission. The optional per-tab `documentLayout` field is separate:

The existing `isPreview` field still means a temporary sidebar-opened tab. It is unrelated to the new `preview` document layout and retains its existing behavior.

| Identity  | Stage 2A behavior                                           | Editable surface in Edit Mode |
| --------- | ----------------------------------------------------------- | ----------------------------- |
| `wysiwyg` | Existing Muya visual editor                                 | Muya                          |
| `source`  | Existing CodeMirror editor                                  | CodeMirror                    |
| `split`   | Reserved identity; rejected by runtime activation           | Deferred to Stage 2B          |
| `preview` | Existing Muya rendering presented read-only, without source | None                          |

`shared/types/documentLayout.ts` defines the four identities, the available subset and safe fallback resolution. The editor store exposes `documentLayout`, `isSourceLayout`, `isPreviewLayout`, `documentReadOnly` and `documentEditingBlocked`. The last two are **derived capabilities**, not additional stored permission flags. A view is read-only when the document is in Reading Mode or its layout is Preview. Commands also reject mutations during the existing permission transition.

`SET_DOCUMENT_LAYOUT` is the renderer's activation entry point. It validates the available layout, flushes the current editor **before** changing the field, applies the derived view capability and schedules the normal buffered-state update. It never unlocks, saves or replaces the document model.

The existing window `layout` store continues to own sidebar/tab-bar visibility, sidebar width and related window furniture. Document layout is per tab, rather than being another sidebar/window flag. No competing preference file or persistence store was introduced.

## Preview implementation and safeguards

Preview reuses the mounted Muya instance in `components/editorWithTabs/editor.vue`. Its read-only presentation already handles supported Markdown, images, tables, highlighted code, links, math/diagrams, native selection/copy, Find, outline navigation, themes and HTML sanitization. Keeping that instance mounted preserves visual-editor history and avoids introducing a second Markdown parser or rendering pipeline during 2A.

The engine receives read-only capability even when the document permission is Edit Mode. Its contenteditable surfaces, input handling, tasks, editing plugins and history mutations use the existing engine protections. Application guards extend those protections through the renderer command centre, palette, edit/format/paragraph IPC, replacement, clipboard actions, document content updates, encoding/line-ending actions and save handlers. A registered editing command cannot bypass Preview by invoking its handler directly through the supported command/IPC routes.

The main menu keeps the Reading Mode checkbox tied to the actual document permission. Its separate cached layout controls Preview radio state and mutation availability, including menu rebuilds. Source-only restrictions remain in the existing source paths. Main-process Reading Mode lock epochs, write coordination and Electron security configuration are unchanged. Layout selection uses a typed main-to-renderer event; the renderer still validates its value. The targeted corrections below document their additional internal chooser and pending-promotion channels.

Pending renderer autosave timers are cancelled on entry to Preview. Autosave callbacks also check the target tab's layout. Returning to an editing layout or unlocking alone does not silently schedule a save; an actual edit or explicit Save in an editing-capable layout resumes the existing workflow. Writes already issued before the transition retain the baseline main-process coordination; layout is not a new disk permission or filesystem lock.

Preview hydrations, rendering and navigation have no path back to document Markdown. Existing external-change/session loading remains an authorized host update. No-op layout changes do not normalize, serialize back into, or rewrite the Markdown file. Profile/session snapshots can still update normally.

## Transitions, cursors and history

- WYSIWYG → Preview → WYSIWYG changes Muya's view capability without replacing its content or history. Preview selects/copies text natively; switching permissions while it is active cannot make it editable.
- Source commits content on its existing change/flush paths. Leaving Source captures its per-tab CodeMirror history; returning restores that history and the source caret. A separate transient `sourceScrollTop` avoids interpreting rendered scroll coordinates as source coordinates.
- The existing Source → Muya handoff remains the single bulk undo boundary for actual source edits. Preview uses that handoff to show the committed source text. It does not serialize Muya's rendered result back into the authoritative Markdown value.
- Per-tab layout changes require care when a view is mounting/unmounting. Muya tracks which tab its loaded content belongs to before capturing a source caret. An outgoing CodeMirror instance ignores incoming non-source document loads and cannot emit a stale handoff over the newly selected document.
- Existing in-memory engine/source history caches remain per tab. **Undo stacks are not newly persisted across application restart**; this retains the baseline session behavior. Dirty Markdown and per-tab permission/layout are recovered independently of those runtime caches.

## Persistence and compatibility

The existing version 3 buffered-tab format gains the optional `documentLayout` field. No session reset, destructive migration or format replacement is needed. Main-process folder roots/session IDs and file loading remain unchanged.

When `restoreLayoutState` is enabled, implemented per-tab layouts restore with their documents. When disabled, stored document layouts are ignored and the existing startup/source preference supplies the layout. Missing, invalid and currently unsupported `split` values fall back safely to the configured Source/WYSIWYG default. Document Reading/Edit permission is preserved in either case.

`sourceCodeModeEnabled` remains the existing startup preference. The renderer's legacy `preferences.sourceCode` value is its fallback, rather than the active tab's identity. **Ctrl+E now changes the active document's Source/WYSIWYG layout**, and other tabs retain their selection; from Preview it opens Source. This is the intended change required for per-document layout preservation. Newly opened/untitled documents use the configured startup fallback, not another tab's explicitly selected Preview. New untitled documents remain editable. No new default-layout preference or silent default change is included in 2A.

## User-facing controls and commands

View → **Document Layout** offers Visual Editor (WYSIWYG), Markdown Source and Preview Only. The existing Source Code Mode item and Ctrl+E remain available, with no added default accelerators.

Three stable commands are registered in both main and renderer catalogues:

- `view.layout-wysiwyg`
- `view.layout-source`
- `view.layout-preview`

They are also available in the existing command palette. Menu radio state follows the active tab, while the existing Reading Mode command continues to control permission independently. The footer shows the selected layout next to the Reading/Edit status. Preview adds an “Open in Visual Editor” button; it changes layout without unlocking a locked document. The footer wraps in narrow space and retains theme variables and keyboard focus styling. New labels exist in all 13 supported locale files; native-speaker wording review remains useful.

## Files changed

All source paths in this table are relative to `packages/desktop/`.

| Files                                                                                                             | Purpose                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types/documentLayout.ts` (new), `src/shared/types/files.ts`, `src/shared/types/ipc.ts`                | Four identities, available-layout validation, derived view capability, optional document view state and typed IPC.         |
| `src/renderer/src/store/editor.ts`, `src/renderer/src/store/help.ts`                                              | Layout activation, per-tab/session state, transition ordering, mutation/autosave/save guards.                              |
| `src/renderer/src/store/preferences.ts`                                                                           | Preserve startup/source fallback; route Ctrl+E and existing source actions through the active tab's layout.                |
| `src/renderer/src/components/editorWithTabs/{index,editor,sourceCode,outline,documentMode}.vue`                   | Host visibility, read-only Preview, source history/caret/scroll ownership, outline measurement, layout label/control.      |
| `src/renderer/src/components/search/index.vue`, `src/renderer/src/pages/app.vue`                                  | Find ownership/replacement capability and native menu synchronization for the current document/layout.                     |
| `src/renderer/src/store/{commandCenter,listenForMain}.ts`, `src/renderer/src/components/commandPalette/index.vue` | Execution-time guards and Preview-specific unavailable labels.                                                             |
| `src/common/commands/constants.ts`, `src/renderer/src/commands/{index,descriptions}.ts`                           | Shared command IDs, existing handlers and localized descriptions.                                                          |
| `src/main/menu/{index,readingMode}.ts`, `src/main/menu/actions/view.ts`, `src/main/menu/templates/view.ts`        | Layout selection/registration, native submenu/radio state and permission-independent availability.                         |
| `static/locales/{de,en,es,fr,it,ja,ko,nl,pt,ru,tr,zh-CN,zh-TW}.json`                                              | Layout labels and Preview availability message, retaining locale key parity.                                               |
| `test/unit/specs/document-layout.spec.ts` (new), `test/unit/specs/source-code-image-action.spec.ts`               | Layout/state/permission/flush/autosave regressions; update the compiled-SFC fixture for its added Vue computed dependency. |
| `test/e2e/document-layout-preview.spec.ts` (new)                                                                  | Preview safety, rendering, search/copy/navigation, history, scroll, restart, command and byte-integrity acceptance checks. |
| `docs/MarkTextPlus1/stage-2a-layout-preview.md` (repository root; new)                                            | This report.                                                                                                               |

No Muya source, dependency manifests, lockfile, root README, packaging or production security settings changed.

## Automated verification

Commands ran from the repository root using the approved normal Windows runner and the existing environment-sanitizing Electron harness. No sandbox-disabling, web-security-disabling or GPU flags were added. Logs/artifacts are outside the checkout under `%TEMP%/MarkTextPlus1-stage2a-*`.

| Check                                      | Actual result                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm run build:unpack`                    | Passed after application/locale changes. Existing ineffective-dynamic-import notices remain. Log: `build-verified.log`. |
| `pnpm run typecheck`                       | Passed, including Muya declaration generation and the desktop application/test types. Log: `typecheck-verified.log`.    |
| `pnpm run lint`                            | Passed, **0 errors, 166 existing warnings**. Log: `lint-review.log`.                                                    |
| Focused layout/Reading/source units        | **31 passed**, five files. Log: `unit-targeted.log`.                                                                    |
| `pnpm run test:unit`                       | **1,220 passed, 36 existing skips; 120 files passed, 4 skipped**, exit 0. Log: `unit-verified.log`.                     |
| Broader desktop UI selection               | **114 passed**, exit 0, no skips; 6.4 minutes. Log: `regression.log`; command below.                                    |
| Final Preview-only acceptance rerun        | **13 passed**, exit 0; 47.5 seconds. Includes source-scroll and open-Find transitions. Log: `preview-final.log`.        |
| Protected-file diff and `git diff --check` | Passed at review time.                                                                                                  |

The final UI runs cover **115 distinct passing tests** overall: 114 in the broader selection, plus the newly added source-scroll case in the complete 13-test Preview rerun. The other Preview cases overlap the selection and are not counted twice. Rerunning the current selection command discovers 115 tests. No failing assertions remain in these completed runs.

Development failures were corrected and rerun, without weakening assertions or adding skips: an initial IPC guard edit had invalid syntax; the compiled-SFC test fixture lacked the new Vue computed dependency; the first full unit run caught 12 locale key-parity failures until all translations were added. Early UI fixtures used an invalid sub-second autosave delay, queried Muya's hidden syntax markers as ordinary heading text, created a local image after its first load, or tried to click a collapsed outline. The final rendering assertion checks both heading content and zero-sized syntax markers; the navigation test opens the actual outline first. No inherited failure is being used to excuse a new failure.

Reproduce the desktop selection:

```powershell
$stage2aSpecs = @(
  'document-layout-preview', 'viewer-mode', 'reading-mode', 'cli-read-only',
  'find-replace', 'command-palette', 'parity-source-undo-saved',
  'external-reload-undo', 'source-mode-flush', 'source-mode-menu-disabled-3531',
  'multi-folder-sidebar', 'folder-session-restoration', 'document-outline',
  'layout-toggles', 'context-isolation', 'launch', 'web-security', 'fixture-render'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @stage2aSpecs --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-review-results"
pnpm run test:unit
pnpm run typecheck
pnpm run lint
pnpm run build:unpack
```

Not run in this stage: the full repository desktop UI suite, Muya engine/browser/conformance suites, installer builds, other operating systems, physical IME/file-manager drop/accessibility/scaling checks or 1 MB performance profiling. Prior-stage results remain historical evidence. The broader desktop selection includes the existing Electron security checks, source/visual parity, Reading Mode, external reload/history, folder/session restoration and representative Markdown fixtures.

## Known limitations

Preview inherits the pinned Muya renderer's syntax support and rendering limits; this work does not claim full Markdown/Pandoc conformance. Runtime undo/redo continuity is preserved, but restart does not newly restore editor undo stacks. Source scroll is retained for layout round trips in memory, not newly serialized into sessions. Full physical IME, file-manager drag/drop, screen-reader and high-DPI acceptance remains manual. Split/live synchronization, a four-layout default preference and toolbar controls remain future work.

## Manual Windows acceptance

These manual checks have not been performed by the agent. Use disposable documents and save unrelated work first.

1. From a normal VS Code PowerShell terminal at the repository root, clear an inherited Electron Node-only environment flag if present, then build and launch:

   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm run build:unpack
   pnpm run start
   ```

2. Open a disposable Markdown fixture with headings, formatted text, a task, table, code block, local image, relative link, math and diagram content. Use View → Document Layout → Preview Only, then select Preview Only through the command palette. Verify rendering, theme, text selection/copy, scrolling, Find next/previous, internal links and outline navigation. Hover or focus the existing outline control if it is collapsed.
3. While the footer says **Edit Mode + Preview Only**, try typing, Ctrl+V, Ctrl+X, Delete, Ctrl+B, undo/redo, task clicks, drag/drop and formatting/insertion/replacement commands. Content must not change. Use a real Windows IME and OS drag/drop separately. Switch to Reading Mode and back: Preview must remain non-editable. Choose an editing layout explicitly; a locked document must remain locked.
4. Check Ctrl+E from WYSIWYG, Source and Preview. It should open Source, or return from Source to WYSIWYG, without changing permission. Confirm Source Code Mode and Document Layout menu states match the active tab. Verify existing customized shortcuts still work and Split is absent.
5. Edit Source, position its caret, scroll a long document, enter Preview and return. Verify text, caret, scroll and source undo/redo survive. Repeat with a single visual edit followed by Preview → WYSIWYG → undo/redo. With autosave enabled, enter Preview before its delay; the dirty text must stay in memory and the file must stay unchanged. Returning to an editor alone must not save it.
6. Give three tabs different layouts and Reading/Edit permissions; keep an editable tab dirty. With Startup Restore All and state restoration enabled, close normally using X, restart with `pnpm run start` and verify layouts, permissions, dirty content, folder roots and sidebar state. Disable state restoration and repeat: document layouts should follow the configured source/WYSIWYG startup default, while document permission and unsaved content remain intact.
7. Test light/dark themes, native/custom title bars, hidden tabs/sidebar, narrow windows, 100–200% display scaling and Narrator. The layout and permission labels must remain clear; Tab/Enter/Space must reach the mode and Preview exit controls. New translations need native-speaker wording review.
8. For no-op integrity, take this snapshot before opening an unchanged disposable file, perform the layout/permission transitions without editing, close normally, then compare:

   ```powershell
   $stage2aFile = 'C:\path\to\disposable.md'
   $stage2aBefore = [pscustomobject]@{
     Hash = (Get-FileHash -LiteralPath $stage2aFile -Algorithm SHA256).Hash
     Length = (Get-Item -LiteralPath $stage2aFile).Length
     ModifiedTicks = (Get-Item -LiteralPath $stage2aFile).LastWriteTimeUtc.Ticks
   }
   # Open, change layouts/modes without editing, and close the application.
   $stage2aAfter = [pscustomobject]@{
     Hash = (Get-FileHash -LiteralPath $stage2aFile -Algorithm SHA256).Hash
     Length = (Get-Item -LiteralPath $stage2aFile).Length
     ModifiedTicks = (Get-Item -LiteralPath $stage2aFile).LastWriteTimeUtc.Ticks
   }
   Compare-Object $stage2aBefore $stage2aAfter -Property Hash, Length, ModifiedTicks
   ```

   Expect no differences. Repeat with LF, CRLF, UTF-8 BOM, UTF-16LE BOM and trailing whitespace; save each fixture in VS Code before taking its initial snapshot.

## Interfaces planned for Stage 2B and 2C

Stage 2B can use the existing `split` identity and activation entry point once its host exists. It must introduce explicit pane capabilities: Source is the only editable authority, while the rendered pane is always read-only even when permission is Edit Mode. `isSourceLayout` currently means Source-only; it must not simply be reused to make both engines editable.

The future preview update contract should carry `{ documentId, revision, markdown, pathname }` plus existing render preferences. Commit source edits immediately, debounce only derived rendering and reject stale document/revision results. A preview update must never invoke the editor store's content-change or save paths. Keep CodeMirror mounted between Source and Split, retaining selection/history/scroll.

Stage 2A's Source → Muya handoff records an editing-history boundary. **Do not use that handoff for every live Split preview refresh.** Factor a render-only hydration path, or a dedicated read-only Muya host sharing the current rendering/options setup, while keeping WYSIWYG history intact. This is the main ownership constraint for Stage 2B.

For Stage 2C's eventual preferences/layout refinements, reuse the current per-tab `documentLayout` field, existing window layout store and preference schema/migration system. A future default-layout preference can supersede the legacy source startup fallback with an explicit compatibility rule. Divider ratio, pane order and synchronization belong in the existing layout/preference infrastructure, with bounded values and `restoreLayoutState` precedence. They are not implemented in 2A. Any further Stage 2C scope requires the owner's brief.

The three implemented layout command IDs already provide the stable menu/palette integration points for later layout controls or the separately planned toolbar. Split controls, scroll synchronization and toolbar work remain deferred. This report does not claim that the full Stage 2/split acceptance gate has passed.

## Targeted correction — Preview selection and clipboard

The Stage 2A implementation above was already present and uncommitted when this correction began. It has been preserved.

Manual Windows acceptance reported exposed Markdown delimiters, a formatting toolbar and incomplete Markdown on copy. Before changing application code, a new Electron regression selected the formatted paragraph in Preview and pressed Ctrl+C. It failed: expected `Bold text and italic text`, received `**Bold text** and *italic text*`. Evidence: `%TEMP%/MarkTextPlus1-stage2a-selection-repro.log`.

The clipboard cause is confirmed. Muya's `selection/TextSelection.ts` maps DOM selections to Markdown offsets; `clipboard/copyData.ts` slices/serializes Markdown for `text/plain`, including ordinary copy and rich copy. This remains intentional baseline behavior for WYSIWYG and Reading Mode in the visual layout, but is unsuitable for Preview's rendered partial selections. Syntax marker nodes remain in the editing DOM, normally hidden using zero dimensions/font size rather than removed from selection layout.

The current Preview read-only implementation already guards selection-driven rerendering in Muya's `TextSelection`, hides floating tools on lock and refuses `BaseFloat.show()` while read-only. The reported toolbar/marker exposure was not independently reproduced in this checkout's correctly locked Preview. Those guards are retained and tested with real pointer drags in both directions; the WYSIWYG editing experience is unchanged. No claim is made about which earlier build or layout produced the manually observed toolbar.

The correction is restricted to the desktop Preview host:

- `src/renderer/src/components/editorWithTabs/editor.vue`: Preview-only source marker layout rules and clipboard installation/disposal. Rendered math, ruby, emoji and entity containers are explicitly preserved because Muya also uses its `mu-hide` class on them. Explicit Copy as HTML goes through the Preview clipboard adapter; the existing Reading Mode route remains unchanged.
- `src/renderer/src/util/previewClipboard.ts` (new): a document capture listener handles only a non-collapsed native range entirely inside the active Preview. Search inputs, other panels and other layouts retain their own clipboard handling. Ordinary Copy and Copy as Rich use Chromium's rendered selection as `text/plain`, independent of direction. A cloned range supplies semantic HTML, including enclosing bold/italic formatting for partial selections. Editing artifacts and hidden source text are removed, Muya link spans become anchors, and the existing DOMPurify dependency sanitizes an explicit tag/attribute allowlist. The live document, engine state and native selection are never rewritten. Explicit Copy as HTML intentionally puts cleaned HTML source on the plain-text clipboard, retaining that command's meaning.
- `test/e2e/preview-selection.spec.ts` (new): full/partial bold and italic selections in both directions, pointer drags, plain/rich/HTML clipboard formats, WYSIWYG parity, rendered block copies, preservation of other inline renderings, dirty source history, lock protections, autosave suspension and byte/timestamp integrity.
- `test/unit/specs/preview-clipboard.spec.ts` (new): partial semantic HTML, unsafe HTML/artifact removal, live-DOM immutability and copy ownership for other layouts/panels/inputs.
- `test/e2e/document-layout-preview.spec.ts`: assert the startup source fixture has loaded before inserting at its expected final column; all existing content, caret, history and write-protection assertions remain.
- This report records the correction separately from the historical Stage 2A results above.

This is not a CSS-only clipboard workaround: Preview bypasses Muya's Markdown-offset clipboard serializer and cleans the rich payload as well. No Muya source, permission model, write path, dependency, lockfile, security configuration or normal WYSIWYG clipboard behavior was changed.

Plain-text block spacing follows Chromium's rendered selection. In the tested Muya DOM, list items have blank-line separation and table cells appear in reading order on separate lines; the HTML clipboard retains actual list/table structure. Clipboard consumers decide how to paste rich HTML. Full fidelity for diagrams, generated glyphs, images and mathematical layout in external applications is not claimed by these formatted-text regressions.

### Correction verification

Commands used the approved normal Windows runner and the existing isolated-profile Electron helper. No security flags, dependency changes or new skips were introduced. Correction logs and artifacts are under `%TEMP%/MarkTextPlus1-stage2a-selection-*`.

| Check                                         | Actual result                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-fix formatted-copy reproduction           | **1 failed**, expected: Markdown syntax was copied. `repro.log`.                                                                                                                                                                                                                                           |
| `pnpm run build:unpack`                       | Passed; existing ineffective-dynamic-import notices remain. `build-final.log`.                                                                                                                                                                                                                             |
| `pnpm run typecheck`                          | Passed, including Muya declaration emission. `typecheck-reviewed.log`.                                                                                                                                                                                                                                     |
| `pnpm run lint`                               | Passed, **0 errors, 166 existing warnings**, no new warnings. `lint-reviewed.log`.                                                                                                                                                                                                                         |
| `pnpm run test:unit`                          | **1,223 passed, 36 existing skips; 121 files passed, 4 skipped**. `unit.log`.                                                                                                                                                                                                                              |
| Final focused clipboard/layout units          | **11 passed** in two files after adapter/ownership refinements. `unit-final.log`.                                                                                                                                                                                                                          |
| Initial broader desktop selection             | **75 passed**, before the added inline-rendering case. `regression.log`.                                                                                                                                                                                                                                   |
| Final desktop selection with the desktop idle | **76 passed**, no skips or failing assertions, exit 0, **3.7 minutes**. `idle.log`; artifacts: `idle-results/`. Includes all six new Preview selection tests, the complete 13-test layout suite, Reading/Viewer protections, Find, source flush/history, encoding/timestamps and Electron security checks. |

An intervening 76-case UI run had **74 passes and two source/history failures** (`final.log`). A targeted ten-case repetition had **9 passes and one failure** (`source-repeat.log`). These failures must not be omitted: one repeated test caught unrelated text in its disposable source document **before its first automated edit**, failing the newly added initial-value assertion. The earlier malformed source edits were therefore not sufficient evidence of a new document transition defect. They occurred outside the Preview copy path; no application source/history behavior was changed to mask them. Foreground input interference is strongly indicated, although the individual origin of every earlier input was not captured. The user then explicitly agreed to leave the desktop idle for a clean rerun.

That complete idle-desktop rerun passed all **76** tests, including both previously failing source/history cases, with no retries or skips. There are no outstanding failures in the completed final checks. The broader suite and a user's simultaneous physical keyboard/clipboard activity share the same Windows desktop; leave those inputs idle when repeating this verification.

During test development, text-node traversal was corrected for Muya's inline wrapper spans, and block-copy expectations were set to Chromium's actual rendered spacing. Rich HTML assertions still require semantic formatting and clean payloads; document safety assertions were retained. No failed test was skipped or suppressed.

The correction does not newly rerun the complete repository desktop UI suite, Muya's standalone browser/conformance suites, installer builds or other operating systems. The engine and parser have not changed. External rich-text application pasting and physical desktop acceptance remain manual.

To repeat the correction's UI selection, leave the foreground desktop and system clipboard idle during the run:

```powershell
$previewCorrectionSpecs = @(
  'preview-selection', 'document-layout-preview', 'viewer-mode', 'reading-mode',
  'find-replace', 'parity-source-undo-saved', 'source-mode-flush',
  'context-isolation', 'web-security'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @previewCorrectionSpecs --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-selection-review-results"
```

### Manual retest on Windows

1. Close the running application, clear any inherited `ELECTRON_RUN_AS_NODE` in a normal PowerShell terminal, run `pnpm run build:unpack`, then `pnpm run start`. Previewing with `start` alone does not rebuild a previously launched version.
2. Open a disposable file containing `**Bold text** and *italic text*`, headings, links, lists, a table and a fenced code block. Select View → Document Layout → Preview Only and confirm the footer says **Preview Only**. Repeat in both Edit and Reading permission states.
3. Drag across all of Bold text, then part of it, in both directions. Repeat for italic text. Delimiters and the formatting toolbar must remain absent. Ctrl+C into Notepad must paste exactly the selected visible letters; into Word/LibreOffice or another rich-text target, check bold/italic and link/table formatting where supported. Try Edit → Copy as Rich and explicitly Copy as HTML separately.
4. Verify Find next/previous, scrolling, outline and links, then try typing, paste, cut, Delete, task toggles, drag/drop and formatting commands. Preview must remain protected. Repeat the selection after switching Preview → Source → WYSIWYG → Preview. Normal WYSIWYG may still expose syntax and copy Markdown as before.
5. Make an unsaved edit, enter Preview and select/copy repeatedly with autosave enabled. The dirty indicator must remain set. Return to the editor and verify undo/redo. Compare file hash and modification time using the snapshot procedure above; neither may change during Preview selection/copy. Check math, ruby, emoji and entities still render normally.

Physical mouse/clipboard interactions with external Windows applications remain a user manual acceptance check; automated tests read both native Windows clipboard formats through Electron.

## Targeted correction — restored layout and native-menu synchronisation

### Confirmed cause and lifecycle

The reported cold-restart mismatch was reproduced before changing application code. A disposable UTF-8 BOM/CRLF file was opened in WYSIWYG + Reading Mode, its window was closed normally through `BrowserWindow.close()` (the X-button lifecycle), and a new Electron process started with the same isolated profile and no document/layout command-line override. The saved tab contained `documentLayout: 'wysiwyg'` and `readOnly: true`. After restart, the footer and editor host reported WYSIWYG, while the native radio vector for WYSIWYG/Source/Preview was **`[false, false, true]`** instead of `[true, false, false]`. The regression failed at that native-menu assertion. Evidence: `%TEMP%/MarkTextPlus1-stage2a-layout-sync-repro.log` and `repro-results/`.

The defect is in `main/menu/index.ts::_applyDocumentMode`, not session persistence or bootstrap ordering. Electron's runtime radio-item setter **selects the item even when assigned `false`**. An isolated two-item native menu confirmed that setting the second item's `checked` property to `false` changed the group from `[true, false]` to `[false, true]` (`diagnostic.log`). The application loop assigned `item.checked = layout === value` to every layout radio. Its final assignment therefore always selected Preview. This affected menu refreshes, focus, rebuilds and tab changes as well as restoration. Preview appeared correct only when it was also the actual layout.

The full pipeline was reviewed:

1. `renderer/src/store/editor.ts::createBufferedTab` retains the optional recognised layout and the independent `readOnly` permission. `store/bufferedState.ts` writes the existing version 3 session snapshot; normal shutdown flushes the active editor and awaits that snapshot. No session schema or existing data is replaced.
2. `main/windows/editor.ts` creates the editor menu, sends `mt::bootstrap-editor`, reads the buffered session, reloads existing files and sends `mt::load-state`. File reload preserves dirty buffers and their tab metadata. The main process does not choose Preview merely because a document is locked.
3. `RESTORE_BUFFERED_STATE` recreates tabs, honours `restoreLayoutState`, restores the active tab ID and independent Reading/Edit permissions, and uses the existing startup source/WYSIWYG preference when layout restoration is disabled. No layout migration or bootstrap change is needed.
4. The editor-store layout getters drive `editorWithTabs/index.vue`, the footer, the Muya/CodeMirror host and Preview clipboard adapter. The command palette uses the same store capabilities; it offers layout commands rather than maintaining a separate selected-layout flag. Reading WYSIWYG therefore correctly continued using its inherited Markdown-aware copy path in the reported mismatch.
5. `pages/app.vue` watches the active tab ID, permission and resolved layout and publishes them through `mt::update-document-mode`. `AppMenu` caches that state by sender window and reapplies it after updates/rebuilds. The cached layout reached the menu correctly; assigning false to the other radio items corrupted only its displayed selection. Clicking the misleadingly checked Preview item still sent the real layout command, explaining why the footer and clipboard then changed together.

### Changes

- `packages/desktop/src/main/menu/index.ts`: select only the matching layout radio with `checked = true`; Electron clears the other members. Preserve all existing enabled-state, Source checkbox, Reading Mode, cached-window and menu-rebuild logic. This is the only application-code change for this correction.
- `packages/desktop/test/e2e/document-layout-restoration.spec.ts` (new): real normal closes and cold restarts for all three layouts, exact native radio vectors, persisted tab fields, immediate Preview/WYSIWYG clipboard behavior, mixed permission/layout tabs, restored dirty buffers, source history after restoration, autosave protection, palette restrictions, menu rebuilds, new documents and startup-preference precedence. File snapshots compare bytes and modification times.
- `packages/desktop/test/e2e/document-layout-preview.spec.ts`: every existing layout-switch helper now also checks the entire native radio group, rather than relying on the footer or checking only Preview's positive radio state. The previous tests missed false selections on the other members.
- This report records the cause, verification and manual retest steps.

No renderer layout state, persistence format, clipboard implementation, Reading Mode safeguard, editor engine, dependency, packaging or security setting is changed. This correction stops at Stage 2A.

### Synchronisation verification

All logs/artifacts for this correction are outside the checkout under `%TEMP%/MarkTextPlus1-stage2a-layout-sync-*`. Electron uses the approved normal Windows runner, the unchanged isolated-profile/environment helper and the existing production security settings. No timeout increases, disabled assertions, new skips or arbitrary startup delays were added. The intentional autosave check waits beyond its configured one-second autosave interval; all layout/menu/startup checks wait on observable state.

| Command/check                                                                         | Actual result                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-fix cold-restart regression                                                       | **1 failed**, expected: persisted/restored WYSIWYG disagreed with the Preview radio. `repro.log`.                                                                                                                                                                            |
| Isolated native-radio diagnostic                                                      | Assigning `false` to radio B selected B: `[false, true]`. The application regression remained failing before the fix. `diagnostic.log`. The temporary diagnostic was removed from the final test file.                                                                       |
| `pnpm run build:unpack`                                                               | Passed. Existing build notices remain. `build.log`.                                                                                                                                                                                                                          |
| `pnpm run typecheck`                                                                  | Passed again after the final test additions. `typecheck-final.log`.                                                                                                                                                                                                          |
| `pnpm run lint`                                                                       | Passed after the final test additions, **0 errors, 166 existing warnings**, no new warnings. `lint-final.log`.                                                                                                                                                               |
| `pnpm run test:unit`                                                                  | Initial parallel run: **1,221 passed, 2 failed, 36 existing skips**. An unchanged PDF test exceeded its 20-second dynamic-import timeout, followed by a missing mocked `window.marktext.paths` surface. `unit.log`. No PDF or application code was changed for this failure. |
| `pnpm -C packages/desktop exec vitest run test/unit/specs/pdf.spec.ts`                | **17 passed** in isolation. `pdf-isolated.log`.                                                                                                                                                                                                                              |
| `pnpm -C packages/desktop exec vitest run test/unit --maxWorkers=2`                   | **1,223 passed, 36 existing skips; 121 files passed, 4 skipped**, exit 0. Limits worker contention without changing test assertions or timeouts. `unit-bounded.log`.                                                                                                         |
| Seven dedicated cold-restart/mixed-tab cases                                          | **7 passed**, exit 0, 42.2 seconds. `restoration.log`.                                                                                                                                                                                                                       |
| Broader 83-case desktop selection                                                     | **81 passed, 2 fixture timeouts**, exit 1, 5.1 minutes. The two expanded palette cases are covered by the corrected final rerun below. `regression.log`.                                                                                                                     |
| Final cold-restart suite, including editor capabilities and palette layout activation | **7 passed**, exit 0, 35.9 seconds; no retries or skips. `final.log`; artifacts: `final-results/`.                                                                                                                                                                           |

The first post-fix test-development run passed the three clean-file restart cases but timed out in the four mixed-tab cases, with worker teardown timeouts, because the fixture attempted to close a dirty Reading Mode tab without answering its expected native confirmation (`targeted.log`). The fixture now keeps the dirty buffer editable for the normal Restore All restart and explicitly locks it after recovery for safeguard checks. This respects the existing shutdown policy; the application confirmation, saved-session behavior and Reading Mode code were not bypassed or changed. The existing Viewer Mode regression separately tests Cancel followed by recovery of a locked dirty buffer. The corrected tests retained their original timeout and all document/menu/integrity assertions.

The broader run's two fixture timeouts came from closing and immediately reopening the command palette while its close lifecycle cleared the active command. The final test checks formatting availability, changes the query in that same open palette, executes the WYSIWYG command and verifies the resulting layout/menu/permission. It introduces no delay or application change. The final seven-case rerun passed, including both previously failing cases and the added actual editor read-only assertions. Together, the completed runs verify **83 distinct passing UI cases**; five of the seven final cases overlap the 81 broader passes and are not counted twice. There are no remaining failing cases in the completed final verification. The unrestricted unit run's host-sensitive PDF import timeout remains recorded; the unchanged PDF file and the entire two-worker suite passed.

Reproduce the selected UI regressions with the desktop/clipboard idle:

```powershell
$layoutSyncSpecs = @(
  'document-layout-restoration', 'document-layout-preview', 'preview-selection',
  'viewer-mode', 'reading-mode', 'find-replace', 'parity-source-undo-saved',
  'source-mode-flush', 'context-isolation', 'web-security'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @layoutSyncSpecs --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-layout-sync-review-results"
```

Not newly run for this correction: the entire desktop UI repository, Muya standalone browser/conformance suites, installer builds or other operating systems. Physical Windows menu inspection and external Notepad/Word pasting remain manual acceptance checks. Undo stacks are not newly restored across restart; dirty content, layout and permission restore independently of runtime history.

### Windows manual retest

1. Close MarkText+1 normally. From a normal VS Code PowerShell terminal at the checkout root, run:

   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm run build:unpack
   pnpm run start
   ```

2. In Preferences → General, select Startup action **Restore All** and enable **Restore previous editor state**. Open a disposable Markdown file containing `**Bold text** and *italic text*`. Choose View → Document Layout → **Visual Editor (WYSIWYG)**, then Reading Mode. Close using the window's X button and restart with `pnpm run start`.
3. Before selecting any layout command, check that the footer says WYSIWYG, only WYSIWYG is checked in View → Document Layout, and Reading Mode remains on. The visual editor retains its existing Markdown-aware copying behavior.
4. Repeat with **Preview Only**, first in Reading Mode and then Edit permission. After each restart, Preview must already be active in both places. Select Bold text and copy directly to Notepad/Word without reselecting Preview: plain text must be `Bold text`, rich formatting should be retained, and editing controls must remain absent.
5. Repeat with **Markdown Source**. The source pane and its menu item must be active immediately, and the existing Ctrl+E/Source Code Mode checkbox must agree. Reading Mode must still prevent edits.
6. Restore three tabs with different layouts and Reading/Edit permissions, including one unsaved source buffer in Edit Mode with autosave off. Switch between them repeatedly and check footer, all layout radios and permission. Open the command palette in restored Preview: formatting must be labelled unavailable in Preview, while layout commands remain usable. Change theme to trigger a menu rebuild, open a fresh file, and create an untitled document. Menu state must continue following the active document; fresh documents use the configured startup layout and untitled documents remain editable. A dirty Reading Mode document still requires the existing Save/Don't Save/Cancel decision on normal close; use Cancel to retain its unsaved changes in the running application.
7. Disable **Restore previous editor state**, repeat a restart with startup Source mode enabled and then disabled. Stored document layouts should yield to the configured Source/WYSIWYG fallback; Reading/Edit permissions and recovered dirty content must remain intact. Re-enable the preference afterwards if desired. Undo stacks are still runtime state, not newly persisted across restart; a new edit after restart must undo/redo normally across Preview transitions.
8. With autosave enabled, keep a dirty buffer in Preview/Reading Mode past its autosave interval and verify it stays dirty and unchanged on disk. Repeat the hash/length/modification-time comparison above using BOM, CRLF and trailing-whitespace fixtures. No layout, selection or copy action may write the file.

## Sidebar tab promotion and File Open directory correction

### Findings and scope

Both affected paths are present in the approved `d7c3baf3` baseline. They were not introduced by Stage 2A's layout or clipboard changes. The sidebar preview machinery came from upstream commit `9083162f` (preview tabs for sidebar files, #2395 / #5820). No branch/tag switch was needed to establish this: the corresponding baseline source was inspected with `git show` and compared with the working changes.

An italic filename means a **temporary sidebar preview tab** (`isPreview`), independently of the document's **Preview Only layout** (`documentLayout: 'preview'`). A single click is intended to reuse that temporary tab. Neither changing layout nor changing Reading/Edit permission should promote it. Editing its contents or explicitly opening/pinning it makes it permanent.

The ordinary three-file double-click test passed before the correction. A controlled desktop test reproduced a real race without relying on timing sleeps: hold the first file's `mt::open-new-tab` delivery, double-click that file, single-click another file, then deliver the held response. The double-clicked file disappeared instead of becoming permanent.

The cause spans both processes:

1. The first click sends a preview request with a request ID. Double-click calls `FOCUS_FILE` / `PROMOTE_SIDEBAR_OPEN`.
2. Promotion previously changed only the renderer's open intent. The main process still regarded the request as an expendable temporary preview.
3. A subsequent sidebar request becomes the latest request. Main could discard the older response while its disk read was pending. Even if main had already sent it, the renderer's stale-response guard could discard the queued response before consulting the promoted intent.

This is an inherited ownership race, rather than evidence that a document layout changes tab ownership. The fix retains the existing single-click/double-click handlers and temporary-tab behavior.

File Open previously called `dialog.showOpenDialog` with file filters and selection properties **but no `defaultPath`**. It neither applied `defaultDirectoryToOpen` nor looked up the recent-file directory. The latter preference is explicitly labelled as a startup-folder option in General preferences. There is no separate fixed File Open directory preference. Windows was therefore responsible for the initial native location. The user's specific campaign-directory choice was not reproduced against their real profile, and its OS-history provenance is not established. The automated reproduction establishes the application-side omission: even after a successful open, the next dialog's `defaultPath` was `undefined`.

### Changes

Pending tab promotion now sends a typed `mt::promote-pending-preview` event. Main derives the editor window from the sender, promotes that window's pending request and retains its asynchronous load independently of later preview requests. The renderer remembers promoted request IDs until delivery so that a message already queued with its original preview options is also retained. Unpromoted stale previews continue to be discarded. A request generation invalidates pending reads on reload/destroy, including late failures, so promotion cannot reopen a file in a replacement renderer or notify a destroyed window. No document permissions, contents or undo state are changed by promotion.

Explicitly reopening an existing document continues to reuse its tab. It now pins a temporary tab and refreshes recent-file history **after the renderer confirms the tab exists**, preserving its layout, Reading/Edit permission and buffer. This also covers File Open returning to an already-open file in a different directory. A pending main-process file reservation alone is not treated as proof that an open succeeded.

File menu, command and existing IPC entry points now route the individual-file chooser through the application service, which has access to current preferences and the existing persistent recent-document store. Directory precedence is:

1. Parent directory of the newest successfully opened, still-existing **file** in recent history. Recent folders and unavailable files are excluded.
2. The existing configured `defaultDirectoryToOpen`, if Startup action is **Open default directory** (`folder`) and that directory exists. It is a fallback, not a fixed override of every later Ctrl+O. An inactive startup-folder setting is not repurposed as a File Open preference.
3. Windows/native dialog selection when neither is available.

Only accepted selections proceed to normal document loading. New files enter recent history through the existing successful-load path; an explicit refocus updates history through the existing recent-document IPC. Cancellation, including a cancellation result carrying paths, does not open a file or remember the returned directory. Invalid/missing history entries cannot supply a default. Existing recent-history persistence and clearing semantics remain in use; there is no new preference key or storage file. Restore All and multiple-file loads retain their existing recent-history ordering behavior.

Save As, import, export, folder-opening dialogs, startup options, production security settings, package versions and lockfile are unchanged by this correction. No sidebar component rewrite or new layout feature was necessary.

Files changed **for this correction** (other uncommitted Stage 2A work remains in place):

| File                                                                  | Purpose                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/desktop/src/renderer/src/store/editor.ts`                   | Retain promoted pending requests; explicitly reopened tabs retain their state and refresh recents.                                               |
| `packages/desktop/src/main/windows/editor.ts`                         | Promote pending loads and preserve permanent requests across later preview selections.                                                           |
| `packages/desktop/src/main/app/windowManager.ts`                      | Route promotion to the sender's editor window.                                                                                                   |
| `packages/desktop/src/shared/types/ipc.ts`                            | Typed promotion and internal chooser channels.                                                                                                   |
| `packages/desktop/src/main/menu/actions/file.ts`                      | Route existing File Open entry points to the application service.                                                                                |
| `packages/desktop/src/main/app/index.ts`                              | Resolve individual-file chooser defaults and reject canceled selections.                                                                         |
| `packages/desktop/src/main/menu/fileOpenDirectory.ts`                 | Directory precedence using existing preferences/history.                                                                                         |
| `packages/desktop/test/unit/specs/editor-preview-tab.spec.ts`         | Pending promotion, layout/permission independence and explicit reopening.                                                                        |
| `packages/desktop/test/unit/specs/file-open-directory.spec.ts`        | Recent-file, startup-folder and invalid-path precedence.                                                                                         |
| `packages/desktop/test/unit/specs/editor-window-preview-open.spec.ts` | Main-process pending-read promotion, cancellation and reload/close lifetime, including late read failures.                                       |
| `packages/desktop/test/e2e/issue-2395-preview-tabs.spec.ts`           | Multiple double-clicks, both pending boundaries, mixed layouts/permissions, dirty recovery and integrity.                                        |
| `packages/desktop/test/e2e/file-open-directory.spec.ts`               | Real menu/command entry points with intercepted native dialog results; repeated open, cancellation, reopening and persistent-history precedence. |
| `packages/desktop/test/e2e/sidebar-auto-reveal-528.spec.ts`           | Make existing sidebar regression selectors work with Windows backslashes, retaining their original assertions.                                   |
| `docs/MarkTextPlus1/stage-2a-layout-preview.md`                       | Findings, evidence, results and manual acceptance steps.                                                                                         |

### Verification

All desktop sessions use disposable files and isolated profiles with the approved normal Windows runner. Electron environment sanitation and production sandbox/security settings remain unchanged. The slow-open regressions hold a read or IPC delivery and release it after the next selection; they add no startup sleep or weakened assertion. Dialog tests intercept only native chooser results/options and exercise the real menu/command, file-loading, tabs and persistence paths. Physical chooser navigation remains a manual check.

Logs and final UI artifacts are outside the checkout under `%TEMP%/MarkTextPlus1-stage2a-*`. The following results were performed in this working checkout; no earlier user-reported build/launch is counted as a performed test.

| Command / run                                                                                                                                                     | Actual result                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -C packages/desktop exec playwright test test/e2e/issue-2395-preview-tabs.spec.ts --grep 'three distinct\|promoted pending' --reporter=line` before the fix | **1 passed, 1 failed**: delayed promoted alpha was missing. `sidebar-before.log` suffix.                                                                                                                                                                                                              |
| `pnpm -C packages/desktop exec playwright test test/e2e/file-open-directory.spec.ts --reporter=line` before the fix                                               | **1 failed** after fixture setup was corrected: second dialog's `defaultPath` was undefined. `file-open-before.log` suffix.                                                                                                                                                                           |
| First post-fix sidebar/dialog run                                                                                                                                 | **9 passed**. `sidebar-focused.log` suffix. Additional regression cases were then added.                                                                                                                                                                                                              |
| `pnpm -C packages/desktop exec vitest run --maxWorkers=2`                                                                                                         | **1,235 passed, 36 existing skips; 123 files passed, 4 existing skipped files**. No newly skipped tests. `sidebar-unit-final.log` suffix.                                                                                                                                                             |
| Six focused main-process ownership tests                                                                                                                          | **6 passed**, including successful/failed reads invalidated by reload/destroy. Included in the full unit total, not additional tests. `sidebar-main-ownership.log` suffix.                                                                                                                            |
| `pnpm run build:unpack` after the final lifetime guard                                                                                                            | **Passed**, including main, preload and renderer. Existing build notices remain. `sidebar-build-owned-lifetime.log` suffix.                                                                                                                                                                           |
| `pnpm run typecheck` after final source/test edits                                                                                                                | **Passed**. `sidebar-typecheck-final.log` suffix.                                                                                                                                                                                                                                                     |
| `pnpm run lint` after final source/test edits                                                                                                                     | **Passed: 0 errors, 166 existing warnings**. No new warnings. `sidebar-lint-final.log` suffix.                                                                                                                                                                                                        |
| Initial broader 112-case UI run                                                                                                                                   | **107 passed, 5 failed**: four new fixture errors and one build-overlap launch failure, described below. `sidebar-ui.log` suffix.                                                                                                                                                                     |
| Stable-build broader 120-case UI run                                                                                                                              | **115 passed, 4 failed, 1 did not run**. All four failures and the one blocked by its `beforeAll` were in the inherited Windows auto-reveal fixture. All other cases, including new sidebar/dialog cases, passed. `sidebar-ui-final.log` suffix.                                                      |
| Final rebuilt application: sidebar/dialog/auto-reveal focused run                                                                                                 | **18 passed**, including all five auto-reveal cases, both pending-open boundaries, three permanent tabs, explicit reopening, mixed-layout dirty recovery and chooser precedence/cancellation. `sidebar-focused-final.log` suffix; artifacts in `MarkTextPlus1-stage2a-sidebar-focused-final-results`. |

The broader run used the completed build with output held unchanged. Ownership unit review subsequently added the request-generation guard; that final source was built after the broader UI process exited and verified by the final 18-case run. Together the completed runs establish **120 distinct passing UI cases**: the 115 broader passes plus five corrected auto-reveal cases. Thirteen final focused cases overlap broader passes and are not counted twice. There are no unresolved failures or unverified cases within this selected UI set. The temporary `beforeAll` exclusion was rerun successfully, rather than configured as a skip.

The selected cases cover original sidebar single-click previews; warm/cold double-click promotion; stale/unpromoted requests; already-open documents; preview-disabled and hidden-tab-bar preferences; layout/permission independence; normal and `pnpm run start` restarts; project roots, expansion, visibility and width; unsaved recovery; Find; WYSIWYG/Source history; Preview and Reading Mode clipboard/mutation protection; autosave and main-process write guards; BOM, CRLF, whitespace and timestamps; and context isolation/web security. No dependency or security adjustment was used to obtain a pass.

Reproduce the full selected UI set **after** the build finishes, with the desktop/clipboard idle:

```powershell
pnpm run build:unpack
$sidebarReviewSpecs = @(
  'issue-2395-preview-tabs', 'file-open-directory', 'sidebar-focus-model',
  'sidebar-auto-reveal-528', 'issue-2421-sidebar-state', 'issue-5631-folder-collapse',
  'multi-folder-sidebar', 'folder-session-restoration', 'document-layout-restoration',
  'document-layout-preview', 'preview-selection', 'viewer-mode', 'reading-mode',
  'find-replace', 'parity-source-undo-saved', 'source-mode-flush',
  'context-isolation', 'web-security'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @sidebarReviewSpecs --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-sidebar-review-results"
```

The final focused command was:

```powershell
pnpm -C packages/desktop exec playwright test test/e2e/issue-2395-preview-tabs.spec.ts test/e2e/file-open-directory.spec.ts test/e2e/sidebar-auto-reveal-528.spec.ts --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-sidebar-focused-final-results"
```

Not newly run for this correction: the entire desktop UI repository, Muya's standalone browser/conformance suites, website checks, installer builds, Linux/macOS or physical native-dialog navigation. These are not represented as passing. The earlier section's no-commit and Stage 2B/2C deferral remain in force.

Development failures retained for transparency:

- Before the fix: one of two sidebar reproduction tests failed because the promoted file was absent; the ordinary three-file case passed. The corrected File Open fixture failed because the second chooser's default directory was undefined.
- Initial File Open fixture attempts used synthetic renderer Ctrl+O input and a hidden tab bar. The final fixture invokes the actual File Open menu and IPC command and verifies the unchanged native `Ctrl+O` accelerator. Physical keyboard dispatch is covered by manual steps below.
- An initial type-check rejected the chooser stub's incomplete overload; the stub now handles both Electron call signatures. Lint rejected a test-only `require` import; the final test obtains Node's built-in filesystem module in the main-process test context. These were new test-code issues, not inherited application failures.
- The first broader UI run encountered two folder-only fixture waits for an editor that should not exist, two test-context `require` failures, and a launch during a rebuild that temporarily removed `out/renderer/index.html`. The fixture waits now observe the menu/project instead, the builtin accessor replaces `require`, and final verification runs after the build with output held unchanged. The launch failure was caused by test/build sequencing, not an application security or runtime-dependency change. No assertions or failures were skipped.
- Ownership review added lifecycle tests before finalizing the fix. Initially two failed: a promoted read could complete after reload or target a destroyed window. The generation guard resolves both and also ignores read failures belonging to an invalidated window session. The focused six-case ownership suite passes; these were issues in the initial correction, not claims about the approved baseline.
- The additional existing auto-reveal suite interpolated raw Windows paths into CSS selectors. Backslashes were interpreted as CSS escapes; its collapse helper returned false for a missing match, so required subfolders were never expanded. Exact title locators replace those interpolations in the test helpers, including visibility/collapse queries. The tab-click fixtures also explicitly enable the tab bar they require. All original assertions remain. This is an inherited Windows fixture defect; no sidebar application change was made for it.

### Manual Windows verification

Use disposable documents and record your preferences before changing them. Close MarkText+1 normally, honoring any unsaved-change prompts, before building. To avoid altering your real session or recent history, use an isolated acceptance profile:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm run build:unpack
$acceptanceProfile = Join-Path $env:TEMP ('MarkTextPlus1-sidebar-review-' + [guid]::NewGuid().ToString('N'))
pnpm run start -- --user-data-dir "$acceptanceProfile"
```

For subsequent restarts reuse that same `$acceptanceProfile` value. Do not run a build while automated desktop tests are active.

1. Create a disposable folder A with `alpha.md`, `beta.md`, `gamma.md` and a folder B with `other.md`. Include bold/italic text, trailing spaces and at least one BOM/CRLF file. In the isolated app enable sidebar preview tabs, Restore All and Restore previous editor state. Disable autosave while testing dirty recovery. Select Reading Mode as the default for existing files, and keep folder/file opens in the same window for this check.
2. File → Open Folder → A. Single-click alpha then beta. Confirm one italic temporary tab is replaced. Double-click the current beta, then double-click alpha and gamma. Confirm three permanent, non-italic tabs remain. Repeat using your normal Windows double-click speed, both on unopened files and on an existing temporary tab. Reopening any of those files must focus its existing tab without creating a duplicate.
3. In a fresh single-click temporary tab choose Preview Only, Source and WYSIWYG in turn. Layout switching and Reading/Edit switching alone must not pin it. Double-click must pin it while retaining its selected layout and permission. Editing an editable temporary tab must still pin it normally.
4. Leave alpha in Preview/Reading, beta in Source/Edit and gamma in WYSIWYG/Reading. Make an unsaved source edit in beta. Switch repeatedly through the sidebar and tabs, then reopen beta through File Open. Check layout/footer/menu, permission and the unsaved text. Undo/redo must work as before during this running session; reopening must neither replace the buffer nor create a second beta tab.
5. Close normally with X and restart using `pnpm run start -- --user-data-dir "$acceptanceProfile"`. Confirm all three permanent tabs, folder root/tree/sidebar state, layouts and permissions restore, and beta's unsaved text remains dirty. Undo history is still runtime state; this correction does not add cross-restart history persistence. Do not select Save/Don't Save if the application presents a dirty Reading Mode confirmation unless you intend that action; Cancel preserves the running buffer.
6. Press physical Ctrl+O, navigate to folder B and successfully open `other.md`. Press Ctrl+O again: the native chooser should start in B. Cancel it. Repeat through File → Open: it should still start in B. Navigate to A but cancel without opening a file: the next chooser should still start in B. Now open alpha from A, which is already open: it should focus the same alpha tab, retain Preview/Reading, and the next chooser should start in A.
7. To check startup preference precedence without deleting real history, create a **second fresh isolated profile** using the command above with a new profile value. Choose a valid Open default directory startup folder, exit and restart with that profile. Before opening any document, File Open should start there. Once a file in another directory is successfully opened, that file's directory should take precedence. Switching startup action away from `folder` must not turn the saved startup path into a fixed File Open override. With no valid file history and no selected startup folder, Windows chooses the initial location.
8. Compare original files before/after navigation, copying, layout switching and restart. For each disposable path use `Get-FileHash -Algorithm SHA256 -LiteralPath <path>` and `Get-Item -LiteralPath <path> | Select-Object Length,LastWriteTimeUtc`. Hash, length and modification time must match until an explicit save is requested. An unsaved beta edit must stay only in its recovered buffer. Confirm ordinary Save As/export/folder-opening behavior separately if those dialogs are part of your workflow.

Remaining manual scope: the physical Windows chooser's displayed folder, actual Ctrl+O dispatch from the keyboard, deliberately slow/network filesystem behavior and external Notepad/Word clipboard acceptance. The original campaign-directory OS history has not been inspected or modified. Split View and toolbar work remain deferred, and no commit is created.

## Physical double-click correction: sidebar geometry

### Reproduction and confirmed cause

This is separate from the pending-open ownership race above. The coordinate-based desktop test reproduced the actual mis-targets **before changing application code**: alpha's second click hit FolderA, and beta's second click hit alpha. The previous `locator.dblclick()` tests did not establish stability between two spaced clicks at a fixed pointer position.

The cause is the height of **Opened files**, above the folder explorer. `useOpenedFilesResize.ts` intentionally sizes that list to its current tab count, up to the preferred height: its rows are 28 pixels high. The first click opens a preview immediately. When it adds a tab, the list grows and pushes the entire folder tree down before the second click. The file rows do not need to be reordered or replaced for this to happen. The same sizing code is present in approved baseline `d7c3baf3`; this is an inherited sidebar layout defect rather than a Stage 2A document-layout or pending-promotion regression.

Recorded pre-fix geometry, in renderer CSS pixels:

| First-open target                        | Row top before → between clicks | Tree top before → between clicks | Tree scroll offset | Opened-files list height | Second click at original coordinates |
| ---------------------------------------- | ------------------------------- | -------------------------------- | ------------------ | ------------------------ | ------------------------------------ |
| alpha                                    | 156 → 184                       | 126 → 154                        | 0 → 0              | 28 → 56                  | FolderA                              |
| beta                                     | 186 → 214                       | 126 → 154                        | 0 → 0              | 28 → 56                  | alpha                                |
| gamma, opened first with an existing tab | 216 → 244                       | 126 → 154                        | 0 → 0              | 28 → 56                  | beta                                 |
| alpha, scrolled to middle                | 445 → 473                       | 126 → 154                        | 611 → 611          | 28 → 56                  | preceding filler file                |
| beta, scrolled to middle                 | 445 → 473                       | 126 → 154                        | 641 → 641          | 28 → 56                  | alpha                                |
| gamma, scrolled to middle                | 445 → 473                       | 126 → 154                        | 671 → 671          | 28 → 56                  | beta                                 |

Although the user perceived upward movement, these captures establish a **downward 28-pixel shift of the tree**. That puts the preceding row under the original pointer, matching the observed alpha/FolderA and beta/alpha results. Turning `autoRevealInSidebar` off still reproduced it. Hiding Opened files prevented it. The nonzero-scroll captures also show that `focusTree()` did not reset the scroll offset in this reproduction. Ancestor expansion, sorting changes and the scroll-to-visible calculation were not required to trigger it.

Gamma's behavior depends on the existing tab count/allocation, not its filename. It can reproduce when opened first with one existing document. Once the list reaches its preferred height, further tabs need not grow it; crossing the four-row resize-handle threshold is a separate small height change. The tests now cover that threshold too. The user's precise initial allocation is not inferred from the report.

The earlier promotion fix can only preserve an open that receives a promotion request. If the second mouse click lands on FolderA or another file, the intended file never receives the double-click. Both fixes are therefore needed.

### Scoped correction

`tree.vue` records the actual Opened files section height on a primary tree mousedown and holds that allocation while the pointer gesture is unresolved. Tab loading and temporary/permanent state continue normally; extra list entries remain scrollable. The tree's viewport and rows stay in place before the second click.

The hold ends after the double-click, on pointer departure, intentional wheel/keyboard input in the tree, a window resize/blur, hiding/changing the sidebar view, changing the opened-files preference or section expansion, or an explicit Show in Side Bar command. A completed file double-click reapplies the existing preference-aware reveal operation after layout settles, so a row near the bottom remains fully visible. Folder/root double-clicks do not force the active file's ancestors open. The existing “already visible” scroll calculation is unchanged.

There is **no production timeout, delayed preview load, new double-click interval, permanent reserved blank space or change to saved resize preferences**. After a single click, the list can remain at its prior allocation while the pointer stays in the tree; moving out or using an interrupting action restores the normal allocation. This is the intended transient behavior that protects a possible second click. The hold is component-local UI state, never part of a document, preference or buffered session snapshot. Window listeners are removed on unmount.

Files changed for this correction only:

- `packages/desktop/src/renderer/src/components/sideBar/tree.vue` — transient allocation hold, release lifecycle and post-double-click reveal.
- `packages/desktop/test/e2e/sidebar-pointer-gesture.spec.ts` — new fixed-coordinate first-open/scroll matrix, frame/click records, gesture interruption and no-write checks.
- `docs/MarkTextPlus1/stage-2a-layout-preview.md` — this evidence and acceptance record.

The previous uncommitted corrections remain in place. No editor, command, permission, persistence or file-writing implementation is changed by this correction. Dependencies, root README, security configuration, packaging and branding are unchanged; Stage 2B is not implemented and no commit is created.

### Coordinate test method and verification

Each gesture measures the target once, sends the first browser mouse click, records row/tree coordinates and scroll offsets on animation frames for a 120 ms inter-click cadence, then sends **one** second down/up pair with click count 2 at the unchanged pointer position. The cadence models a normal spaced double-click; it does not wait for application success or conceal a race. The test checks two trusted click events with details `[1, 2]`, elapsed time under 500 ms, matching intended targets, no intermediate row/tree/scroll movement, permanent ownership, full post-gesture visibility when auto-reveal is enabled, and unchanged file bytes/timestamps. No locator action follows the target between the two clicks.

The 23 new cases include sequential alpha/beta/gamma opens from an untitled or existing document, independent first opens of each file, nine combinations of target and top/middle/bottom scroll position, the resize-handle threshold, both auto-reveal/opened-files controls, and six single-click release paths. Single-click releases also verify that previews still replace one another and that the user's saved opened-files height is untouched. Geometry JSON is written outside the checkout to the configured Playwright output directories.

All following checks were performed with the approved Windows runner, isolated profiles and disposable documents. Logs/artifacts are outside the checkout under `%TEMP%/MarkTextPlus1-stage2a-pointer-*`.

| Command / run                                                 | Actual result                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corrected two-click reproduction before the fix               | **2 failed**: sequential beta hit alpha; first additional alpha hit FolderA. `pointer-before.log`.                                                                                                                                                                                                              |
| Eight-case exploratory control run before the fix             | **7 failed, 1 passed**. Auto-reveal off still moved the tree; opened-files off passed. The then-zero-offset filler variants are excluded from the genuine scrolled evidence above. `pointer-evidence-before.log` and its results directory.                                                                     |
| Three genuinely scrolled middle-position cases before the fix | **3 failed**, all with +28 px row/tree movement and unchanged nonzero scroll offsets. `pointer-scrolled-before.log` and results.                                                                                                                                                                                |
| `pnpm run build:unpack`                                       | **Passed** for main, preload and renderer; existing build notices remain. `pointer-build.log`. The final build finished before UI verification; output was not rebuilt during the UI runs.                                                                                                                      |
| New coordinate/release spec                                   | **23 passed**. `pointer-focused.log`; per-gesture JSON in `pointer-focused-results`.                                                                                                                                                                                                                            |
| Broader selected desktop UI command below                     | **102 passed**, including all 23 new cases, all five auto-reveal and all 15 opened-files resize regressions, prior pending-open/directory tests, restored mixed layouts, dirty recovery, Reading Mode, clipboard and no-op integrity. `pointer-regression.log`; JSON/artifacts in `pointer-regression-results`. |
| Final near-bottom full-visibility recheck                     | **3 passed**, with the final `ratio: 1` visibility assertion. These overlap the broader passes and are not additional distinct cases. `pointer-bottom-final.log` and results.                                                                                                                                   |
| `pnpm -C packages/desktop exec vitest run --maxWorkers=2`     | **1,235 passed, 36 existing skips; 123 files passed, 4 existing skipped files**. No new skips. `pointer-unit.log`.                                                                                                                                                                                              |
| `pnpm run typecheck`                                          | **Passed** after the final test edits. `pointer-typecheck-final.log`.                                                                                                                                                                                                                                           |
| `pnpm run lint`                                               | **Passed: 0 errors, 166 existing warnings**. No new warnings. `pointer-lint-final.log`.                                                                                                                                                                                                                         |
| `git diff --check`                                            | **Passed**. Dependency manifests, lockfile and root README have no new changes.                                                                                                                                                                                                                                 |

The broader run's saved records contain **23 fixed-coordinate gestures across 17 matrix cases** (the sequential cases each exercise three files). Maximum intermediate row displacement was **0 px**, and maximum scroll-offset change was **0 px**. The other six new cases exercise single-click release behavior. The matrix uses both untouched three-file FolderA fixtures and longer, explicitly title-sorted fixtures with nonzero scroll positions. Selection/promotion and file-integrity assertions remained enabled throughout. All selected UI cases completed; there are no remaining failures in these checks.

To reproduce the selected desktop set, leave the desktop/clipboard idle and finish the build before starting tests:

```powershell
pnpm run build:unpack
$pointerReviewSpecs = @(
  'sidebar-pointer-gesture', 'issue-2395-preview-tabs', 'sidebar-auto-reveal-528',
  'issue-5685-opened-files-resize', 'sidebar-focus-model', 'issue-2421-sidebar-state',
  'issue-5631-folder-collapse', 'multi-folder-sidebar', 'folder-session-restoration',
  'document-layout-restoration', 'viewer-mode', 'preview-selection', 'file-open-directory'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @pointerReviewSpecs --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-pointer-review-results"
```

The new spec alone is `pnpm -C packages/desktop exec playwright test test/e2e/sidebar-pointer-gesture.spec.ts`. The final visibility recheck adds `--grep 'scrolled bottom'`.

Not newly run for this correction: the entire desktop UI repository, standalone Muya/website suites, installers or Linux/macOS. Physical hardware timing, OS double-click settings and DPI variants remain manual scope. The coordinate input is trusted browser input through Playwright in real Electron, rather than a claim of native Windows hardware injection. The 120-case result in the preceding section remains the historical result for that earlier correction and is not substituted for this correction's 102-case run.

Fixture/debugging history is retained for clarity: the first prototype used `mouse.click({ clickCount: 2 })` for the second action, which generates two additional clicks. It was corrected to a single down/up pair **before the valid two-click failure reproduction and before the application fix**. The initial filler-file setup followed creation ordering and did not produce nonzero offsets; those captures are not presented as scrolled evidence. A trial invalid sort value (`name`) was interrupted; the final fixture uses the existing valid `title` enum, and the separate pre-fix three-case run above verifies actual nonzero scroll positions. Lint initially rejected an empty fixture parameter in the test callback; `test.info()` resolves that without changing assertions. No failing case was configured as skipped or disabled.

### Physical Windows retest

1. Close MarkText+1 normally, honoring unsaved-change prompts. Use a fresh isolated profile so the acceptance check does not overwrite your actual session:

   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm run build:unpack
   $pointerReviewProfile = Join-Path $env:TEMP ('MarkTextPlus1-pointer-review-' + [guid]::NewGuid().ToString('N'))
   pnpm run start -- --user-data-dir "$pointerReviewProfile"
   ```

2. Create a disposable FolderA containing only alpha.md, beta.md and gamma.md, plus an existing.md **outside FolderA**. In the isolated profile enable Opened files in sidebar, sidebar preview tabs, auto-reveal and document tabs; use same-window file/folder opening. Choose Reading Mode as the existing-file default. First open existing.md through Ctrl+O, then File → Open Folder → FolderA. This ensures alpha adds a row instead of merely replacing an empty untitled tab.
3. Keep the physical mouse stationary while double-clicking alpha. Between the two clicks, FolderA/alpha/beta/gamma must not move and the second click must still hit alpha. Repeat for beta and gamma. All three should become permanent, non-italic tabs; with existing.md there should be four tabs total. Double-click already-open alpha again: focus must return to its original tab without a duplicate or permission/layout change.
4. Close the three clean test tabs, leaving existing.md, and try beta as the first new file; repeat with gamma first. Also repeat from a blank untitled document. Use your normal Windows double-click speed; there is no new timing setting to adjust. The list may grow **after** the completed double-click, which is distinct from moving a target between clicks.
5. Single-click alpha and then beta. They should reuse one italic preview tab. While the pointer remains in the tree after the first click, Opened files can temporarily keep its previous height. Move over the editor: normal allocation should return. Repeat using wheel scrolling, Arrow/Tab keyboard input, sidebar hide/show and window resizing. Tree interaction and previews must continue working, and resizing must retain your chosen saved height.
6. Add enough disposable filler Markdown files before and after alpha/beta/gamma in Title/ascending sort order to make the tree scroll. Place each target near the top, middle and bottom of the visible tree and double-click without moving the pointer. No row/scroll jump should occur between clicks; after a completed double-click auto-reveal should keep the chosen row visible. Confirm deliberate wheel scrolling and folder/root collapse/expansion still respond. Switch tabs to a file inside a collapsed/offscreen subfolder and check that existing auto-reveal expands/reveals it; disabling auto-reveal should still respect that preference, while Show in Side Bar should override it.
7. Open four existing documents outside FolderA, then double-click alpha to cross the resize-handle threshold. Confirm the handle's appearance does not move the target before the second click. Drag the handle, resize a small window and return to the original size; the existing preferred-height behavior must remain intact.
8. Repeat with different layouts/permissions: alpha Preview/Reading, beta Source/Edit with an unsaved edit, gamma WYSIWYG/Reading. Switch using the sidebar and tabs, copy from Preview, undo/redo beta's edit, then close/restart normally with Restore All and Restore previous editor state enabled. Layouts, permissions, dirty content, root/expansion, sidebar visibility/width and opened-files height must restore according to the existing preferences. Keep autosave off for this dirty-buffer recovery check; honor any dirty Reading Mode confirmation.
9. Compare disposable source files before/after using `Get-FileHash -Algorithm SHA256 -LiteralPath <path>` and `Get-Item -LiteralPath <path> | Select-Object Length,LastWriteTimeUtc`, including a BOM/CRLF/trailing-space file. Selection, mode/layout changes and navigation must not write them. Recheck Ctrl+O's starting-directory behavior from the preceding correction. Physical mouse/OS timing, DPI/display scaling and external clipboard applications remain manual acceptance scope; browser-coordinate tests do not claim to synthesize Windows hardware input.

## Acceptance correction — Remember Open Folder's directory

### Findings and confirmed causes

The File → Open correction has passed the owner's physical Windows acceptance check (user-reported). This separate correction concerns **File → Open Folder**. Before changing application code, the new desktop regression opened a disposable project through the actual native-menu handler and captured the next `dialog.showOpenDialog` call. It failed: expected the previously selected project as `defaultPath`, received `undefined`. The original `d7c3baf3` implementation likewise supplies only `openDirectory`/`createDirectory`, so this is inherited behavior, not a Stage 2A layout regression. Windows was choosing the starting location; no campaign-specific path was found or introduced. The test establishes the missing application default rather than claiming to inspect Windows' own chooser history.

The application already has the persisted `lastOpenedFolder` preference and recent folder history. Successful `ProjectRoots.add` validates a root before its existing `remember` callback updates that preference and recent history. `ProjectRoots.restore` does not rewrite the preference. File opens update the existing mixed recent-document list, without changing `lastOpenedFolder`. The folder-specific preference is therefore reused instead of inferring a folder from a recent document's parent or adding another configuration store/key.

The extended cold-restart regression exposed a second inherited interaction. `_restoreAllState` re-added restored files to recent history as concurrent disk reads finished. That could change the most recent file and hence Ctrl+O's default directory merely by restarting. The first post-fix dialog run had **7 passes and 1 failure** at this strict file-directory assertion after restart; folder remembering itself passed. The history rewrite also exists at `d7c3baf3`. Restoration now preserves the saved recent history; explicit successful opens and explicit reopens still use their existing history updates. No records are cleared, replaced or migrated. The regression additionally compares the entire recent-history file before and after the restart.

### Behavior, precedence and scope

The native menu, registered `file.open-folder` command and `mt::cmd-open-folder` IPC continue through the existing `openFolder` action. Like File Open, it now dispatches a typed internal dialog request to the application, where the current preferences are available. The folder chooser selects:

1. `lastOpenedFolder`, if it is still a directory.
2. `defaultDirectoryToOpen`, if `startUpAction === 'folder'` and the configured path is still a directory.
3. `undefined`, allowing the native chooser to select its location.

A valid remembered folder wins over the startup fallback. Inactive startup-folder settings, missing paths and file paths are not used as folder defaults. The existing preference retains its broader meaning of the last opened project folder: explicit folder-opening routes and the configured startup-folder action can still update it. Merely restoring project roots or opening documents does not. No current preference value/default or startup action was changed.

Only a non-cancelled result for a surviving owner window goes to the existing `openFileOrFolder` path validation and folder dispatch. Cancellation, including a deliberately injected result carrying a path, leaves the remembered folder and roots alone. Successful folder loading retains the existing same-window/new-window preference, root replacement, watcher and recovery paths. File → Open still uses the newest valid recent **file**, independently of folder entries. Add Folder, Save As, import, export and the startup-folder preference chooser are unchanged. No dependency, packaging, security, layout, sidebar gesture or Reading Mode implementation changes are included.

### Files changed by this correction

- `packages/desktop/src/main/menu/fileOpenDirectory.ts`: add the folder-default resolver alongside the unchanged file-default resolver.
- `packages/desktop/src/main/menu/actions/file.ts`: route Open Folder through the application-owned chooser.
- `packages/desktop/src/main/app/index.ts`: supply its default path and reject cancelled/closed-window results.
- `packages/desktop/src/shared/types/ipc.ts`: type the internal folder-dialog request.
- `packages/desktop/src/main/windows/editor.ts`: stop restoration from reordering persisted recent files; retain disk loading, conflict detection and watchers.
- `packages/desktop/test/unit/specs/file-open-directory.spec.ts`: directory validity, fallback precedence and independent file/folder history coverage.
- `packages/desktop/test/e2e/folder-open-directory.spec.ts`: failing reproduction and repeated/different folder opens, cancellation, missing-folder fallback, file/folder independence, real cold restart and dirty/locked-layout retention.
- This report. All earlier uncommitted Stage 2A work is retained; no commit was created.

### Automated verification for this correction

All final checks ran against the updated application using the approved normal Windows runner, with unchanged Electron security and dependencies. The build completed before desktop UI testing; UI tests ran with one worker and isolated disposable profiles/documents. No assertion was removed or marked skipped to resolve either failure.

| Check                                      | Actual result                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-change `folder-open-directory.spec.ts` | **1 failed**, reproducing the missing `defaultPath` before application changes.                                                                                                                                                                                    |
| First post-change folder/file dialog run   | **7 passed, 1 failed**: the stricter cold-restart check exposed the inherited recent-history rewrite described above. Resolved by preserving history during restoration; not waived.                                                                               |
| Focused directory resolver unit spec       | **8 passed** (3 existing File Open tests plus 5 folder/independence tests). Also included in the final full run.                                                                                                                                                   |
| Full desktop unit suite, `--maxWorkers=2`  | **1,240 passed, 36 existing skips**, across 123 passing and 4 skipped files (127 total). No new skip added.                                                                                                                                                        |
| Final desktop UI regression run            | **75 passed, 0 failed, 0 skipped**, 4.8 minutes. Includes 5 new folder-dialog cases, 3 File Open cases, 8 folder/session cases, 7 layout-restoration cases, 10 preview-tab cases, 5 auto-reveal cases, 23 fixed-coordinate pointer cases and 14 Viewer Mode cases. |
| `pnpm run build:unpack`                    | **Passed** after the final source correction; existing CodeMirror mixed static/dynamic import warnings remain.                                                                                                                                                     |
| `pnpm run typecheck`                       | **Passed** after the final source correction, including Muya type declarations.                                                                                                                                                                                    |
| `pnpm run lint`                            | **Passed**, 0 errors / 166 existing warnings.                                                                                                                                                                                                                      |
| `git diff --check`                         | **Passed**. HEAD remains `d7c3baf3`; no manifest, lockfile or root README changes.                                                                                                                                                                                 |

The new lifecycle case accepts FolderA, opens a Preview/Reading file and a separate Source/Edit file, performs an undo/redo and keeps the edit dirty, then opens FolderB twice. It rejects cancellation carrying a different valid folder and cancellation carrying an existing document. Both chooser defaults remain independent. A normal X-button close and fresh Electron process reuse the same isolated profile; the remembered defaults, entire recent-history file, single root, tabs, dirty text, permissions and layouts are asserted after restart. File byte/mtime snapshots include BOM, CRLF and trailing whitespace. The existing broader suites verify multiple roots, expansion/collapse, hidden/resized sidebar restoration, normal `pnpm run start` restarts, no-op encoding variants, autosave/Reading safeguards and the earlier pointer/promotion corrections.

Commands from the repository root:

```powershell
pnpm -C packages/desktop exec vitest run test/unit/specs/file-open-directory.spec.ts --maxWorkers=2
pnpm -C packages/desktop exec vitest run --maxWorkers=2
pnpm run build:unpack
pnpm run typecheck
pnpm run lint
pnpm -C packages/desktop exec playwright test `
  test/e2e/folder-open-directory.spec.ts `
  test/e2e/file-open-directory.spec.ts `
  test/e2e/folder-session-restoration.spec.ts `
  test/e2e/document-layout-restoration.spec.ts `
  test/e2e/viewer-mode.spec.ts `
  test/e2e/issue-2395-preview-tabs.spec.ts `
  test/e2e/sidebar-pointer-gesture.spec.ts `
  test/e2e/sidebar-auto-reveal-528.spec.ts `
  --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2a-folder-dialog-regression"
```

The initial failing reproduction used only `folder-open-directory.spec.ts` and `--output="$env:TEMP/MarkTextPlus1-stage2a-folder-dialog-before"`. The intermediate 8-case run used the folder/file dialog specs and `--output="$env:TEMP/MarkTextPlus1-stage2a-folder-dialog-focused"`. Final build, typecheck, lint, unit and UI logs are outside the checkout at `$env:TEMP/MarkTextPlus1-stage2a-folder-dialog-{build,typecheck,lint,unit,ui}.log`. Error contexts and artifacts likewise remain outside the checkout.

Not newly run: the entire desktop UI repository, standalone Muya/browser and website suites, installers or Linux/macOS. The actual Windows shell picker is intercepted in automation so tests can assert the exact `defaultPath`, cancel result and accepted paths without fragile OS-dialog automation. Its visible navigation, native history and focus behavior still require the manual check below. No automated failures remain in the final runs. Runtime undo/redo was verified before restart; undo history across application restarts remains the existing limitation, while dirty text is recovered. The initial expected failure and intermediate history failure remain investigation evidence, not passing results.

### Manual Windows retest

1. Close MarkText normally, honoring any unsaved-change prompts. From the repository root, create an isolated acceptance profile so this exercise does not replace your actual session:

   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm run build:unpack
   $folderReviewProfile = Join-Path $env:TEMP ('MarkTextPlus1-folder-dialog-review-' + [guid]::NewGuid().ToString('N'))
   pnpm run start -- --user-data-dir "$folderReviewProfile"
   ```

2. Create disposable sibling folders FolderA, FolderB and Documents. Put Markdown files in each, including a BOM/CRLF/trailing-space sample. In the isolated application select Restore All, Restore previous editor state enabled, same-window file/folder opening, and autosave off. Open FolderA using File → Open Folder. Reopen that chooser: it must start inside FolderA. Cancel, reopen and check it still starts there.
3. Choose FolderB successfully. The next Open Folder must start in FolderB. Cancel and repeat. Open FolderB again: there must be one FolderB project root, with no duplicates. Open Folder intentionally retains its existing root-replacement behavior; use Add Folder to maintain multiple roots.
4. Open a file from Documents through Ctrl+O. Repeat Ctrl+O: it must start in Documents. Cancel it, then Open Folder: that must still start in FolderB. Open FolderA, then Ctrl+O again: the file chooser must still start in Documents. Cancel each chooser once after navigating elsewhere without accepting; navigation alone must not change its remembered location.
5. Keep a Preview/Reading tab and a Source/Edit tab with an unsaved change. Leave FolderB open, adjust the sidebar width, collapse/expand a subfolder, and close using the window's X button. Restart with `pnpm run start -- --user-data-dir "$folderReviewProfile"`. Verify restored root/tree/sidebar state, document layouts and permissions, and the unsaved Source content. Open Folder must immediately start in FolderB and Ctrl+O in Documents without reselecting anything. Repeat after a second normal restart. Use the existing Add Folder workflow to repeat the restoration check with multiple roots.
6. For fallback checks use a separate isolated profile, or note all values before changing preferences. Configure the startup action to Open Folder with a valid disposable configured directory. While the app is running, explicitly open a different **empty disposable** folder, then remove that empty folder through Explorer. The next Open Folder must start in the configured directory. Cancel: it must not silently replace/remove the unavailable project root. With Restore All selected instead, that stored startup directory is inactive and the OS may choose its own starting location. If both remembered and configured paths are missing, the OS likewise chooses. Restore your desired startup preference afterward; no fallback should create a directory or change document files.
7. Compare fixture hashes/bytes and `LastWriteTimeUtc` before and after, including the BOM/CRLF/trailing-space file. Dirty changes must remain in memory/recovery, never silently saved. Check Reading Mode still blocks edits and Preview copies rendered text. Physical native-dialog location, focus and Windows shell history remain manual acceptance scope because automation intercepts only the chooser boundary while exercising the real menu, main process, loading, persistence and restarts.

## Final manual acceptance and Git review — 24 October 2026

The owner reports Windows manual acceptance complete with the following results. These are **user-reported checks**, not manual tests performed by the agent. Earlier procedures, failed reproductions and automated verification records above are retained as historical evidence; this section updates their manual acceptance status.

| Manual acceptance area                                     | User-reported result                                |
| ---------------------------------------------------------- | --------------------------------------------------- |
| Physical sidebar double-click                              | **5/5 passed**                                      |
| Ctrl+O directory behavior                                  | **5/5 passed**                                      |
| Open Folder memory                                         | **4/4 passed**                                      |
| Independent directory history after restart                | **6/6 passed**                                      |
| Multi-tab / dirty-buffer recovery                          | **8/8 passed**                                      |
| Layout restoration disabled                                | **6/6 passed**                                      |
| UI and keyboard accessibility                              | **8/8 passed**                                      |
| Windows scaling and Narrator                               | **8/8 passed**                                      |
| Physical drag/drop, document integrity and IME composition | **Passed**                                          |
| Physical IME editing protection in Preview Only            | **N/A — remains unverified**, not counted as passed |

The final Git review inspected the full tracked source/test/translation diff and every untracked source, test and documentation file. Branch is `feature/marktext-plus-one`; HEAD is the approved `d7c3baf3b9004068e2fe74ea92725b269bb5048d`. The complete proposed change set is **58 files: 44 modified, 14 added (currently untracked), 0 deleted**. This comprises 30 source files, 13 locale files, 14 test files and this report. The index is empty. Ordinary `git diff --stat` covers only the 44 tracked modifications, so it is not the full change-set count.

All reviewed files map to Stage 2A or its approved targeted corrections; no unrelated user work was identified. No dependency manifests, lockfile, packaging, branding, root README, Electron security configuration, preload implementation or Muya source changed. Generated output/declarations remain ignored; no build, log, profile, screenshot or temporary fixture is among the 58 proposed files. Existing test changes preserve their assertions and add coverage; Windows path selectors and the compiled source-editor fixture were adapted to the new state model. No new skip, exclusive test, debugging statement or security-disabling launch flag was found. Split is still only a reserved identity, rejected at runtime, with no active host, menu command or synchronization implementation.

The latest recorded results were checked against their retained logs: **1,240 unit passes / 36 existing skips**, **75 UI passes / 0 failures / 0 skips** in the final selected Open Folder regression run, and successful build/typecheck/lint with **166 existing lint warnings and 0 errors**. No outstanding failures remain in those final runs. All changed application, test and locale files predate the final build and those checks; no subsequent application-code modification was found. This review changes only the report, so no automated suite was rerun. `git diff --check` was rerun; all 14 untracked files were also checked with `git diff --no-index --check` against an empty temporary file, with no whitespace errors. Earlier broader desktop selections covered additional scenarios; neither the final 75-case selection nor the historical selections constitute the complete repository UI suite.

One **nonblocking cleanup concern** was identified by static review: `promotedSidebarRequests` removes IDs on successful tab delivery, but a promoted open whose disk read fails receives only the existing error notification, leaving its numeric ID in that renderer-local Set until reload. IDs are monotonically allocated, so retained failed IDs cannot match later requests; they do not retain document buffers. Repeated failed promoted opens can accumulate small bookkeeping entries. Failure-path cleanup is a follow-up opportunity; no application change or new failure reproduction was made during this review.

Remaining limitations include the explicitly unverified physical Preview IME protection check, baseline runtime-only undo stacks, renderer/clipboard fidelity limits and the unrun full repository UI, standalone Muya, installer and non-Windows suites described above. Non-English labels have matching keys but have not gained a native-speaker wording review through these Windows checks. With these limitations and the minor cleanup concern disclosed, **Stage 2A is ready for the owner's commit approval**. No source change, staging, commit, push, merge, rebase, reset or clean was performed in this review. Stage 2B remains deferred.
