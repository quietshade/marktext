# Stage 2B — Split View

24 October 2026. Stage 2B.1 baseline: `c55d75e2fa812477f19bf3cd4f097abebb83d53a`, branch `feature/marktext-plus-one`. The checkout was clean at the start. Requirements: [specification](specs.md), [baseline matrix](baseline-feature-matrix.md), [Stage 2A](stage-2a-layout-preview.md) and [sidebar cleanup](sidebar-request-cleanup.md).

**Final status recorded 11 November 2026:** Stage 2B.1-A and Stage 2B.1-B passed the owner's final physical Windows acceptance. Stage 2B.1-C passed for the tested behaviors, with the original modification-timestamp comparison unavailable. Earlier investigation sections preserve the results and open questions at those checkpoints; the final acceptance section below supersedes their pending/failed acceptance status. The earlier physical selection observations remain genuine owner reports with an unconfirmed cause. Stage 2B.2 has not started.

## Approved design and implementation boundary

The intended Split layout is CodeMirror Source on the left and a dedicated read-only Muya rendering on the right. `IFileState.markdown` remains authoritative. Source commits immediately through the existing store; only derived rendering will be debounced. Preview must never send serialized Markdown, dirty-state changes, undo boundaries or save requests back into the document. Reading/Edit permission is independent of layout.

Stage 2B.1 implements **capabilities, source view-state retention and document-owned history reconciliation only**. There is no preview host, live-update scheduler, Split menu/palette command, divider, swapping or scroll synchronization. Runtime layout validation still rejects `split`, including restored unsupported values. No dependency, preference/session format, main/preload code, security setting, sidebar request, file dialog, packaging or branding change is included. No commit or push is made.

The existing Source-to-Muya handoff creates a bulk visual undo boundary. It must **not** become the live-preview update path in a later phase. A separate preview host can use render-only hydration without touching the visual editing engine or either editing history.

## Stage 2B.1 capabilities

`getDocumentCapabilities` models all four identities without activating them. The store resolves the active layout through the existing validator before deriving active capabilities. `isSourceLayout` still means exactly Source-only; `usesSourceEditor` provides the distinct host-ownership capability.

| Layout             | Uses CodeMirror | Source editable in Edit Mode | Visual surface editable in Edit Mode | Has rendered preview | Document mutations in Edit Mode |
| ------------------ | --------------- | ---------------------------- | ------------------------------------ | -------------------- | ------------------------------- |
| WYSIWYG            | No              | No                           | Yes                                  | No                   | Permitted                       |
| Source             | Yes             | Yes                          | No                                   | No                   | Permitted                       |
| Split (model only) | Yes             | Yes                          | No                                   | Yes                  | Permitted                       |
| Preview Only       | No              | No                           | No                                   | Yes                  | Blocked                         |

Reading Mode and the existing permission-transition guard disable both editable capabilities and document mutation permission. A missing document has no editable surface. Split's eventual read-only preview does not lock the source or suspend authorized saves/autosaves for an editable document.

The app and source/visual hosts use the source-host capability instead of inferring ownership from Source identity. The current Source component occupies the same host position; once Split is explicitly enabled in a later phase, Source/Split ownership can remain true across that transition without a mount/unmount. This is architectural preparation, **not a tested functional Source/Split transition**.

Muya's hidden visual surface is locked while Source owns editing and while permission is changing. The registered document-view callback cannot override that derived restriction. Source's existing mutation guards, renderer save/autosave checks and main-process Reading Mode/write coordination are retained. Preview Only keeps its existing clipboard adapter and always-read-only behavior.

## Native Source state

The existing per-tab, in-memory source-history cache now also captures native ranges, direction, primary selection, caret affinity and outer source scroll position. Muya's adjusted index cursor remains a separate interoperability coordinate; it no longer overwrites a valid cached native selection on Source re-entry.

Restoration accepts only matching source/canonical text, clears the previous document's history, restores ranges without scrolling and then restores native history. That order prevents selection restoration from inserting another selection-history event. Equal content is not replaced. The existing raw/canonical comparison retains source text when the established trailing-newline policy differs from the raw view value. An unrelated replacement cannot receive cached history or ranges. Closed-tab entries are pruned.

Scroll restoration is guarded by document ownership, including the existing external-reload restoration callback. Source/Split will retain the mounted CodeMirror and its search object; no separate search-state persistence is added. Existing Find reruns across actual Source/Preview/WYSIWYG transitions remain unchanged and covered by the existing regressions.

No undo stack, new native-range cache or transition checkpoint is serialized into the session. Existing dirty-buffer recovery, encoding metadata and layout/permission persistence remain unchanged.

## Document-owned visual reconciliation

The previous single `preSourceModeSelection` variable is replaced by a transient per-document checkpoint containing the entry canonical Markdown, rendered history base, visual history and pre-source selection. Each source session has a monotonically allocated token.

- Entering the source family captures once; repeated activation does not replace a valid checkpoint or create a boundary.
- Tab activation can hydrate newer source text into the hidden visual engine without overwriting that document's checkpoint.
- An explicit `source-handoff` must match the active document, loaded visual document and source-session token. Missing, duplicate or stale handoffs are ignored without consuming another valid checkpoint. Cursor/payload shape is no longer used to infer a handoff.
- On reconciliation, restore the original rendered/history base if needed. Only changed canonical text can request one `replaceContent` boundary; Muya still declines a replacement whose parsed content is unchanged. Consume the checkpoint after successful reconciliation.
- Source/visual history remains document-specific across interleaved source tabs. A no-op round trip does not introduce a bulk boundary or rewrite canonical Markdown.
- Authorized fresh loads/external reloads reset the relevant checkpoint. Closed tabs prune their checkpoints; destruction of the visual host clears the remaining transient checkpoints. App shutdown does not manufacture a source-exit boundary while the document still uses Source.

The new checkpoint service has no content-store, IPC, save or disk-write dependency. It is not a preview renderer or a second editable document model. Actual Source/Split transitions will keep this source session open; the bulk handoff belongs only to a later return to the visual/Preview host.

## Files changed

Paths are relative to the repository root.

| File                                                                         | Change                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/desktop/src/shared/types/documentLayout.ts`                        | Pure four-identity capabilities; existing availability validator retained.                                   |
| `packages/desktop/src/renderer/src/store/editor.ts`                          | Resolved active capabilities and source-host ownership getter.                                               |
| `packages/desktop/src/renderer/src/pages/app.vue`                            | Source component mounting follows host ownership.                                                            |
| `packages/desktop/src/renderer/src/services/documentMode.ts`                 | Extend the existing runtime source cache with native selection/scroll state.                                 |
| `packages/desktop/src/renderer/src/services/sourceTransitions.ts` (new)      | Document/token-owned source-entry checkpoints and visual reconciliation.                                     |
| `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue` | Restore native source state, retain source-session token and emit only an explicit owned exit handoff.       |
| `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue`     | Lock the hidden visual surface; capture, reconcile and prune document-owned checkpoints.                     |
| `packages/desktop/test/unit/specs/document-layout.spec.ts`                   | Capability matrix and unchanged runtime Split rejection.                                                     |
| `packages/desktop/test/unit/specs/source-transition-state.spec.ts` (new)     | Native cache, no-op/bulk reconciliation and stale ownership regressions.                                     |
| `packages/desktop/test/e2e/source-transition-groundwork.spec.ts` (new)       | Real CodeMirror/Muya history, native selection/scroll, permission and no-op/clipboard integrity regressions. |
| `packages/desktop/test/e2e/source-navigation-restoration.spec.ts` (new)      | Keyboard selection, wheel viewport, delayed focus and independent-tab navigation regressions.                |
| `packages/desktop/test/e2e/nativeApplicationMenu.ts` (new)                   | Test-only native Windows menu/pointer and keyboard driver.                                                   |
| `packages/desktop/test/e2e/reading-mode.spec.ts`                             | Verify editable Source and protected hidden Muya independently when unlocking.                               |
| `docs/MarkTextPlus1/source-selection-diagnostic.js` (new)                    | Opt-in disposable-fixture selection trace; no production imports.                                            |
| `docs/MarkTextPlus1/stage-2b-split-view.md` (new)                            | Design, implementation evidence, limits and acceptance procedure.                                            |

## Verification

The existing `packages/desktop/test/e2e/reading-mode.spec.ts` also changes: two Source unlock tests now assert CodeMirror is editable **and** the hidden Muya surface remains locked. Their previous global `.mu-read-only` absence checks described the old hidden-engine behavior rather than Source permission. Existing menu, preference, content and undo assertions remain, with explicit source-editability checks added. No test is removed or skipped.

Tests use the approved normal Windows runner and existing isolated-profile Electron helpers, without security-disabling flags, new skips, weakened assertions or dependency changes. Build output is held unchanged during UI testing. Logs/artifacts are outside the checkout under `$env:TEMP/MarkTextPlus1-stage2b1-*`.

| Check                                                                                      | Result                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial focused units: layout, native state/transition and existing source-image SFC tests | **39 passed**, three files.                                                                                                                                      |
| Full desktop units, `--maxWorkers=2`                                                       | **1,274 passed, 36 existing skips**, 124 passing and four skipped files (128 total).                                                                             |
| Build after runtime changes                                                                | **Passed**. Existing CodeMirror mixed-import notices remain.                                                                                                     |
| Final type-check                                                                           | **Passed**, including Muya declarations and all new desktop test types.                                                                                          |
| Final lint                                                                                 | **Passed**, zero errors / **166 existing warnings**. No new warning remains.                                                                                     |
| Initial broader desktop UI selection                                                       | **129 passed, 4 failed**, 8.6 minutes; causes and corrections documented below.                                                                                  |
| Final complete Reading Mode and new Source specs                                           | **17 passed, 0 failed, 0 skipped**, 1.1 minutes, exit 0. Includes all four previously failing cases.                                                             |
| Combined selected UI coverage                                                              | **133 distinct passing cases**: 129 broader passes plus four resolved cases; 13 of the final 17 overlap earlier passes. No unresolved failure in this selection. |
| Report Prettier and `git diff --check`                                                     | **Passed**.                                                                                                                                                      |

Development results are retained separately from final acceptance. The first four-case new UI run had **two passes and two failures**: interleaved real visual histories and no-op/clipboard safety passed; exact native-history comparisons differed because the fixture supplied positions without CodeMirror's affinity field, which history restoration materializes. The fixture now provides explicit non-default caret affinities and retains the full exact range/history comparison, scroll assertion and actual undo/redo checks. No assertion was removed. An intermediate type-check rejected an overly narrow affinity type and null values not accepted by the installed CodeMirror declarations; the host type now matches those declarations and the fixture uses typed affinity strings. Initial lint passed with three new warnings (unused type import and two test non-null assertions); all three were removed before final lint.

Commands from the repository root:

```powershell
pnpm -C packages/desktop exec vitest run test/unit/specs/document-layout.spec.ts test/unit/specs/source-transition-state.spec.ts test/unit/specs/source-code-image-action.spec.ts --maxWorkers=2
pnpm -C packages/desktop exec vitest run test/unit --maxWorkers=2
pnpm run build:unpack
pnpm run typecheck
pnpm run lint
$stage2b1Specs = @(
  'source-transition-groundwork', 'document-layout-preview', 'document-layout-restoration',
  'preview-selection', 'viewer-mode', 'reading-mode', 'parity-source-undo-saved',
  'source-mode-flush', 'tab-switch-cursor', 'external-reload-undo',
  'sidebar-request-cleanup', 'sidebar-pointer-gesture', 'issue-2395-preview-tabs',
  'sidebar-auto-reveal-528', 'folder-session-restoration', 'file-open-directory',
  'folder-open-directory', 'context-isolation', 'web-security'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @stage2b1Specs --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-ui-review-results"
pnpm -C packages/desktop exec playwright test test/e2e/source-transition-groundwork.spec.ts test/e2e/reading-mode.spec.ts --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-ui-final-results"
git diff --check
```

The final desktop selection is not the entire repository UI suite. Standalone Muya/browser/conformance suites, installers, website and non-Windows platforms are not newly tested. Physical Windows/IME/clipboard acceptance below is not claimed as performed by the agent.

The first broader 133-case run exposed those two existing Source unlock assumptions and the two new exact-history checks. CodeMirror's `Selection.deepCopy` uses `copyPos` without affinity during its public `setHistory` operation. This is an inherited history-serialization limitation, not lost live ranges in the new cache. The final fixture round-trips its initial history through that public API before taking the expected snapshot; the final assertion still compares the entire resulting history and exact live ranges/primary caret (including non-default affinity), and still performs actual undo/redo. No comparison field is omitted or normalized away in the assertion. The native source cache continues to preserve live affinity. Final rerun results follow in the verification table.

## Manual Windows verification

1. Close the application normally, honoring unsaved prompts. Use disposable files and an isolated profile so your real session and recent history remain intact:

   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm run build:unpack
   $groundworkProfile = Join-Path $env:TEMP ('MarkTextPlus1-2b1-review-' + [guid]::NewGuid().ToString('N'))
   pnpm run start -- --user-data-dir "$groundworkProfile"
   ```

2. Turn autosave off for dirty-buffer testing. Open two disposable documents. Edit A visually, enter Source and add a distinct source edit. Open B, enter Source and edit it. Switch A/B/A repeatedly, then return A to WYSIWYG. One Undo must remove A's source edit; the next must undo A's earlier visual edit. B's content/history must remain independent. Repeat with Preview between transitions.
3. In a long Source document, make a backwards selection, scroll away from the beginning and enter Preview, then return Source. Verify selection direction/caret, scroll and source undo/redo. Use Ctrl+F and Find next; change Reading/Edit permission while searching. Reading Mode must prevent typing, paste, cut, deletion, replacement, formatting, task changes and undo/redo, while selection/copy/Find still work.
4. In Preview, select full and partial bold/italic text in both directions. Copy to Notepad and Word: plain text must omit delimiters; useful rich formatting should remain. Editing controls must stay absent in either permission state. WYSIWYG retains its established Markdown-aware copy behavior. Test physical IME and file-manager drops separately; no physical IME result is claimed here.
5. View > Document Layout must still contain only WYSIWYG, Source and Preview Only. Exercise Ctrl+E and palette layout commands. Menu, footer, actual host and permission must agree; no Split command or pane should be available.
6. Enable Restore All and previous editor state, keep mixed layouts/permissions and an unsaved editable source buffer, close normally and restart with the same `$groundworkProfile`. Verify dirty content, layouts, permissions, roots and sidebar state. Repeat with layout restoration disabled. Runtime undo stacks are not expected to survive application restart.
7. Enable autosave on a disposable copy. An editable Source change should follow the existing autosave policy. Lock a dirty buffer before its timer expires: it must remain in memory and unchanged on disk. Unlocking or changing layout alone must not silently save it. Honor existing dirty Reading Mode close confirmations.
8. Before and after a no-edit layout/permission/navigation round trip compare `Get-FileHash -LiteralPath <fixture> -Algorithm SHA256` and `Get-Item -LiteralPath <fixture> | Select-Object Length,LastWriteTimeUtc`. Repeat with UTF-8 BOM, UTF-16LE BOM, CRLF and trailing whitespace. Expect no differences. Recheck ordinary sidebar single/double-click, dirty-tab refocus and independent File Open/Open Folder directory memory.

## Source navigation correction after manual acceptance

### User-reported results and reproduction

The owner reported Stage 2B.1-A history isolation **5/5 passed** and Stage 2B.1-B Source state restoration **3/5 passed**. The two physical failures were changed selected text after Ctrl+End, Shift+Up twice and a Source/Preview/Source round trip, and lost wheel scroll with the caret left at Home. The owner confirmed the window was not maximized. These are user-reported physical results, separate from the automated checks below.

Before changing application code, a new desktop spec used 180 plain numbered lines, real CodeMirror keyboard selection, mouse-wheel scrolling and actual layout transitions. Each line is `Line 001: numbered source text` through `Line 180: numbered source text`, with a final newline. The test opens the titlebar Application Menu popup and invokes its real native layout handler, delivering the layout change before closing the popup. It records native ranges, anchor/head, primary caret, selected text, full source text, outer Source scroll, CodeMirror scroll information and focus state in JSON attachments outside the checkout.

Two defects were confirmed:

1. **Keyboard navigation metadata was dropped.** Before the round trip, the backwards range had anchor `{line:180,ch:0}`, head `{line:178,ch:0}` and CodeMirror's `goalColumn: 4`. After returning, the endpoints and selected text were unchanged, but `goalColumn` was missing. The original cache copied only endpoints, and CodeMirror's public `setSelections` also constructs ranges without this vertical-navigation column. The exact native-range assertion failed before correction. This metadata affects later vertical keyboard movement. It does **not** establish why the owner's immediately selected text differed: that particular symptom has not been independently reproduced and still requires physical retesting.
2. **Later input focus could overwrite the restored Source viewport.** A plain wheel-scroll round trip passed before correction. A subsequent real CodeMirror `focus()` reproduced the failure mechanism: the restored outer Source `scrollTop` was **2047**, then became **0**, while the primary caret remained at Home. The hidden CodeMirror input is positioned beside the caret. Browser focus scrolled that offscreen input into view after Source's saved offset had already been restored. This is a late-focus overwrite, not a missing cached scroll offset.

The original selection test failed and original simple-scroll test passed in repeated pre-fix runs. Adding the late-focus regression then failed with expected `2047`, received `0`. No application changes preceded these failures. Native Windows popup navigation through experimental SendKeys drivers selected unintended menu items in two exploratory runs; those were fixture failures and that driver was removed. The retained test opens the real popup and calls its native handler, but does not claim physical OS menu-item selection coverage.

### Minimal correction and ownership

- `services/documentMode.ts`: capture native range metadata as well as copied endpoints; restore each range's `goalColumn` after `setSelections`, before restoring history. The existing document-ID/text guards, primary selection, direction, caret affinity and history order remain intact. Zero is retained as a valid column.
- `components/editorWithTabs/sourceCode.vue`: disable construction-time autofocus, prepare the native state first and focus explicitly. A helper wraps only this CodeMirror instance's input-element `focus` with `preventScroll: true`; explicit focus options remain supported. Later CodeMirror focus therefore cannot implicitly reveal an offscreen hidden input. Deliberate CodeMirror caret navigation, Find and outline scrolling retain their existing scroll paths.
- `test/unit/specs/source-transition-state.spec.ts`: emulate CodeMirror's endpoint-only range reconstruction, test independent nonzero/zero navigation columns and copied cache state, and test the scoped focus option behavior.
- `test/e2e/source-navigation-restoration.spec.ts`: nine real-editor regressions cover repeated Preview and WYSIWYG round trips in Edit and Reading modes, exact native selection and copied text, backwards selection extension, wheel scroll independent of a Home caret, late focus, and two tabs with independent backwards/multiple ranges and primary selections. Full Markdown, dirty status and disk bytes/mtime are checked. Existing history/dirty-buffer/Reading/clipboard suites remain in the broader selection.
- This report records the failures, evidence, limits and retest procedure. The total uncommitted Stage 2B.1 inventory is now **13 files: eight modified and five new**, including the earlier groundwork. No additional application subsystem is changed by this correction.

Sixty animation-frame observations capture any subsequent selection/scroll changes, with exact assertions on every relevant frame. They are diagnostic observations, not sleeps used to wait out a mismatch. There is no longer timeout, relaxed selection comparison or normalization of Source content. The native Windows plain-text clipboard uses CRLF; the new fixture explicitly checks that representation and compares the exact clipboard result before/after. The first expanded run passed five cases and failed four at an LF-only clipboard expectation **before layout switching**; correcting that platform expectation produced nine passes. An initial lint run found indentation errors in the new parameterized test; only that test was formatted with ESLint.

### Correction verification

Logs and JSON attachments are under `$env:TEMP/MarkTextPlus1-stage2b1-navigation-*`. Earlier Stage 2B.1 verification above is retained as historical evidence, not substituted for the correction checks.

| Check                                                | Result                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused post-fix desktop reproductions               | **2 passed**: exact native range restored; late focus retains the wheel viewport.                                                                                        |
| Expanded desktop navigation spec                     | **9 passed**, including both permissions, both destination layouts, copying and independent tabs.                                                                        |
| Focused units                                        | **41 passed**, three files.                                                                                                                                              |
| Full desktop units                                   | **1,276 passed, 36 existing skips**, 124 passing and four skipped files (128 total).                                                                                     |
| Corrected runtime build, `pnpm run build:unpack`     | **Passed**; existing CodeMirror mixed-import notices remain.                                                                                                             |
| Type-check, `pnpm run typecheck`                     | **Passed**.                                                                                                                                                              |
| Final selected desktop regressions                   | **142 passed, 0 failed, 0 skipped**, 8.3 minutes. Includes the nine new cases and the existing history, permission, session, clipboard, sidebar and security selections. |
| Supplemental existing Source scroll/Find regressions | **19 passed, 0 failed, 0 skipped**, 36.3 seconds: Find/replace, source undo, immediate typing and deliberate outline scrolling.                                          |
| Final lint                                           | **Passed**, zero errors / **166 existing warnings**, with no new warnings.                                                                                               |
| Report formatting / tracked and new-file whitespace  | **Passed**.                                                                                                                                                              |

The final two desktop selections cover **161 distinct passing cases**; the earlier focused nine navigation cases are included in the 142-case run, not additional distinct coverage. There are no outstanding failures in these final selected runs. This is not the entire repository desktop UI suite. Standalone Muya/browser/conformance tests, installers, website and other operating systems were not newly run for this correction. The physical immediate selected-text discrepancy and physical native-menu focus sequence still need the owner's retest; they are not recorded as passed.

Reproduction and final commands from the repository root:

```powershell
pnpm -C packages/desktop exec playwright test test/e2e/source-navigation-restoration.spec.ts --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-navigation-expanded-final-results"
pnpm -C packages/desktop exec vitest run test/unit/specs/document-layout.spec.ts test/unit/specs/source-transition-state.spec.ts test/unit/specs/source-code-image-action.spec.ts --maxWorkers=2
pnpm -C packages/desktop exec vitest run test/unit --maxWorkers=2
pnpm run build:unpack
pnpm run typecheck
pnpm run lint
$navigationSpecs = @(
  'source-navigation-restoration', 'source-transition-groundwork',
  'document-layout-preview', 'document-layout-restoration', 'preview-selection',
  'viewer-mode', 'reading-mode', 'parity-source-undo-saved', 'source-mode-flush',
  'tab-switch-cursor', 'external-reload-undo', 'sidebar-request-cleanup',
  'sidebar-pointer-gesture', 'issue-2395-preview-tabs', 'sidebar-auto-reveal-528',
  'folder-session-restoration', 'file-open-directory', 'folder-open-directory',
  'context-isolation', 'web-security'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @navigationSpecs --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-navigation-regression-results"
pnpm -C packages/desktop exec playwright test test/e2e/source-toc-scroll.spec.ts test/e2e/find-replace.spec.ts test/e2e/issue-781-source-undo.spec.ts test/e2e/source-mode-typed-input.spec.ts --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-navigation-scroll-find-results"
git diff --check
```

### Earlier automated-fixture retest (superseded for selection acceptance)

The following procedure used the earlier LF/final-newline fixture. It is retained as historical evidence. Use the exact original fixture and diagnostic procedure in the second physical acceptance investigation below for further selection acceptance.

1. Build and use the isolated profile procedure above. Keep the window **not maximized**, matching the owner's reproduction. Create a disposable fixture in PowerShell:

   ```powershell
   $navigationFixture = Join-Path $env:TEMP 'MarkTextPlus1-source-navigation.md'
   $navigationText = ((1..180 | ForEach-Object { 'Line {0:D3}: numbered source text' -f $_ }) -join "`n") + "`n"
   [IO.File]::WriteAllText($navigationFixture, $navigationText, [Text.UTF8Encoding]::new($false))
   Get-FileHash -LiteralPath $navigationFixture -Algorithm SHA256
   Get-Item -LiteralPath $navigationFixture | Select-Object Length,LastWriteTimeUtc
   ```

2. Open that fixture, select Edit Mode and Markdown Source, press Ctrl+End, then hold Shift and press Up twice. Copy to Notepad and retain the result: it should be exactly the final two numbered lines including their line breaks. Through the physical View > Document Layout menu, choose Preview Only, leave Preview untouched, then return to Source. Copy again to a separate Notepad document and compare exactly. The same characters must remain selected. Shift+Right must keep the bottom anchor and move the active head one character right. Repeat the round trip twice, then repeat through Visual Editor. Also retest with the owner's original fixture if available; the immediate selected-text symptom remains unconfirmed by automation.
3. In Source, Ctrl+Home, then use only the wheel to put about Line 090 at the top. Do not move the caret. Preview Only > Markdown Source must return to that viewport. Open and dismiss the Application Menu; switch app focus away and back, then resume Source focus. The viewport must not jump to Home. Repeat through Visual Editor and with Reading Mode. Normal arrow keys, Ctrl+Home/End, Find next and outline navigation must still deliberately reveal their destinations.
4. Open a second document, give it a distinct selection and scroll position, and alternate tabs and layouts repeatedly. Check multiple selections where used, primary caret/direction, undo/redo and the earlier Stage 2B.1-A history-isolation procedure. Dirty edits must stay with their document; Reading Mode must continue blocking mutations. Preview copying must still omit formatting delimiters.
5. Repeat the hash/length/timestamp commands from step 1. No-edit navigation must leave all values unchanged and no dirty marker. Repeat with the existing BOM/CRLF/trailing-whitespace fixtures and verify dirty/autosave safeguards with disposable copies as described above.

These physical retests have not been performed by the agent. Split remains unavailable, and Stage 2B.2 still requires explicit approval after review of the correction and its remaining manual acceptance.

## Second physical selection acceptance investigation

### Owner results and fixture correction

After the navigation correction, the owner reported that **exact selected text and backwards selection direction still fail**. The owner separately reported that **wheel-scroll restoration and viewport retention through menus/application focus now pass**. These are physical Windows results reported by the owner, not automated passes. The successful scroll correction is preserved.

The owner also confirmed that, after selecting Markdown Source, they used the keyboard immediately and **did not click inside the document**. An intervening ordinary text click therefore does not explain the reported failure.

The original fixture was not equivalent to the earlier automated one:

| Property          | Original physical fixture                                                                                     | Earlier automated fixture                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Prefix            | `# Source state test`, then a blank line                                                                      | None                                                                      |
| Numbered lines    | `Line 001: Alpha Bravo Charlie Delta Echo Foxtrot` through `Line 180: Alpha Bravo Charlie Delta Echo Foxtrot` | `Line 001: numbered source text` through `Line 180: numbered source text` |
| Disk line endings | CRLF                                                                                                          | LF                                                                        |
| Final newline     | None                                                                                                          | Present                                                                   |

The new tests write the exact original bytes, keep the window unmaximized, and use native Windows Ctrl+End followed by two Shift+Up presses. CodeMirror's public buffer/selection API represents line breaks as LF; the tests explicitly assert that initial representation and final-newline status. The original disk remains CRLF without a final newline. They compare subsequent Source snapshots exactly, without trimming or normalizing them. Native Windows clipboard contents are checked against the precise CRLF representation and compared byte-for-byte before/after, with hexadecimal clipboard evidence attached.

In the tested original-fixture configuration, the backwards range is anchor **line 181, column 48** to head **line 179, column 48**, using zero-based CodeMirror coordinates. The selected text starts with a line break, followed by complete Line 179 and Line 180, with **no final newline**. Shift+Right crosses that leading line break: the head becomes **line 180, column 0**, the anchor stays at line 181/48, and exactly the leading line break leaves the selection. This differs from the earlier final-newline fixture's selection at column zero. Pixel-valued `goalColumn` depends on the font/window configuration; equality before/after is asserted rather than assuming a universal pixel value.

### Full Windows interaction and evidence

`nativeApplicationMenu.ts` is a test-only Windows driver. It obtains the actual Electron main-process PID through `app.evaluate` (Playwright's launcher PID can differ), finds menu items through Windows UI Automation and sends real native mouse down/up at their discovered screen rectangles. It traverses **View > Document Layout > Preview Only / Markdown Source**, including both the application-button popup and the native title-bar menu. F10 reveals the native menu bar when hidden. Native Windows key input exercises the original selection and Shift+Right sequence; the palette is opened through its actual Ctrl+Shift+P accelerator and receives actual typed query events. No application menu handler is invoked directly for these comparison round trips.

The **12-case comparison matrix passed**: original versus previous fixture, end versus middle selection, and popup versus native menu bar versus command palette. It records ranges (including affinity and `goalColumn`), anchor/head/primary, document text and final-newline state, focus, Source scroll, immediate restored state, 60 asserted animation-frame observations, copying and Shift+Right. The initial matrix also explicitly refocused Source before copying; all 12 raw snapshots already showed Source focused immediately after return and throughout the frame observations. The final strengthened check removes that explicit refocus and uses native Windows Ctrl+C immediately after menu return, followed by native Shift+Right, to match the owner's confirmed keyboard-only sequence. Additional tests exercise repeated palette transitions across two documents containing the exact same fixture, with distinct selections, and validate the narrowly scoped diagnostic below.

Native OS input is used on Windows. On other platforms the same content/range/history assertions use Playwright keys, existing menu-command handlers and the existing palette-open IPC, with the fallback route recorded in attachments. This avoids introducing a PowerShell requirement into the Linux desktop CI and adds no platform skips. These fallback paths have not been run on another operating system in this investigation.

**The physical selection failure is still not reproduced by reliable automation. Its application root cause is not established.** The exact-fixture/native-menu gaps in the previous coverage have been closed, but passing automation does not overturn the owner's failed physical acceptance. No new application-source correction is made during this investigation. In particular, the accepted scroll fix, cache ownership, history reconciliation, permissions and save/autosave behavior are unchanged.

Development failures are retained rather than counted as application defects or hidden:

- The first exact-fixture handler test retained text/direction but failed an inaccurate Shift+Right assertion that assumed the head was not at a line end. The assertion now requires moving exactly one Source character, including crossing a line break, while retaining the anchor; exact text/range comparisons remain.
- An experimental batched native driver and simulated renderer accelerator produced **12 driver failures** before valid layout transitions. Native submenu traversal, hidden native menu-bar activation, the real Windows palette accelerator and typed query events were corrected. A subsequent three-route run passed two native cases and failed at palette selection because `fill()` did not emit the keyup event the existing palette uses to filter commands. Actual typing fixed that fixture. The complete 12-case matrix then passed. There are no timing sleeps or increased test timeouts.
- The first diagnostic check failed while its two companion cases passed. A follow-up exposed a diagnostic `structuredClone` exception on Vue-proxied native cursor positions. That exception interrupted restoration and manufactured an anchor/head reversal; it was **instrumentation interference**, not reproduction of the owner's uninstrumented failure. The diagnostic now copies range fields into plain objects and isolates its own observation failures from editor operations. The corrected three-case run passed, including an explicit **zero diagnostic errors** assertion. No production fix was based on that false positive.
- Focused lint identified a caught-error cause requirement and indentation in the new tests; these were corrected only in the new/extended diagnostic and test files.

### Files and verification

Files touched by this follow-up:

- `packages/desktop/test/e2e/source-navigation-restoration.spec.ts`: exact fixture, native menu/palette comparison matrix, detailed state checkpoints, diagnostic safety/privacy checks and repeated independent-tab transitions. The previous nine navigation regressions remain.
- `packages/desktop/test/e2e/nativeApplicationMenu.ts` (new): native Windows menu and keyboard test driver; no production import or dependency.
- `docs/MarkTextPlus1/source-selection-diagnostic.js` (new): opt-in, exact-fixture-only renderer observation for physical acceptance.
- This report: second physical failure, corrected fixture, honest reproduction limits and manual procedure.

The complete uncommitted Stage 2B.1 inventory now contains **15 files: eight modified and seven new**. The earlier application-source changes belong to the existing uncommitted groundwork/navigation correction; none was further modified for this follow-up. No dependency, lockfile, packaging, dialog, sidebar, security, session-format or Split implementation change is added. Nothing is staged or committed.

| Check                                                       | Result                                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-fixture/previous-fixture native route matrix          | **12 passed**, 2.7 minutes.                                                                                                                  |
| Corrected diagnostic/privacy/repeated-tab focused selection | **3 passed**, 34.1 seconds.                                                                                                                  |
| Full desktop units                                          | **1,276 passed, 36 existing skips**, 124 passing and four skipped files (128 total).                                                         |
| Build, `pnpm run build:unpack`                              | **Passed**; existing CodeMirror mixed-import notices remain.                                                                                 |
| Final type-check and lint                                   | **Passed**; lint has zero errors and **166 existing warnings**, with no new warnings.                                                        |
| Broader selected desktop UI regressions                     | **176 passed, 0 failed, 0 skipped**, 11.9 minutes.                                                                                           |
| Final strengthened navigation spec                          | **24 passed, 0 failed, 0 skipped**, 4.6 minutes, including native Ctrl+C before any explicit refocus and both fixture/direction comparisons. |
| Report formatting and tracked/new-file whitespace           | **Passed**.                                                                                                                                  |

The final 24 cases overlap the broader selection: **176 distinct cases** are covered, not 200. No outstanding failure remains in these final selected automated runs. The 24-case file was the only test changed after the broader run, and was rerun completely. Application source and the built runtime were unchanged. The entire repository UI suite, standalone Muya/browser/conformance tests, installers, website and other operating systems were not newly tested. The owner's physical selection acceptance remains failed/unresolved despite these automated passes.

Logs/attachments are outside the checkout under `$env:TEMP/MarkTextPlus1-stage2b1-exact-*`. Commands run from the repository root:

```powershell
pnpm -C packages/desktop exec playwright test test/e2e/source-navigation-restoration.spec.ts -g 'physical fixture' --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-exact-matrix-results"
pnpm -C packages/desktop exec playwright test test/e2e/source-navigation-restoration.spec.ts -g 'diagnostic|independent across tabs' --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-exact-diagnostic-final-results"
pnpm -C packages/desktop exec vitest run test/unit --maxWorkers=2
pnpm run build:unpack
pnpm run typecheck
pnpm run lint
$exactSpecs = @(
  'source-navigation-restoration', 'source-transition-groundwork',
  'document-layout-preview', 'document-layout-restoration', 'preview-selection',
  'viewer-mode', 'reading-mode', 'parity-source-undo-saved', 'source-mode-flush',
  'tab-switch-cursor', 'external-reload-undo', 'sidebar-request-cleanup',
  'sidebar-pointer-gesture', 'issue-2395-preview-tabs', 'sidebar-auto-reveal-528',
  'folder-session-restoration', 'file-open-directory', 'folder-open-directory',
  'context-isolation', 'web-security', 'source-toc-scroll', 'find-replace',
  'issue-781-source-undo', 'source-mode-typed-input'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @exactSpecs --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-exact-regression-results"
pnpm -C packages/desktop exec playwright test test/e2e/source-navigation-restoration.spec.ts --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-stage2b1-exact-native-copy-results"
git diff --check
```

### Focused Windows retest and physical diagnostic

1. Close the application normally, honoring dirty-document prompts. Create a fresh disposable fixture/profile without overwriting an existing session:

   ```powershell
   $selectionRoot = Join-Path $env:TEMP ('MarkTextPlus1-selection-' + [guid]::NewGuid().ToString('N'))
   New-Item -ItemType Directory -Path $selectionRoot | Out-Null
   $sourceStatePath = Join-Path $selectionRoot 'source-state.md'
   $selectionProfile = Join-Path $selectionRoot 'profile'
   $lines = @('# Source state test', '') + @(1..180 | ForEach-Object {
       'Line {0:D3}: Alpha Bravo Charlie Delta Echo Foxtrot' -f $_
   })
   [IO.File]::WriteAllText($sourceStatePath, ($lines -join "`r`n"), [Text.UTF8Encoding]::new($false))
   Get-FileHash -LiteralPath $sourceStatePath -Algorithm SHA256
   Get-Item -LiteralPath $sourceStatePath | Select-Object Length,LastWriteTimeUtc
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm run start -- --user-data-dir "$selectionProfile" "$sourceStatePath"
   ```

2. Keep the window unmaximized. In this isolated profile, turn autosave off and use Edit Mode/Markdown Source. Press Ctrl+End, hold Shift, press Up twice and release Shift. Copy to Notepad, preserving the leading line break and lack of a final newline. Return to the application without clicking inside the text. Choose Preview Only and Markdown Source through the physical View menu; immediately copy again and compare exact text. Then Shift+Right must retain the lower anchor and remove precisely the leading line break. Repeat at the document middle, through the palette, and across two disposable tabs. Keep track of any additional click inside Source; an ordinary text click legitimately changes the selection and needs to be distinguished from automatic restoration.
3. If the failure persists, use the companion diagnostic to record the actual interaction. Restart the **built** application with the same disposable profile/file using the verified Windows procedure below. Owner physical testing found that the `--debug` command-line flag caused Node.js DEP0062 and exit code 9; use the `MARKTEXT_DEBUG` environment variable instead:

   ```powershell
   $env:MARKTEXT_DEBUG = '1'
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   pnpm.cmd run start -- --user-data-dir "$selectionProfile" "$sourceStatePath"
   ```

   This enables local DevTools without altering the built application's sandbox/context-isolation/web-security options. Do not use the dev server or security-disabling flags. Open Source and use Ctrl+Alt+I to open renderer DevTools. Open the local [diagnostic script](source-selection-diagnostic.js) in VS Code, copy it, and run it in a renderer DevTools snippet/console. It refuses installation unless the active Source text is exactly the disposable original fixture. Close DevTools and restore the original window dimensions **before** creating the backwards selection.

4. Repeat the actual failing mouse/keyboard sequence. The diagnostic observes native ranges, primary caret, affinity/goal column, selected-text SHA-256/length/line-break counts, focus, viewport, scroll and public CodeMirror transition operations. It records no document or selected text, clipboard contents, filenames or paths, performs no saves and does not change selections or history. Other document contents are rejected by the guard. It is capped at 2,000 events. The UI tests verify unchanged history/state, absence of fixture text/path from output, zero diagnostic errors and rejection of a non-fixture document.
5. After the sequence, reopen renderer DevTools and export only the trace:

   ```javascript
   copy(JSON.stringify(await window.marktextSourceTrace.stop(), null, 2))
   ```

   Paste into a new Notepad file under `$selectionRoot`, and provide that JSON with the menu style, Windows scaling/Narrator status and the first step where the selection differed. The owner has already ruled out an intervening Source text click. `diagnosticErrors` must be zero and `truncated` false for an unqualified trace. `stop()` removes observers/listeners and restores wrapped methods; a renderer reload or normal close also clears the diagnostic. No application source or existing profile/session file needs replacement. Do not install or export this diagnostic with a real document substituted for the fixture.

6. Repeat the hash/length/timestamp commands from step 1 and the earlier history/Reading/autosave checks. Expect unchanged disk bytes and timestamps for no-edit transitions. If only the owner's usual profile reproduces the problem, retain that evidence and report the preference/window-state difference; do not discard dirty documents or overwrite session data to force the isolated profile to match.

7. After finishing and closing the diagnostic application, disable debug mode for subsequent launches from the same PowerShell session:

   ```powershell
   Remove-Item Env:MARKTEXT_DEBUG -ErrorAction SilentlyContinue
   ```

At the end of that investigation, selection acceptance remained open pending a physical trace or further retesting. The later owner-reported passes below supersede that acceptance status without establishing the cause of the earlier observations. Stage 2B.2 remains unstarted and requires explicit approval.

## Final owner physical acceptance and commit-readiness review

Recorded **11 November 2026** from the owner's final acceptance report. These physical checks were performed and reported by the owner; they are distinct from the agent's automated verification. No raw owner trace was supplied for this final Git review, so its findings below are recorded as owner-reported evidence.

| Acceptance group                                    | Final owner-reported result                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 2B.1-A — document-specific history isolation  | **PASS: all five physical tests.** Undo/history remained isolated between documents.                                                                                          |
| Stage 2B.1-B — exact Source selection               | **PASS in final physical retests.** Exact selected text survived Source > Preview Only > Source; backwards direction was preserved.                                           |
| Stage 2B.1-B — Source viewport                      | **PASS.** Wheel scroll was restored and remained stable through menus and application focus changes.                                                                          |
| Stage 2B.1-B — diagnostic trace                     | **PASS, owner-reported.** Selection endpoints and selected-text hashes stayed stable, Shift+Right contracted the selection as expected, and diagnostic errors were zero.      |
| Stage 2B.1-B — without the diagnostic               | **Both additional tests passed:** keyboard selection immediately after entering Source with no initial text click, and keyboard selection after an initial Source text click. |
| Stage 2B.1-C — Reading Mode                         | **PASS for tested behaviors.** Typing, paste, cut, deletion and Undo were blocked; copy and Find remained available.                                                          |
| Stage 2B.1-C — Preview Only                         | **PASS for tested behaviors.** Markdown rendered, editing stayed blocked in both Reading and Edit modes, and clipboard checks passed.                                         |
| Stage 2B.1-C — no-op transitions and visual history | **PASS.** No-edit layout transitions added no Undo boundary. First Undo removed the preceding visual edit; Redo restored it.                                                  |
| Stage 2B.1-C — available layouts and controls       | **PASS.** Only WYSIWYG, Markdown Source and Preview Only were available; menu, palette, footer and shortcuts behaved correctly.                                               |
| Stage 2B.1-C — original file contents               | **PASS.** The disposable document's final SHA-256 and byte length matched its exact original contents.                                                                        |
| Stage 2B.1-C — original modification timestamp      | **UNVERIFIED.** The original PowerShell variable was lost, so the original timestamp comparison was unavailable. No physical timestamp pass is claimed.                       |

The earlier physical selection failures are retained as genuine owner-reported observations. Their cause remains **unconfirmed**; neither final physical retests nor final automated tests reproduced them. Passing retests do not establish a root cause or retrospectively invalidate those observations. The separately confirmed navigation-column and late-focus-scroll defects, and the corrected diagnostic interference, remain documented above without being presented as the explanation for the owner's earlier selected-text failures.

Stage 2B.1 is accepted for the tested Windows behaviors, with the physical timestamp limitation explicitly retained. Earlier automated no-op byte/encoding/mtime checks remain separate evidence; they do not substitute for the missing original physical timestamp comparison. Physical IME coverage, non-Windows native interactions and the other previously stated verification limits are not expanded by this acceptance report.

### Final code audit and scope

The full diff and all seven new files were reviewed. No blocking implementation, security or scope issue was identified. Changes remain limited to derived layout capabilities, document-owned Source view/history retention and source/visual reconciliation, plus their tests and documentation. `isSourceLayout` retains its original Source-only meaning. Source focus protection is scoped to its input element, and histories/checkpoints remain transient and document-owned.

The manual diagnostic is not imported by production code. It is loaded explicitly by a test or by the owner in DevTools, validates the exact disposable fixture, records selection metadata/hashes rather than document text or paths, and restores its wrappers/listeners when stopped. The native Windows driver is imported only by the UI spec and runs outside the application in the test process. Neither changes production Electron settings or normal application startup.

Split remains a modeled identity only: the runtime validator rejects it, unsupported restored values use the existing fallback, and menus/palette still expose only the three implemented layouts. There is no live-preview host, Split pane, divider, pane-order implementation or scroll synchronization. The Source-to-Muya handoff remains an exit reconciliation path, not a live-preview refresh path.

No dependency/lockfile, main/preload, security configuration, packaging/branding, sidebar, file-dialog or session-schema changes are included. No generated build, log, screenshot, profile, physical trace JSON, accidental secret or user-specific hard-coded path was found in the change set. The documented `$env:TEMP` paths and test output paths are intentional disposable evidence locations. Existing Reading Mode assertions were updated to check editable Source and protected hidden Muya independently; no test was deleted or skipped to obtain a pass.

### Final verification and Git gate

The reviewed application/test files match the code from the recorded final passing verification; only this report changes during the final acceptance review. The retained automated evidence is **1,276 unit passes with 36 existing skips**, **176 distinct desktop UI passes**, and a final **24-case navigation rerun** that overlaps those 176 cases. Build, type-check and lint passed; lint reported **166 existing warnings**, with no new warning. These selected UI runs are not the entire repository UI suite.

The full automated suite was not rerun for this documentation-only update. Lightweight final checks completed on 11 November 2026:

| Final review check                                    | Actual result                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused layout and Source-transition units            | **31 passed**, two files, zero failures/skips; 14.37 seconds. Includes capability combinations, Split rejection, native state retention and document-owned reconciliation. These overlap the retained full unit suite.             |
| Read-only ESLint on all 14 changed/new code files     | **Passed**, zero errors and **four existing warnings** in that subset. This does not replace the earlier full-repository count of 166 existing warnings. Existing Node/Vite configuration notices remain. No auto-fix was applied. |
| Report Prettier write/check                           | **Passed**; formatting applied only to this updated Markdown report.                                                                                                                                                               |
| Tracked diff and all seven new-file whitespace checks | **Passed** using `git diff --check` and `git diff --no-index --check -- NUL <new-file>`.                                                                                                                                           |
| Scope, credential-pattern and artifact review         | **Passed**; all 15 files reviewed, no credential-pattern matches, no unrelated/generated artifacts identified, and no production import of either diagnostic helper.                                                               |
| Git branch, HEAD, inventory and index                 | **Matched** the approved baseline and expected 8 modified / 7 untracked / 0 deleted files. Index remains empty.                                                                                                                    |

Focused unit command: `pnpm -C packages/desktop exec vitest run test/unit/specs/document-layout.spec.ts test/unit/specs/source-transition-state.spec.ts --maxWorkers=2`. ESLint was invoked with the 14 changed/new `.ts`, `.vue` and `.js` paths and no `--fix` option. Build, type-check, full units and desktop UI suites were not rerun; no application or test code changed since their recorded final passing verification.

The checkout is on `feature/marktext-plus-one` at `c55d75e2fa812477f19bf3cd4f097abebb83d53a`, with **15 intended files: eight modified, seven new and zero deleted**. It is ready for one Stage 2B.1 commit after owner approval of this review, subject to normal hooks. No file is staged, and no commit, push or branch operation is authorized by this review. Stage 2B.2 still requires a separate approval.

## Limits and subsequent approval gates

Stage 2B.2 must prove the dedicated read-only Muya host, shared rendering options/clipboard presentation, two-instance event isolation and complete disposal **before** exposing Split. Stage 2B.3 can add composition, explicit active-pane command/search routing and revision-aware live updates. Divider/swap/persistence and reliable scroll mapping follow in a separately approved phase. The specification requires divider proportions and pane order; exact pixel/line matching is optional, while scroll synchronization must have a safe independent-scroll fallback.

The four-layout default preference remains a Stage 2C decision; current startup Source/WYSIWYG defaults are unchanged. Large-document responsiveness and delayed diagram/highlighting races require measurement and tests with the actual later preview host. No 1 MB or live-update timing claim is made for this infrastructure stage. Existing rendering/clipboard fidelity limits and runtime-only undo persistence remain. At the Stage 2B.1 checkpoint, Stage 2B.2 required explicit owner approval; the subsequently authorized investigation is recorded below.

## Stage 2B.2 — independent-preview investigation and blocker

11 November 2026. The owner authorized Stage 2B.2 against committed Stage 2B.1 baseline `cc74c31242534940d487403d7b58958e3a3fd567` on `feature/marktext-plus-one`. The branch, full SHA and clean working tree were verified before this investigation. Earlier baseline and acceptance statements above describe their historical checkpoints.

**Status: blocked before host implementation; not ready for Stage 2B.2 acceptance.** Two real Muya instances can render separate documents without replacing the editable document or its serialized history. However, the existing engine does not satisfy the requested cross-instance selection and disposal guarantees. The new readiness tests demonstrate four failures. No dedicated preview host, normal-app composition, runtime Split activation or scheduler has been implemented.

The owner's instruction explicitly says to stop and report if safe independence requires a substantial architectural change. Individual selection guards could be small fixes, but complete block/resource disposal and asynchronous renderer ownership need an engine-wide lifecycle contract that the current public interface does not provide. This is an engineering scope assessment, not a claim that independent instances are impossible. A wrapper that only disconnects its store listeners and removes its root would leave the demonstrated callbacks and rendering work active. Application code is unchanged while that larger repair boundary is reviewed.

### Confirmed evidence

`packages/muya/src/__tests__/previewHostReadiness.spec.ts` constructs actual Muya instances, their real block trees, native DOM selections, input dispatch and diagram attachments. It does not mock Muya, its parser, history, selection, diagram block or diagram rendering coordinator. For the two async tests, only the dynamically loaded external diagram renderer is replaced with a controlled promise/renderer. This makes completion order deterministic without timing sleeps, network requests or heavy renderer imports in happy-dom. Those tests establish coordinator behavior, not compatibility of the external Mermaid/Vega libraries in Electron.

| Readiness probe                 | Expected contract                                                                                              | Actual result                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Independent rendering/history   | Hydrating and updating a read-only second engine leaves the editable engine's Markdown/history unchanged.      | **Passed.** Real bold/italic nodes rendered; the editable engine's Markdown and serialized history stayed equal. This does not establish application-store, Source or OS clipboard isolation.                                        |
| Selection ownership             | Asking the editable engine for its selection while a native range belongs to the preview returns no selection. | **Failed.** `editable.getSelection()` resolves the preview's block as its own result. No cross-document mutation is asserted by this test.                                                                                           |
| Root input teardown             | Dispatching input against the retained detached root after `destroy()` invokes no editor input callback.       | **Failed.** The editor callback still reads `isReadOnly` once. This demonstrates an attached callback, not an unbounded garbage-collection leak or a physically reachable detached control.                                          |
| Destruction during rendering    | Completing a pending diagram load after `destroy()` does not draw or install finalization work.                | **Failed.** One draw and one new `MutationObserver` were recorded after destruction. The probe explicitly cancels the observed finalizer afterward so its timer does not leak from the test. No detached DOM reinsertion is claimed. |
| Out-of-order diagram completion | A newer diagram remains displayed when an earlier render completes later.                                      | **Failed.** The earlier result overwrites the latest result on the same real diagram attachment.                                                                                                                                     |

These are newly exposed failures in unchanged baseline engine code, not failures introduced by a preview-host implementation. They remain ordinary failing assertions, with no skip, expected-failure marker, assertion relaxation or timeout increase. Existing passing editor tests remain intact.

### Ownership gaps traced in source

- `packages/muya/src/selection/TextSelection.ts::getSelection` resolves the document-wide native selection without checking either endpoint's owning Muya. `getSelectedText` has a narrower ownership check already, but the general selection API and its command callers do not inherit that protection.
- `packages/muya/src/editor/index.ts::_dispatchEvents` subscribes directly to an RxJS merge of root DOM events without retaining its subscription. `Muya.destroy()` detaches events registered with `EventCenter`; it does not unsubscribe this separate dispatch subscription.
- `packages/muya/src/block/extra/diagram/diagramPreview.ts` creates a direct click subscription and starts async rendering. Completion has no disposed/revision guard. Its finalizer has a cancellation closure, but destruction and block removal do not invoke it. `TreeNode.remove`/`Parent.empty` unlink/remove nodes without a general recursive resource-disposal contract. Finalization's five-second safety timeout bounds one observer's duration; it does not meet immediate host disposal requirements.
- `packages/muya/src/utils/diagram/render.ts` awaits loading/parsing/rendering before writing to its target and binding callbacks, without a lifetime token. Vega rendering discards the embed result instead of retaining the view's cleanup handle. Mermaid initialization changes a shared renderer's configuration. Per-render export directives exist, but normal rendering still initializes the shared renderer. The latter two risks were identified by source review, not reproduced as Electron failures here.
- `packages/muya/src/muya.ts::init` unconditionally instantiates globally registered `Muya.plugins`; there is no per-instance plugin allowlist/opt-out. The desktop registers editing toolbars and selectors through that registry. Temporarily clearing the global registry would be unsafe for coexisting instances and is not proposed.
- `packages/muya/src/utils/image.ts::getImageSrc` reads `window.DIRNAME`. `inlineRenderer/renderer/loadImageAsync.ts` uses document-wide ID lookup and can update its renderer cache after async completion. The future preview needs its own document-directory context and scoped resource lifetime. No path-resolution or image-race correction is claimed.

The current Stage 2A Preview Only uses the existing visual engine; these findings do not invalidate its accepted clipboard correction. The existing rendered clipboard adapter is root-scoped and has an explicit disposer. The proposed host should reuse it and the existing marker presentation, rather than use Muya's Markdown-offset copy pipeline or invent a renderer.

### Proposed repair and host boundary for review

Before exposing a preview host, establish an explicit engine lifetime and per-render/block ownership boundary. It should dispose RxJS subscriptions, block/attachment listeners and observers, cancel owned timers, release renderer resources, and invalidate delayed results on content replacement as well as engine destruction. Non-cancellable external promises may settle, but their continuations must not write or install new resources after invalidation. Preserve existing editing behavior with regression tests for ordinary block replacement and visual undo/redo. Add endpoint ownership checks, a per-instance UI plugin policy, captured image-directory resolution and a safe shared-diagram configuration policy. This affects the engine beneath existing WYSIWYG and Preview Only, so it needs review beyond a new desktop wrapper.

After those repairs, the intended desktop service can own one private, non-Vue-proxied Muya plus its root and clipboard disposer. Its input should contain document ID, owner generation, revision, canonical Markdown, document-directory context and approved rendering preferences. The public surface should expose only render-only updates, root-scoped read operations/navigation and disposal; it should not expose permission setters, mutation commands, history setters, the engine itself or document serialization. Reject disposed/superseded owner updates, ignore old revisions, and make identical accepted input a no-op. These are interfaces for subsequent work, not an implemented revision scheduler.

The host must have no store mutation subscriptions, content-change bus forwarding, save/autosave calls, Source view registration or `sourceTransitions` checkpoint/reconciliation participation. In particular, do not call the existing Source-to-visual handoff or `replaceContent` to refresh it. Reuse vetted rendering options/styles without copying editing-only clipboard/file/image-write callbacks into a preview. Keep existing link sanitization, HTML policy and Electron boundaries unchanged. Find, outline navigation and copy require explicit root ownership; they must not silently route through the editable engine. No implementation or guarantee of these host interfaces is claimed at this checkpoint.

### Reproduction and manual acceptance boundary

The focused readiness probes run without real document contents, user profiles, OS clipboard access or physical input:

```powershell
pnpm.cmd -C packages/muya exec vitest run src/__tests__/previewHostReadiness.spec.ts --maxWorkers=2 --reporter=verbose
```

The command currently exits **1**, with **one pass and four failures**. Do not classify those failures as successful acceptance. Re-run the same assertions when reviewing the engine repair; all five must pass without suppressing failures. Then add real Electron integration with two simultaneous instances before accepting a host. That integration must verify application-store/dirty/save isolation, Source selection/search/history, task-checkbox and mutation attempts, native plain/rich clipboard contents, approved links/HTML/images/math/diagrams, repeated ownership changes and delayed disposal. This happy-dom investigation cannot substitute for those checks.

There is currently no new host to mount or physically accept. The owner should not repeat a side-by-side Split acceptance procedure against this checkout. An optional baseline Windows sanity check can use a disposable fixture/profile:

```powershell
$previewRoot = Join-Path $env:TEMP ('MarkTextPlus1-stage2b2-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $previewRoot | Out-Null
$previewProfile = Join-Path $previewRoot 'profile'
$previewFixture = Join-Path $previewRoot 'baseline.md'
[IO.File]::WriteAllText($previewFixture, "# Disposable preview test`r`n`r`n**Bold** and *italic*`r`n`r`n- [ ] Task", [Text.UTF8Encoding]::new($false))
$previewHashBefore = (Get-FileHash -LiteralPath $previewFixture -Algorithm SHA256).Hash
$previewLengthBefore = (Get-Item -LiteralPath $previewFixture).Length
$previewTimeBefore = (Get-Item -LiteralPath $previewFixture).LastWriteTimeUtc
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm.cmd run start -- --user-data-dir "$previewProfile" "$previewFixture"
```

Verify that only WYSIWYG, Markdown Source and Preview Only are available. Repeat the accepted Source selection/scroll/history round trips, Reading Mode protection and rendered Preview copy checks. For this no-edit fixture, close the application normally and compare:

```powershell
((Get-FileHash -LiteralPath $previewFixture -Algorithm SHA256).Hash -eq $previewHashBefore)
((Get-Item -LiteralPath $previewFixture).Length -eq $previewLengthBefore)
((Get-Item -LiteralPath $previewFixture).LastWriteTimeUtc -eq $previewTimeBefore)
```

All three should be true. This is a proposed manual baseline check, not a new physical pass claim or dedicated-host acceptance. No real documents, personal profiles or contents should be logged.

### Automated verification

All commands used the existing Windows runner and installed dependencies. No Electron security flags, dependency installs, assertion weakening or added skips were used.

| Command / scope                                                                                                                                                                                                                            | Actual result                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd -C packages/muya exec vitest run src/__tests__/previewHostReadiness.spec.ts --maxWorkers=2 --reporter=verbose`                                                                                                                   | **1 passed, 4 failed**, one file; reproduced on all three runs, including the final type-corrected fixture. Final run: 6.08 seconds, exit 1. These are the unresolved readiness failures listed above.            |
| `pnpm.cmd -C packages/muya exec vitest run src/editor/__tests__/readOnly.spec.ts src/__tests__/muyaDestroyPlugins.spec.ts src/selection/__tests__ src/clipboard/__tests__ src/block/extra/diagram/__tests__ --maxWorkers=2 --reporter=dot` | **348 passed**, 57 existing files, no failures/skips; 112.51 seconds. Selected engine regression suite, not the complete Muya suite or conformance suite.                                                         |
| `pnpm.cmd -C packages/desktop exec vitest run test/unit --maxWorkers=2 --reporter=dot`                                                                                                                                                     | **1,276 passed, 36 existing skips**, 124 passed / four skipped files; 270.60 seconds, exit 0. Full desktop unit suite, including layout rejection, Source transitions, Reading Mode and rendered clipboard units. |
| `pnpm.cmd run build:unpack`                                                                                                                                                                                                                | **Passed**, exit 0. Existing CodeMirror ineffective-dynamic-import build notices remain. No packaging performed.                                                                                                  |
| `pnpm.cmd run typecheck`                                                                                                                                                                                                                   | **Passed**, exit 0; includes Muya declaration generation and desktop `vue-tsc`.                                                                                                                                   |
| `pnpm.cmd run lint`                                                                                                                                                                                                                        | **Passed**, zero errors, **166 existing warnings**, exit 0. Root lint excludes Muya.                                                                                                                              |
| `pnpm.cmd -C packages/muya lint`                                                                                                                                                                                                           | **Passed**, zero errors, **four warnings** in unchanged `block/base/format.ts`. Muya reports that some editor-sensitive lint rules are disabled in this environment.                                              |

An initial probe-only lint check found three style errors, which were corrected. The first Muya full-program type-check also found a missing `TreeNode` narrowing in the new test fixture; that test-only error was corrected using `isParent()`. Neither finding required an application change. Final `pnpm.cmd -C packages/muya lint:types` passed (exit 0), and read-only ESLint on the final probe file passed with zero errors/warnings. The focused tests were rerun after the type correction and retained the same one-pass/four-failure result.

Report-only `pnpm.cmd exec prettier --write docs/MarkTextPlus1/stage-2b-split-view.md` and its subsequent `--check` passed. Muya uses its own ESLint formatting rules rather than root Prettier. `git diff --check` passed; `git diff --no-index --check -- NUL packages/muya/src/__tests__/previewHostReadiness.spec.ts` emitted no whitespace diagnostics (exit 1 denotes the new-file difference). Final scope review confirmed just the report and new test, an empty index, the unchanged baseline SHA/branch, and no production, dependency, security or unrelated changes.

**Not run:** dedicated-host Electron integration, selected existing desktop UI reruns, physical Windows acceptance, full Muya units and CommonMark/GFM conformance. The explicit architectural stop condition was reached before implementing a host or desktop mount harness. Existing UI acceptance evidence above is historical; it is not presented as a new Stage 2B.2 run. Native clipboard, actual external diagram engines, image context isolation, store/Source isolation and complete disposal remain unverified for a dedicated host. Running all default Muya units now would also include the four retained failing readiness assertions; the new test is deliberately not excluded from discovery.

Verification logs are outside the checkout at `$env:TEMP\MarkTextPlus1-stage2b2-{readiness,muya-existing,desktop-units,build,typecheck,lint,muya-lint,muya-types}.log`; they contain disposable test data, not user document contents. No log is staged or included in the inventory.

### Changed-file inventory

1. `packages/muya/src/__tests__/previewHostReadiness.spec.ts` — five readiness probes, including four confirmed unsatisfied contracts; no production import or runtime test interface.
2. `docs/MarkTextPlus1/stage-2b-split-view.md` — this investigation, scope decision, evidence and follow-up design.

No application implementation, dependency/lockfile, IPC, persistence, file dialog, security, packaging or branding file changed. No existing tests were deleted or weakened. Generated build output and verification logs are not included in the change set. Split remains rejected by `isAvailableDocumentLayout` and unavailable in menus/palette. Stage 2B.3 has not started; nothing is staged, committed or pushed.

### Stage 2B.2-R1 — Instance Ownership and Subscription Cleanup

11 November 2026. The owner approved exactly the selection-ownership and root-input subscription repairs against `cc74c31242534940d487403d7b58958e3a3fd567`, with the two existing investigation files preserved. The earlier four-failure results above describe the pre-repair checkpoint. R1 changes only these two engine contracts; it does not complete Stage 2B.2 or provide a dedicated preview host.

#### Confirmed causes and corrections

`TextSelection.getSelection()` previously resolved the document-wide native endpoints into blocks without validating the receiving instance. The narrow check in `getSelectedText()` protected only that convenience method. Ownership now lives in the general lookup: the editor must not have been destroyed, its root and both endpoints must be connected, both endpoints must be contained by that root, and both resolved blocks must belong to that Muya instance. Invalid, partially external, cross-instance, detached and destroyed selections return `null` before being used. A foreign block moved into another root is also rejected by the block-owner check. No active-editor singleton or focus-based substitute is used. The now-redundant narrower selected-text check and its obsolete comment were removed.

`Editor._dispatchEvents()` previously discarded the subscription returned by `merge(...).subscribe(...)`. Those listeners did not belong to `EventCenter`, so its teardown could not remove them. Each `Editor` now owns an RxJS `Subscription` group containing its root dispatch subscription. `Muya.destroy()` first calls `Editor.destroy()`, which unsubscribes the group and removes all six root event listeners: click, input, keydown, keyup, compositionstart and compositionend. RxJS makes repeated unsubscription idempotent. The group's closed state also supplies the editor's destroyed status for selection lookup, so reconnecting a destroyed root cannot restore valid selection ownership. No additional mutable global state or dependency is introduced.

This is **complete teardown of the affected root input dispatch**, not a claim of complete Muya resource disposal. Existing `EventCenter` cleanup remains responsible for its own listeners; plugin, block and asynchronous renderer lifetimes remain separate. R1 does not change their teardown or claim that every existing plugin tolerates repeated destruction.

#### Downstream compatibility review

The existing return type remains `ISelection | null`. Reviewed consumers in editor dispatch, Muya formatting/cursor/render/rebuild operations, clipboard copy/cut/paste/image paste, inline/quick-insert tools, content cursors, GitHub alert conversion and history already guard null, use optional access, or retain nullable selection records. Desktop `serializeCursor` accepts null, and document-owned Source checkpoints already use `IHistorySelection | null`. No downstream dereference fix was required.

Existing instance-owned cached-selection fallbacks for menu round trips remain unchanged. R1 does not implement active-pane command routing, full clipboard isolation, or Source history reconciliation changes. In particular, a null live selection must not be interpreted as new authorization to edit another document; the existing permission and command layers remain in place.

#### Regression coverage and before/after evidence

Two new files exercise real Muya instances and DOM events, without mocking the engine or dispatch subscription:

- `selection/__tests__/instanceOwnership.spec.ts`: **13 cases** covering selection wholly in A or B without focus, cross-instance endpoints in both directions, either endpoint outside the root, foreign blocks transplanted into another root, retained endpoints after content/root detachment or destruction, a reattached destroyed root, and valid forward/backward multi-block ranges. In-process clipboard payloads and selected text retain their expected values. Detached-endpoint tests preserve an endpoint snapshot because browsers may clear a live range when nodes are removed; they do not mock block ownership or the engine.
- `editor/__tests__/inputSubscriptionCleanup.spec.ts`: **11 cases** covering all six active dispatch routes, active read-only protection, destroying editable/read-only instances while a peer stays active, retained detached roots, exact listener removal once across repeated destruction, and eight create/destroy cycles. Routing tests spy on leaf handlers to observe dispatch without synthesizing browser editing behavior. A separate listener audit matches the six listeners outside `EventCenter` and verifies their removal, rather than relying only on a read-only early return.

Before engine changes, the combined new regressions recorded **11 passed / 13 failed**, exit 1. After the repairs, all **24 passed**. The combined focused run with the unchanged five readiness probes recorded **27 passed / two failed**; only the two asynchronous diagram assertions failed. A single lint style error in the initial multiline ownership guard was corrected with braces; no test assertion was relaxed.

The original readiness file is byte-for-byte unchanged from the start of R1: SHA-256 `64542A2E645D52376AE37E4979F8502BCE0DF33DC937940CE583E7B5A081347E`. Its three non-diagram cases now pass. Destruction during diagram rendering and out-of-order diagram completion remain ordinary, active failing assertions, with the original expectations intact. They are unresolved pre-existing readiness defects outside R1, not new failures introduced by this repair.

#### R1 automated verification

Commands used the installed toolchain and normal Windows runner. The following counts overlap: the focused tests and readiness cases are also discovered by the full Muya unit run; they must not be added together as distinct tests.

The first complete Muya unit run, `pnpm.cmd -C packages/muya exec vitest run --maxWorkers=2 --reporter=dot`, recorded **2,897 passed / three failed**, 304 passed / two failed files, no skips; 394.07 seconds, exit 1. Besides the two known diagram readiness failures, the unchanged `block/content/langInputContent/__tests__/diagramLanguage.spec.ts` case “keys off the first word of the info string, like loading the fence” hit its existing 5,000 ms timeout. That run overlapped desktop verification/build workloads. No causal attribution to those workloads or to R1 is established.

The entire unchanged diagram-language spec then passed **all eight cases** in isolation (9.38 seconds, exit 0); the previously timed-out case completed in 3,482 ms. No code, test expectation, timeout or worker count was changed. Its existing happy-dom Mermaid-render error messages remained; those model/conversion assertions do not establish actual browser diagram-rendering safety. The timeout is retained as an additional first-run result, not silently reclassified as an expected failure or hidden by the passing rerun.

A second **complete, unchanged** Muya run, using the same command and two workers without concurrent build/desktop verification workloads, recorded **2,898 passed / two failed**, 305 passed / one failed file out of 306, no skips; 308.11 seconds, exit 1. Only the two retained diagram readiness assertions failed. All existing selection, clipboard, read-only, history, destruction and language-conversion unit assertions passed in that run. The earlier timeout did not recur, but its cause and whether it would occur on the unmodified baseline remain unconfirmed. No additional reproducible regression was found. Both full-run logs are retained separately; this is not a claim of a completely green Muya suite.

| Command / scope                                                                        | Actual R1 result                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New ownership and input tests before repairs                                           | **11 passed / 13 failed**, 24 cases in two files; 5.22 seconds, exit 1.                                                                                                                                     |
| New ownership/input tests plus unchanged readiness tests after repairs                 | **27 passed / two failed**, 29 cases in three files; 7.94 seconds, exit 1. All 24 R1 cases passed; both failures are the retained diagram assertions.                                                       |
| Owner's standalone readiness command                                                   | **Three passed / two failed**, five cases in one file; 6.63 seconds, exit 1. No readiness-file edit.                                                                                                        |
| `pnpm.cmd -C packages/desktop exec vitest run test/unit --maxWorkers=2 --reporter=dot` | **1,276 passed / 36 existing skips**, 124 passed / four skipped files, no failures; 273.93 seconds, exit 0. Full desktop units, including layout/Source/history/Reading Mode/Preview clipboard regressions. |
| `pnpm.cmd -C packages/muya lint:types`                                                 | **Passed**, exit 0, including the new tests.                                                                                                                                                                |
| `pnpm.cmd -C packages/muya lint`                                                       | **Passed**, zero errors and four warnings in unchanged `block/base/format.ts`. The environment-sensitive lint-rule notice remains.                                                                          |
| `pnpm.cmd -C packages/muya check-circular`                                             | **Passed**, no circular dependency, exit 0. Madge reported 27 warnings while processing 307 files.                                                                                                          |
| `pnpm.cmd run build:unpack`                                                            | **Passed**, exit 0. Existing CodeMirror ineffective-dynamic-import notices remain; no packaging performed.                                                                                                  |
| `pnpm.cmd run typecheck`                                                               | **Passed**, exit 0; Muya declarations and desktop `vue-tsc`.                                                                                                                                                |
| `pnpm.cmd run lint`                                                                    | **Passed**, zero errors / 166 existing warnings, exit 0. Root lint excludes Muya.                                                                                                                           |

Focused after-repair command:

```powershell
pnpm.cmd -C packages/muya exec vitest run src/selection/__tests__/instanceOwnership.spec.ts src/editor/__tests__/inputSubscriptionCleanup.spec.ts src/__tests__/previewHostReadiness.spec.ts --maxWorkers=2 --reporter=verbose
```

No Electron/browser UI suite, physical Windows acceptance or CommonMark/GFM conformance run is claimed for R1. There is no dedicated host or runtime Split pane to exercise; real-engine unit coverage does not establish native clipboard isolation. No security settings, assertion expectations, timeouts or skip lists were changed. R1 logs are outside the checkout at `$env:TEMP\MarkTextPlus1-stage2b2-r1-*.log`, including the before/focused/readiness, full units, lint/type, build and circular checks; no log is included in the change set.

#### Scope, limitations and manual follow-up

Rejecting foreign/disconnected ranges changes an unsafe lookup result to null in both WYSIWYG and Preview Only. Valid same-instance ranges, their direction, source-text copy payloads and active event routing are covered by the new tests; existing engine regressions provide broader compatibility evidence. Unit DOM tests do not establish physical Windows keyboard/IME behavior, OS plain/rich clipboard isolation or complete preview-host safety. The asynchronous diagram, plugin policy and image-context questions above remain unresolved. No diagram code or readiness assertion was changed, and no R2/R3 work was performed.

For optional physical sanity testing, use the disposable-profile procedure above. In WYSIWYG Edit Mode, select within and across paragraphs in both directions, type, undo/redo and copy. Repeat selection/copy and Find in Reading Mode and Preview Only; confirm edits stay blocked. Repeat the accepted Source selection/scroll round trip and no-edit file hash/length/timestamp checks. Close normally, reopen the disposable profile and confirm the three existing layouts remain available. These steps have not been performed or claimed as a new physical acceptance pass by the agent. A two-instance preview-host physical check is not available yet.

#### Exact working-tree inventory

| File                                                                  | R1 ownership / purpose                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/muya/src/selection/TextSelection.ts`                        | Live-root, endpoint and resolved-block ownership validation.       |
| `packages/muya/src/editor/index.ts`                                   | Per-editor dispatch subscription ownership and idempotent cleanup. |
| `packages/muya/src/muya.ts`                                           | Invoke editor input teardown during Muya destruction.              |
| `packages/muya/src/selection/__tests__/instanceOwnership.spec.ts`     | New selection isolation and compatibility regressions.             |
| `packages/muya/src/editor/__tests__/inputSubscriptionCleanup.spec.ts` | New input lifecycle and peer-isolation regressions.                |
| `packages/muya/src/__tests__/previewHostReadiness.spec.ts`            | Pre-existing untracked investigation file, preserved unchanged.    |
| `docs/MarkTextPlus1/stage-2b-split-view.md`                           | Preserve the investigation and append this R1 evidence.            |

There are three modified engine source files, two new R1 test files, the preserved readiness test and this report. No Source/history, desktop application, IPC, session/persistence, dialogs, dependency/lockfile, security, packaging or branding file changed. Split activation is unchanged and remains rejected. No preview host or later stage is implemented. No file is staged and no commit, push or merge is made.

Final read-only checks passed: repository Markdown Prettier formatting/check, Muya's own ESLint formatting rules, `git diff --check`, and new-file whitespace checks for all three untracked tests. The final readiness hash still matches the value above. Git remains on `feature/marktext-plus-one` at the approved baseline, with four modified tracked files, three untracked files, no deletions and an empty index. Earlier report sections remain historical evidence; this subsection records the R1 outcome.

**R1 is ready for owner review**, with the first-run timeout disclosed. Full Stage 2B.2 remains blocked on the outstanding diagram/isolation work and still has no preview host. R2/R3 or later implementation requires separate approval.

### Stage 2B.2-R2 — Diagram Lifecycle and Async Rendering Safety

11 November 2026. The owner authorized R2 on `feature/marktext-plus-one`, committed baseline `cc74c31242534940d487403d7b58958e3a3fd567`. The seven existing uncommitted investigation/R1 files were verified before editing and preserved. The owner separately reported passing physical R1 checks for WYSIWYG selection, formatting/history, Reading Mode, Preview Only/Source restoration and repeated layout navigation. Those are owner-reported checks, not agent physical tests. The owner's original file-integrity check was still being verified separately; no pending original-file result is assumed passed by R2.

#### Root causes and lifecycle ownership

The remaining two readiness failures had different boundaries. `DiagramPreview.update()` and the rendering helper did not distinguish current work from superseded or disposed work; awaited completions could write into the same DOM root, then install finalization. Separately, permanent block/attachment removal had no resource-disposal traversal. The click subscription, observer cancellation closure and renderer-specific handles had no common removal owner.

R2 adds an idempotent resource lifetime to `TreeNode` and recursive ownership-aware disposal to `Parent`. `remove()` performs the existing unlink/state operation and then disposes permanently. `detach()` performs the unlink/state operation while retaining the lifetime for a move. `insertInto()` uses detach, so sidebar/paragraph dragging and checked-list moves preserve live block instances. Removing an attachment unlinks it from the attachments list without creating a document-child removal operation. Disposal/emptying follows only nodes still owned by that parent; a node promoted/reparented into a new container must not be disposed through an obsolete linked-list reference. No concrete unrelated block hierarchy was rewritten.

`Muya.destroy()` retains the R1 input teardown and then disposes the current scroll-page tree, including attachments. Normal removal/replacement, `setContent`, bulk history rebuilds and incremental undo/redo reach the same disposal boundary. Undo/redo reconstruct removed nodes as fresh instances; a retired attachment is not revived. Disposal itself does not serialize Markdown, edit JSON state, touch undo stacks or write files. The existing mutation/Reading Mode guards on document operations remain in place; resource disposal is not a new document permission system.

Each diagram attachment owns its click subscription, finalization cancellation closure and current render `AbortController`. Every update aborts the previous request; permanent disposal aborts current work, removes the click subscription, cancels observation/timers and prevents further updates. The diagram's delayed Prism-language completion also checks block/editor lifetime before updating. R1 selection ownership and root input subscription changes are unchanged.

#### Render generations and native resource handles

Each request receives a fresh private `.mu-diagram-render` target inside the stable preview root. Aborting removes that target. This matters because a third-party renderer may itself write while its promise is pending: late work can reach its retired target but cannot replace the current preview. The signal is checked after asynchronous loading/parsing/rendering and before committing SVG or binding callbacks. Only a valid attachment/request can mark rendering successful or install finalization. Obsolete errors are awaited/caught and cannot overwrite the latest result. Repeated identical updates remain safe and release the preceding resources.

- Mermaid retains the existing strict security configuration and unique render IDs. Stale parse/render completions do not commit SVG or invoke `bindFunctions`; disposal releases the request's rendered DOM. Shared Mermaid initialization/theme policy is **unchanged and reserved for R3**.
- Flowchart retains the parsed diagram's supported `clean()` handle and calls it once on retirement.
- Vega uses the installed embed API's supported `viewClass` hook, with a request-owned subclass of the existing native `View`. This obtains the resource lifetime before embedding returns, so cancellation or an embedding rejection can finalize an already-created view. Finalization is idempotent; late view creation/initialization is rejected after cancellation. The embed result's `finalize()` handle is retained as well. Existing `actions: false`, `tooltip: false`, SVG output and AST interpretation are preserved.
- The local sequence adapter returns a disposer, releases an existing Snap paper, and checks lifetime before resuming font-delayed drawing. Both font-active and font-inactive completions are covered against the actual vendored adapter. The external font-loader API cannot cancel its shared load; late completion cannot start an obsolete drawing. Vendor formatting/license attribution remain intact, and the ambient declaration reflects the additive disposer/signal API.
- Active diagram finalization still supplies SVG sizing and accessible names. Its existing five-second safety timer is now cancelled when observation succeeds, is cancelled or expires. Disposal is idempotent and clears observer/timer references.

The SVG sizing rule preserves the original direct-SVG case and adds the generation-wrapper case at the same specificity using `:where`. Existing themes, diagram viewer lookup and preview root identity remain unchanged. No alternative renderer, Markdown parser, new dependency, source-to-visual live handoff, plugin isolation or image-directory policy is introduced.

#### Tests and investigation evidence

The unchanged readiness command first recorded **three passes / two failures**, 6.56 seconds, exit 1. After repair, all five probes passed within the focused/full runs. The final standalone command, `pnpm.cmd -C packages/muya exec vitest run src/__tests__/previewHostReadiness.spec.ts --maxWorkers=2 --reporter=verbose`, also passed **all five probes**, 4.50 seconds, exit 0. Its SHA-256 remains `64542A2E645D52376AE37E4979F8502BCE0DF33DC937940CE583E7B5A081347E`; no original assertion, skip list or expected-failure marker changed. All **24 R1 cases** remain active and passing.

There are **29 new Muya R2 cases**: 19 real-engine diagram lifecycle cases, eight rendering-helper ownership cases, and two cases exercising the actual vendored sequence font callback. Coverage includes editor/attachment/block/document removal, replacement, reverse completion, rapid requests, identical updates, stale rejection, observer/timer/listener cancellation, repeated disposal, surviving peers, live moves, promoted children, bulk and incremental undo/redo, canonical Markdown/history preservation and repeated editor construction/destruction. The Vega case constructs native `View` instances to test finalization during pending embedding. Controlled renderer promises make races deterministic; they do not replace the Muya engine or assert that mock renderers prove external browser fidelity.

The two new Electron cases use real Mermaid, flowchart, sequence and Vega in the normal application. Both permissions traverse WYSIWYG, Preview Only and Source, verify rendered SVG/accessibility/sizing, compare raw Source, confirm permission protection and compare disposable file bytes/mtime. The initial run failed both cases at the final renderer-error assertion because the new test passed a `Page` to a helper requiring `ElectronApplication`; the run also recorded one worker-teardown timeout. The new test call was corrected to use `app`, without changing the shared helper, application, assertions or timeout. The rerun passed **both cases** in 9.6 seconds with no captured renderer errors. The initial desktop type-check caught that same test-call error; it was corrected rather than bypassed.

The first complete Muya R2 run recorded **2,928 passes / one failure**, 308 passed / one failed file out of 309; 308.37 seconds, exit 1. All readiness probes passed; the failure was the previously reported 5,000 ms diagram-language timeout. It was investigated rather than attributed automatically to contention. The unchanged R2 spec passed all eight cases in isolation (10.69 seconds, timed case 4,172 ms), and an isolated archive of the committed baseline using the same installed dependencies passed all eight cases (10.44 seconds, timed case 3,596 ms). The checkout/branch/index were not switched or reset for that comparison; the archive and dependency junction are in TEMP.

Inspection confirmed that the language-conversion fixture removed DOM hosts without destroying its Muya instances, allowing renderer work to survive between cases. The fixture now calls `Muya.destroy()` for each owned instance; **every original test assertion and the original timeout remain unchanged**. The corrected fixture passed all eight cases (10.40 seconds, timed case 3,752 ms), with no stale Mermaid errors in that run. The exact cause of the earlier elapsed-time threshold failure remains unconfirmed; the passing comparison alone does not establish that timeout as an inherited deterministic failure.

The final **complete** Muya run passed **all 2,929 tests in 309 files**, no skips/failures; 381.34 seconds, exit 0. This includes selection, clipboard, read-only, history, destruction, diagram, R1 and R2 regressions. The earlier timeout did not recur. Focused runs overlap this total and must not be added as distinct tests.

#### Desktop native-input verification blocker

The selected existing Electron regression run completed **93 passed / 13 failed out of 106**, 6.2 minutes. All failures were in the unchanged `source-navigation-restoration.spec.ts`: twelve native-key fixture cases failed the **initial** backwards-selection assertion before any layout round trip, and one multi-tab case could not open/focus the command palette through native keys. The existing Chromium-keyboard selection/scroll, source-history, Reading Mode, Preview copying, diagram viewer/theme and sandbox/security cases passed. This is a selected suite, not the entire desktop repository suite.

An isolated rerun of the unchanged 24-case Source navigation file recorded **12 passed / 12 failed**, 2.2 minutes; one previously failing native fixture case passed on that rerun. These results are not hidden or classified automatically as inherited failures. The precise cause and attribution of the native-input failures remain unconfirmed, and native Source acceptance is **blocked** at this checkpoint.

Temporary diagnostics used only disposable content, process IDs, focus booleans and controlled key events. A probe saw the Electron main PID as the OS foreground PID with both application/DOM focus true. A separate controlled native Ctrl+End/Shift+Up probe formed a backwards selection from line 181 to line 179; Chromium keys produced the same endpoints. These observations demonstrate that native input can work here, but do not establish why the failing fixtures missed their initial selection.

Two test-only experiments explicitly focused the target window/WebContents and then tried native-key event acknowledgement. The first targeted two-case run recorded **one pass / one failure**; the second recorded **two failures** waiting for native completion. Neither was a reliable repair. Their changes were therefore **removed**, with no production focus change or relaxed assertion. The Source navigation file's Git blob is again identical to HEAD: `12d21ed5c65952965f33aed5b240947d224110a4`. The temporary diagnostic spec was also removed from the checkout; copies/results remain in TEMP for review. No new focus/keyboard workaround is shipped.

Microsoft documents that `SendWait` targets the active application and may not wait for processing in another process when its SendInput implementation is used. See [SendKeys.SendWait remarks](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.sendkeys.sendwait?view=netframework-4.8). This supports investigating the input driver, but does **not** establish that timing limitation as the unique cause of these failures. Native keys were not replaced with Chromium input to obtain a pass, and no delays/timeouts or test expectations were enlarged.

#### R2 verification summary

| Command / scope                                                                        | Actual final result                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged readiness suite                                                              | **Five passed**, included in the focused and complete Muya runs; before R2, three passed / two failed.                                                                                                                                                                              |
| R1 regressions                                                                         | **24 passed**, included in those runs; no R1 test-file edits.                                                                                                                                                                                                                       |
| New R2 Muya regressions                                                                | **29 passed** in three files, included in the complete run.                                                                                                                                                                                                                         |
| Focused readiness/R1/diagram selection                                                 | **97 passed**, eight files, 13.59 seconds, no skips/failures.                                                                                                                                                                                                                       |
| `pnpm.cmd -C packages/muya exec vitest run --maxWorkers=2 --reporter=dot`              | Final **2,929 passed**, 309 files, no skips/failures; the earlier one-timeout run is retained above.                                                                                                                                                                                |
| `pnpm.cmd -C packages/desktop exec vitest run test/unit --maxWorkers=2 --reporter=dot` | **1,276 passed / 36 existing skips**, 124 passed / four skipped files; 235.35 seconds, exit 0.                                                                                                                                                                                      |
| New real-renderer Electron tests                                                       | Final **two passed**, 9.6 seconds. Initial two failures and worker-teardown error from the incorrect new test call are retained above.                                                                                                                                              |
| Selected existing Electron suite, 12 files                                             | **93 passed / 13 failed**, 106 cases; native Source failures remain unresolved.                                                                                                                                                                                                     |
| Isolated unchanged Source navigation rerun                                             | **12 passed / 12 failed**, 24 overlapping cases; no pass manufactured by changing assertions.                                                                                                                                                                                       |
| `pnpm.cmd run build:unpack`                                                            | **Passed**, exit 0. Existing CodeMirror dynamic-import/plugin timing notices remain; no packaging.                                                                                                                                                                                  |
| `pnpm.cmd -C packages/muya lint:types` / `pnpm.cmd run typecheck`                      | **Passed** after correcting the sequence disposer declaration and the new desktop test's helper argument.                                                                                                                                                                           |
| `pnpm.cmd -C packages/muya lint`                                                       | **Passed**, zero errors / four existing warnings; no new warnings. Vendored JS retains its existing lint exclusion and is exercised by the actual-adapter tests.                                                                                                                    |
| `pnpm.cmd run lint`                                                                    | **Passed**, zero errors / 166 existing warnings; no new warnings.                                                                                                                                                                                                                   |
| `pnpm.cmd -C packages/muya check-circular`                                             | **Passed**, no cycles; existing tool reported 27 warnings while processing 307 files.                                                                                                                                                                                               |
| Additional targeted CSS Stylelint                                                      | **Failed with one inherited error / three inherited warnings**, exit 2, matching a temporary copy of the committed stylesheet. An initial extra specificity error from the new wrapper selector was corrected; no CSS lint rules were disabled and unrelated CSS was not reordered. |

The inherited CSS error is the existing `.mu-content` ordering relative to `.mu-code-block .mu-content` (current line 1014, baseline line 1013). The three existing property-order warnings are at lines 302, 401 and 681. These are additional CSS-check findings, distinct from the passing required TypeScript/JavaScript lint commands. No fully green desktop UI or CSS suite is claimed.

The selected existing UI command used `--workers=1 --reporter=line` with `diagram-viewer`, `issue-5832-diagram-theme`, `reading-mode`, `viewer-mode`, `preview-selection`, `source-transition-groundwork`, `source-navigation-restoration`, `document-layout-preview`, `parity-source-undo-saved`, `source-mode-flush`, `context-isolation`, and `web-security` under `test/e2e/`. The two new cases used `test/e2e/diagram-lifecycle.spec.ts` separately. Existing suites/timeouts/security settings were unchanged. All logs, diagnostic copies, baseline archives and Playwright artifacts are outside the checkout under `$env:TEMP\MarkTextPlus1-stage2b2-r2-*`. No full CommonMark/GFM conformance or owner physical R2 acceptance run is claimed.

#### Changed-file inventory

R2 changes these files, in addition to preserving the earlier local work:

| File                                                                                 | R2 change                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `packages/muya/src/block/base/treeNode.ts`                                           | Permanent resource lifetime and explicit move-preserving detach.            |
| `packages/muya/src/block/base/parent.ts`                                             | Ownership-aware recursive disposal/unlinking.                               |
| `packages/muya/src/muya.ts`                                                          | Dispose the tree during destruction, retaining the R1 input cleanup.        |
| `packages/muya/src/block/extra/diagram/diagramPreview.ts`                            | Request-owned targets/signals, click/finalizer disposal and stale guards.   |
| `packages/muya/src/block/extra/diagram/index.ts`                                     | Reject delayed language updates after disposal.                             |
| `packages/muya/src/utils/diagram/render.ts`                                          | Async validity checks and supported renderer cleanup ownership.             |
| `packages/muya/src/utils/diagram/sequence/sequence-diagram-snap.js`                  | Narrow font-resume/canvas disposal adapter.                                 |
| `packages/muya/src/types/index.d.ts`                                                 | Sequence signal/disposer declarations.                                      |
| `packages/muya/src/assets/styles/blockSyntax.css`                                    | Preserve SVG sizing inside the request target.                              |
| `packages/muya/eslint.config.mjs`                                                    | Comment-only clarification of the vendored adapter; no rule/ignore changes. |
| `packages/muya/src/block/content/langInputContent/__tests__/diagramLanguage.spec.ts` | Correct fixture-owned editor teardown; assertions/timeouts unchanged.       |
| `packages/muya/src/block/extra/diagram/__tests__/diagramLifecycle.spec.ts`           | 19 new lifecycle/integration cases.                                         |
| `packages/muya/src/utils/diagram/__tests__/renderOwnership.spec.ts`                  | Eight new renderer-boundary cases.                                          |
| `packages/muya/src/utils/diagram/__tests__/sequenceLifecycle.spec.ts`                | Two actual vendored font-cancellation cases.                                |
| `packages/desktop/test/e2e/diagram-lifecycle.spec.ts`                                | Two real-renderer desktop cases.                                            |
| `docs/MarkTextPlus1/stage-2b-split-view.md`                                          | Append R2 design, evidence, limits and acceptance procedure.                |

The five preserved files with no R2 edit are the R1 `editor/index.ts`, `selection/TextSelection.ts`, `editor/__tests__/inputSubscriptionCleanup.spec.ts`, `selection/__tests__/instanceOwnership.spec.ts`, and the original `src/__tests__/previewHostReadiness.spec.ts`, all under `packages/muya/src/`. The complete working tree therefore includes the earlier R1/investigation changes; those are not silently discarded or presented as newly authored R2 work.

#### Remaining boundaries and physical Windows procedure

This is diagram lifecycle repair, **not a dedicated preview host or complete Muya resource audit**. Shared plugin registration, document/image-directory context, shared renderer configuration and other block-specific resource audits remain R3/prerequisites for the future host. Native imports, external data/font loads and third-party promises may not be cancellable; signals invalidate their results, private targets contain unavoidable late writes, and supported cleanup APIs release owned views/canvases. No blanket garbage-collection, network-cancellation or performance guarantee is made. Controlled races plus real Electron render tests do not prove every possible timing inside each external library. Existing security regressions exercised PlantUML against a local test server, but no live external PlantUML service or disposal during its network load was verified. No new server or remote-data requirement is introduced.

For owner physical acceptance, use a disposable profile and file, normal Electron security, and the established startup procedure above (no `--debug` CLI flag). Include Mermaid, flowchart, sequence and a local-data Vega-Lite chart. Capture SHA-256, byte length and `LastWriteTimeUtc` before starting. Then:

1. In Edit Mode WYSIWYG, verify all diagrams render, are sized within the editor and retain themes. Open/close the existing diagram viewer; test zoom, copying/export and returning to the document.
2. Switch repeatedly through Source, Preview Only and WYSIWYG in both Reading and Edit Mode. Verify Source text/selection/scroll, Preview selection/copy and read-only safeguards. Repeat with another tab; no old diagram should overwrite the active document. **Required native-input gate:** repeat the earlier exact 180-line CRLF/no-final-newline fixture, unmaximized, using physical Ctrl+End then Shift+Up twice and the real View menu/command palette. Confirm the initial backwards selection forms before testing the round trip; compare exact selection, native copying and immediate Shift+Right afterward. These are not currently automated acceptance passes.
3. In a separate disposable edit fixture, rapidly edit diagram code, replace/delete a diagram, then Undo/Redo. Confirm current code/rendering agrees and a deleted diagram does not return except through Undo. Close while rendering is pending, then restart; check for unexpected errors or stale diagrams.
4. Close the unchanged viewing fixture normally and compare all three original integrity values. Do not treat edited fixtures or unavailable original values as a no-op integrity pass. Confirm expected dirty-buffer and autosave behavior separately.

These are manual requirements, not agent-performed physical acceptance. Split remains unavailable, and R3/host/live-update work is not authorized by this R2 report. No Source history reconciliation, dependencies, security, packaging, dialogs, branding or session format changed; no staging/commit/push/merge/branch operation was performed.

Final formatting/scope checks use report-only Markdown Prettier and the applicable Muya/root ESLint rules. Root Prettier's TypeScript `async ()` spacing conflicts with the desktop ESLint requirement; the new desktop spec retains its tested ESLint-compliant formatting, and an emitted-JavaScript token comparison confirmed equivalence to the passing two-case version. Tracked and all seven untracked-file whitespace checks passed. Git remains on the approved branch/HEAD with 14 modified tracked files, seven untracked files, no deletions and an empty index. The original readiness hash and unchanged Source navigation Git blob still match the values above. No generated artifact or diagnostic spec is included.

**Review status:** the scoped diagram implementation and its readiness/unit/real-renderer checks are ready for code review. **R2 is not ready for unconditional acceptance** while the native Source UI failures remain unresolved. Resolve that test/input path and complete the physical acceptance gate before treating the milestone as fully verified; do not proceed automatically to R3.

#### 12 November 2026 — R2 code review and controlled native Source investigation

This follow-up reviews the actual local source and tests and records a controlled comparison with committed Stage 2B.1. It does not accept R2 or implement a test-driver repair. The owner now reports that R1 physical behavior and original disk-content checks passed. The original timestamp comparison remains formally unverified; neither the new controlled tests nor earlier disposable-file checks backfill that unavailable original timestamp.

**Source audit.** The reviewed diff includes `TreeNode`/`Parent`, diagram construction and preview, `Muya.destroy()`, rendering helpers, the sequence adapter, stylesheet/types, the fixture teardown and all new R2 tests. R1 selection/subscription changes were checked in context. No confirmed additional production correctness defect was identified in the reviewed paths. Specifically:

- Permanent removal dispatches through the overridden `detach()` before disposal, preserving JSON removal operations. `insertInto()` uses detach for live moves. `Parent.dispose()` marks itself before descending and visits both child and attachment lists, acting only on nodes whose current parent is still that owner. The reviewed drag, task-list reorder, promotion, wrapping, clipboard and history callers either move live nodes through the move path, reparent before retiring their old owner, or reconstruct new instances from state. Removed history nodes are not deliberately revived.
- The ownership contract depends on callers treating `remove()` as permanent. General insertion methods do not reject an already disposed instance. No reviewed normal-use caller was found violating that contract, but future movers must use detach/reparenting rather than remove-and-reinsert. This is an API limitation, not evidence of a current Source restoration regression or justification for a broader refactor.
- Diagram disposal invalidates the request, releases the click subscription and cancels finalization. Superseded/disposed work is checked after awaits; private targets contain third-party writes that cannot actually be cancelled. Observer completion also clears its timer. Tests cover replacement, document rebuild, incremental/bulk Undo/Redo, surviving peers, live moves and delayed success/error completion.
- Installed `vega-embed/src/embed.ts` supports `viewClass` and its result finalizer; the owned native `View` is retained before embedding resolves. The installed flowchart parse result supports `clean()`. That flowchart implementation removes its SVG canvas; this is not a claim of a complete audit of Raphaël internals. Mermaid skips stale SVG commits/bindings and removes its active target on cancellation. The sequence adapter checks lifetime before font-delayed drawing and releases its Snap paper. No shared renderer-policy repair is claimed.
- R1 still checks both connected selection endpoints and resolved block owners, and destruction still releases the root RxJS subscription group before tree disposal. Reading Mode guards and Preview clipboard/application policy are unchanged. Resource disposal does not write canonical Markdown, persist undo stacks or alter Source reconciliation.

The real-renderer Electron coverage remains useful normal-operation evidence, but does not exhaust cancellation timing inside every external renderer, pending remote data/font work, PlantUML network disposal or every possible block move. Those limitations and R3 prerequisites remain as recorded above. No production correction was made during this review.

**Controlled setup.** Before preparing archives, Git matched `feature/marktext-plus-one` at `cc74c31242534940d487403d7b58958e3a3fd567`, with the expected 14 modified tracked and seven untracked files, no deletions or staged entries. SHA-256 snapshots of all 21 local files were saved outside the checkout. A fresh `git archive HEAD` was extracted twice into TEMP: `baseline` contains committed files; `r2` overlays the 21 local files. The active checkout was not switched, reset, stashed or cleaned.

Both archives use directory junctions to the same installed dependencies. Each desktop archive has its own `@muyajs/core` workspace junction pointing to its own archived Muya source, rather than inadvertently building both variants against the active checkout. `require.resolve('@muyajs/core')` verified those distinct source paths. Both serial `pnpm.cmd exec electron-vite build` runs passed. The archives have independent `out` directories; the active checkout's generated application was not rebuilt or replaced.

Installed comparison versions were Node **24.22.1**, pnpm **10.33.4**, Electron **42.1.0** and Playwright **1.64.0**. Lockfile SHA-256 was `8E619C1BDCFB58ADFE267F598C0F3159300542DE9D24C63D85ABA264EC112535`. The inherited `ELECTRON_RUN_AS_NODE=1` was removed by the unchanged approved environment helper for each Electron launch. No GPU/security flag or dependency changed. Tests used the same Windows desktop/display configuration and package Playwright configuration, one worker, normal unmaximized windows where specified, and fresh disposable profiles/files. The owner approved idle physical input/clipboard during the serial runs; no competing build or GUI test session ran alongside them.

The unchanged source test SHA-256 was `B245AD1F99885873B5E11781BD9CE69FED52C90028CE7F9D315307D77E2EB4AB`; the unchanged native helper SHA-256 was `780CA7BCC60FC418BFE0A84E78933A22585F3B27138ED415973D874BE5175D3E`. Both matched in baseline, R2 and the active checkout. The selected original tests were:

1. `physical fixture original-crlf via popup at end retains exact backwards selection`;
2. `physical fixture previous-lf via native-bar at end retains exact backwards selection`;
3. `exact-fixture source selections remain independent across tabs and repeated palette transitions`.

From each archive's `packages/desktop`, the identical command was:

```powershell
pnpm.cmd exec playwright test test/e2e/source-navigation-restoration.spec.ts --grep 'physical fixture original-crlf via popup at end|physical fixture previous-lf via native-bar at end|exact-fixture source selections remain independent' --repeat-each=3 --workers=1 --reporter=line --output <variant-specific-TEMP-results>
```

Only the output directory differed. All original selection, clipboard, direction, document and file-integrity assertions remained intact. No timeout, delay, retry, expected-failure marker or skip was added. Counts below are repeated attempts over overlapping cases, not newly distinct application tests.

| Comparison / TEMP-only experiment                                                                           | Committed baseline                                  | R1/R2 archive                                       |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Three unchanged cases, each repeated three times                                                            | **One passed / eight failed**, 1.2 minutes, exit 1  | **One passed / eight failed**, 1.0 minute, exit 1   |
| Event/foreground observation: combined and individually stepped native keys, each repeated three times      | **One passed / five failed**, 36.8 seconds, exit 1  | **One passed / five failed**, 37.4 seconds, exit 1  |
| Same observation with native `Microsoft.VisualBasic.Interaction.AppActivate(pid)`, each mode repeated twice | **One passed / three failed**, 44.9 seconds, exit 1 | **One passed / three failed**, 24.6 seconds, exit 1 |
| TEMP copy of the three original cases using a physical Windows Source click, each repeated three times      | **Three passed / six failed**, 1.5 minutes, exit 1  | **Three passed / six failed**, 1.4 minutes, exit 1  |

In the unchanged runs, both builds failed all three popup-end attempts and all three native-bar-end attempts at the initial backwards-selection check, before layout transitions. The multi-tab palette case passed once and failed twice in each build at native command-palette activation. The identical aggregate results and operation locations reproduce the reported failure class on committed Stage 2B.1; they do not prove universal equivalence of the two applications.

**First failing operation and diagnostic evidence.** The temporary observation spec uses the exact heading/blank-line/180-line CRLF/no-final-newline fixture, real CodeMirror and actual `nativeKeys`/SendWait. It records only controlled key events, selection coordinates, text length, active-element/focus booleans, window bounds, process/window identities and modifier flags. It does not add a clipboard reader or log document text. Combined input uses the original `^{END}+({UP}{UP})`; the comparison calls `^{END}`, `+{UP}`, `+{UP}` separately and snapshots after each return.

In **each** build's six observation attempts:

- The first combined attempt had the Electron main PID as Windows' foreground owner. Ten expected keydown/keyup events reached the editor, and selection moved from the clicked line to anchor line **181**, head line **179**. Ctrl/Shift were released afterward.
- In the remaining five attempts, `GetForegroundWindow`/`GetWindowThreadProcessId` identified a **different** process, independently identified as `Code` (VS Code). Nevertheless, `document.hasFocus()`, `CodeMirror.hasFocus()` and the active CodeMirror textarea all reported true. Both the combined and stepped attempts recorded **zero** editor key events; the collapsed selection stayed at line **16**.
- In the stepped failures, **Ctrl+End was already not delivered**: its return snapshot still showed the clicked line, and neither subsequent Shift+Up invocation reached the editor. No layout switch or Source-to-visual reconciliation had occurred. The selection remained unchanged after an additional OS identity capture, so this was not merely an immediate post-SendWait selection read racing a delivered event.

The driver starts hidden PowerShell and invokes SendWait without a target PID/HWND, OS-foreground precondition or renderer key acknowledgement. A Chromium locator click can give DOM/CodeMirror focus without bringing the native Electron window to the OS foreground. This missing precondition is a **confirmed native-input harness defect** for the observed failures. It is distinct from an application failing to restore a selection that was actually created. The earlier single-window focus probe could pass while repeated fresh-window attempts failed; its successful snapshot was insufficient evidence of driver readiness across launches. Why Windows retains/returns foreground ownership to VS Code between these launches has not been uniquely established.

**Candidate corrections and limits.** Native `AppActivate` did not reliably acquire the foreground; it was not adopted. A separate TEMP-only copy replaced the fixture's existing initial Source locator click with real Windows pointer down/up at the same pane center, converting Electron content coordinates through `screen.dipToScreenPoint`. It kept native keys/menu interactions and all original assertions. All three popup-end attempts then passed on both builds, but all native-bar and multi-tab palette attempts still failed. Physical clicking alone is therefore an incomplete repair; its remaining focus/geometry/menu readiness conditions were not established sufficiently to ship it. No experimental test or driver edit was copied into the checkout.

The proposed minimal permanent repair is confined to `nativeApplicationMenu.ts` and its Source-test call sites:

1. Supply the intended Electron PID/window identity to native key operations and verify OS foreground ownership **before sending any keys**. Refuse delivery to a foreign foreground application with a driver-specific diagnostic.
2. Establish native activation through a demonstrated, style/DPI-correct test action, then verify foreground and expected editor/input focus. A true DOM-focus flag or a successful activation API call alone is insufficient. Preserve restored selections; do not refocus by clicking document text after a layout round trip.
3. Acknowledge the expected native key events at the intended renderer/input before reading selection or assuming the command palette opened. Keep OS readiness and event delivery checks separate from the existing exact restoration assertions. Do not replace native input with Chromium keys, alter expected selections or enlarge timeouts.
4. Validate across repeated fresh windows, custom/native menu routes and both baseline/R2 before rerunning the entire affected Source file and the selected regression suite.

The foreground guard is directly justified by captured evidence. The reliable activation strategy and the complete repair still require focused validation. This investigation deliberately proposes that boundary rather than committing an unreliable workaround. No R1/R2 production regression is established by these native failures, but a passing full Source test gate is **not** claimed.

**Evidence location and scope checks.** All archives, builds, scripts, logs and results are under `$env:TEMP\MarkTextPlus1-r2-review-b1509f2d-217a-4952-a802-7c90c9b8309b`; `$env:TEMP\MarkTextPlus1-r2-review-path.txt` records the root. `comparison-environment.json`, `initial-inventory.json`, `observation-summary.json`, each variant's `*-original.log`, `*-observation.log`, `*-activation.log`, `*-native-click.log` and corresponding result directories retain the comparison. Existing fixture-generated attachment clipboard-value fields were removed from 12 TEMP JSON artifacts; the new observation logger never reads clipboard contents. No personal document, window title or real profile was used for diagnostics. Do not recursively delete dependency junction targets as part of archive cleanup.

The active checkout's 21 file hashes still matched the initial snapshot before this documentation append. Only this report changed during the review; production files and permanent tests remain byte-for-byte unchanged. The prior complete Muya/desktop-unit, readiness/R1/R2, build/type/lint results remain recorded above; no entire automated suite was unnecessarily repeated. Two isolated application builds and the focused desktop comparisons were newly run. Report-only Markdown Prettier write/check, `git diff --check` and whitespace checks of all seven untracked files passed. Final hash/inventory verification confirmed only this report differs from the initial snapshot, the same 21-file inventory, unchanged branch/HEAD, no deletions and an empty index.

**Acceptance decision.** R2 is suitable for owner physical Windows testing using the disposable diagram/layout/history/integrity procedure above, with Electron deliberately activated before native input. The original timestamp limitation remains open. The existing 13 selected-suite failures and 12 isolated Source failures remain historical failed runs; this investigation explains a reproduced baseline driver failure class, not a retrospective pass or proof that every prior failure had the same cause. The unchanged focused cases still fail as reported in the table. R2 is **not yet ready for an unconditional commit-readiness review**: retain the assertions and finish the native-driver correction/verification or obtain an explicit owner decision on the remaining gate. No R2 acceptance, R3, preview host, Split activation, staging, commit, push or merge is authorized or performed here.

#### 12 November 2026 — Native Windows input-driver repair

The owner authorized a test-infrastructure repair after the controlled comparison above. The prior unchanged-driver results establish the failing three-case set: one pass/eight failures on each build, with separately captured missing Ctrl+End delivery when VS Code owned the foreground. Those runs remain the before-repair evidence; known unguarded input was not deliberately resent to a foreign foreground application. Why Windows retained that foreground owner between launches remains unconfirmed. No R1/R2 application regression was established.

Windows restricts foreground activation, and an activation call's return alone does not establish that the target processed activation. The driver uses bounded message acknowledgement and observed foreground state, following [Microsoft's test-automation guidance](https://devblogs.microsoft.com/oldnewthing/20161118-00/?p=94745%2F). It avoids attaching input queues, which Microsoft identifies as a test-hang risk. The existing failed `AppActivate` and physical Source-click experiments remain recorded above.

The correction is confined to test infrastructure:

- `nativeApplicationMenu.ts` obtains the exact tested page's BrowserWindow through [Playwright's `browserWindow(page)` API](https://playwright.dev/docs/api/class-electronapplication#electron-application-browser-window), then reads its main-process PID and native HWND. It no longer substitutes a launcher PID or an arbitrary first window as the native-input target. Every operation rediscovers that identity.
- New `nativeWindow.ps1` contains built-in Windows interop. It validates that the target HWND is live, visible, top-level and owned by the expected PID. It first tries `SetForegroundWindow`, acknowledges target messages with bounded `SendMessageTimeout(WM_NULL)`, and verifies actual foreground ownership.
- If ordinary activation fails, only the disposable target is temporarily raised with `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE)`. A DPI-aware point must both hit that target and return `HTCAPTION` from `WM_NCHITTEST` before a real native mouse down/up is sent. No document-text, menu-button, resize or close-button click substitutes for activation. A `finally` block restores the prior topmost flag and pointer position; restoration failure is reported. This transient test-window operation is explicit and does not change application preferences or production window-focus policy. See [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) and [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest).
- Before keys, the driver requires both exact native foreground ownership and a native keyboard-focus HWND rooted in that window (`GetGUIThreadInfo`). It separately checks renderer/document readiness; Source operations require CodeMirror's actual input field and `hasFocus()`. It does not focus a document by resetting selection or clicking text after restoration. Held mouse buttons/modifiers cause refusal rather than corrective input.
- The second hidden PowerShell operation revalidates HWND/PID, foreground and native keyboard focus immediately before the original `SendKeys.SendWait` sequence. It never deliberately transmits keys with a known foreign foreground target. Native menu discovery/clicks are also restricted to that target and owned popups, with a physical hit-target check before clicking.
- Per-operation test listeners acknowledge expected keydown/modifier events on the intended WebContents via [Electron's `before-input-event`](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event). Ordinary Source navigation additionally requires expected trusted DOM key releases. Ctrl+C and Ctrl+Shift+P can be consumed as menu accelerators before DOM dispatch, so their targeted native input is acknowledged at WebContents; the original clipboard and palette assertions still verify their effects. The existing F10 fallback is acknowledged by the resulting native UI Automation menu rather than requiring a DOM F10 event.
- Instrumentation observes events without preventing defaults, changing selection or reading clipboard/document contents. Listeners and JavaScript handles are released in `finally`; returned metadata records target/foreground identities and key delivery. Native processes have a 10-second outer bound, activation/message waits are bounded, and renderer readiness/delivery use existing-duration state polling. No arbitrary sleep or larger test timeout was introduced. Foreground can still change due to outside physical input; the driver checks immediately before transmission and reports detected interference rather than claiming atomic control of the Windows desktop.

`source-navigation-restoration.spec.ts` changes only native-driver call sites and diagnostic recording. An AST comparison with HEAD confirmed **all 69 original `expect(...)` calls and both fixture definitions unchanged**. Native key strings, menu/palette routes, exact selection/clipboard/direction assertions, scroll/history checks and file-integrity assertions remain intact. The original non-Windows fallback remains unchanged; Windows input was not replaced with Chromium keys. No production Muya/editor/history/Reading Mode/Preview/diagram code or dependency/security setting changed.

The first repair validation found two errors in the new instrumentation, not new application failures. A DOM-only acknowledgement incorrectly required Ctrl+C/Ctrl+Shift+P key releases that native accelerators can consume: the initial baseline sample recorded **nine failures**. Targeted WebContents acknowledgement corrected that distinction. A subsequent three-case smoke run recorded **one pass, one failure, one not run and one runner error**, 31.0 seconds, after UI Automation rejected a UInt32 ProcessIdProperty value; the property requires Int32. That test-only marshalling was corrected. The diagnostic smoke run stopped at its first failure; it is not presented as a completed green sample. Original assertions and timeouts were not changed to resolve either issue.

The final three-case repeated sample then passed **all nine attempts on committed baseline** (2.9 minutes) and **all nine on R1/R2** (3.2 minutes), three fresh-profile repetitions per case, one worker, serial execution. The earlier archives/builds were reused with matching installed dependencies and independently resolved baseline/R2 Muya sources; only the corrected test files were copied into them. No simultaneous GUI automation or build ran. Both original file-format fixtures, native/custom menu routes and multi-tab palette selection are represented. The completed checks follow; these repeated cases alone are not a claim that the entire desktop suite passed.

| Final validation                                                   | Committed baseline                                   | R1/R2                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Three representative cases, each repeated three times              | **Nine passed**, 2.9 minutes, exit 0                 | **Nine passed**, 3.2 minutes, exit 0                                                |
| Complete existing Source-navigation specification                  | **24 passed**, 5.0 minutes, exit 0                   | **24 passed**, 5.1 minutes, exit 0                                                  |
| Previous 106-case, 12-file Electron selection                      | Not rerun on baseline; outside the narrow comparison | **105 passed / one failed**, 9.6 minutes, exit 1. All 24 Source cases passed again. |
| Isolated unchanged failed diagram-hover case, repeated three times | Not run                                              | **Three passed**, 13.3 seconds, exit 0                                              |
| Two existing R2 real-renderer cases                                | Not applicable to baseline                           | **Two passed**, 8.8 seconds, exit 0                                                 |

Counts overlap: baseline/R2 runs and repetitions exercise the same Source cases, and the 106-case selection contains the 24-case Source file. The two real-renderer cases are separate. The selection is not the entire repository desktop UI suite. No final Source assertion failed, no test was skipped or marked expected-failure, and no timeout increased. Playwright's slow-file notice was retained; GUI runs remained serial rather than following its generic parallelism suggestion.

The complete Source commands were `pnpm.cmd exec playwright test test/e2e/source-navigation-restoration.spec.ts --workers=1 --reporter=line --output <variant-specific-TEMP-results>` from each archive's `packages/desktop`. The 106-case command used exactly the 12 spec files named in the R2 verification section above, with the same worker/reporter options. The isolated hover rerun used `test/e2e/diagram-viewer.spec.ts --grep 'the view action opens the diagram in the viewer with export controls' --repeat-each=3`; the real-renderer command used `test/e2e/diagram-lifecycle.spec.ts`. Both retained `--workers=1 --reporter=line` and separate TEMP result directories.

Across the final repeated samples, complete Source runs and selected regression run, **309 recorded native keyboard operations** had matching target HWND/foreground HWND/main PID metadata. Each successful operation also passed the pre-transmission native focus guards and its targeted key-event acknowledgement. The recorded counts were 54/54 matches in each repeated sample and 67/67 in each complete Source run and the selected run. These are operation observations, not 309 distinct tests. Native menu metadata remains separately recorded. The driver does not infer input delivery merely from a DOM focus flag.

**Remaining diagram-hover failure.** The broader selection failed `diagram-viewer.spec.ts:253`, “the view action opens the diagram in the viewer with export controls.” Its first failing operation was the existing `hoverDiagram()` check at line 150: after its existing pointer move, `toolbarShownFor(...)` remained false through the existing 10-second poll. The viewer-open/export-control assertions had not yet been reached. No native Source-driver call occurs in that test; it ran at selection position 2, before the Source file at positions 60–83. This excludes a direct invocation of the new driver in the failing operation, but does not establish a unique cause or exclude shared desktop/application state effects.

The same unchanged case passed all three isolated repetitions. No diagram source, test, hover geometry, sleep, assertion, timeout or skip was changed. Its existing hover delays were left intact. The cause of this intermittent failure remains **unconfirmed**; it is not automatically labelled inherited, unrelated to R2, or resolved. The earlier full R2 selection and historical failed native runs remain evidence. The completed 106-case run is **not** reported green on the strength of isolated reruns. An earlier progress update based on the log tail missed this early failure; the completed result above corrects that update.

**Final static and refusal checks.** `pnpm.cmd run typecheck` passed. Initial root lint found one new `preserve-caught-error` error in the process wrapper; retaining the original caught error as `Error.cause` corrected it. Final `pnpm.cmd run lint` passed with **zero errors / 166 existing warnings**, no new warnings. Muya source/unit code did not change during this repair, so its previously recorded full unit/type/lint results were not unnecessarily repeated. The separate inherited CSS-lint finding above remains unchanged and is not claimed passed here.

PowerShell parsing and actual C# interop compilation passed. Direct invalid-HWND activation/foreground checks refused input. After the final error-cause metadata change, a TEMP-only TypeScript check exercised `nativeKeys()` with a zero HWND, using the real PowerShell validation: it rejected before renderer readiness or key transmission, preserved the original process error cause and disposed the discovery handle. A byte comparison confirmed the final driver differs from the UI-tested copy **only** by retaining that failure-path `cause`; successful activation/transmission/acknowledgement code is unchanged. This error-path check does not stand in for the real Electron positive tests above.

**Exact repair inventory and evidence.** Only these four files change during this task:

| File                                                              | Change                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/test/e2e/nativeApplicationMenu.ts`              | Exact page/window targeting, guarded native keys/menu operations, bounded process errors and event acknowledgement/cleanup. |
| `packages/desktop/test/e2e/nativeWindow.ps1`                      | New test-only Windows ownership/focus validation and safe caption activation interop.                                       |
| `packages/desktop/test/e2e/source-navigation-restoration.spec.ts` | Pass app/page identity and record key-delivery evidence; preserve fixtures/assertions.                                      |
| `docs/MarkTextPlus1/stage-2b-split-view.md`                       | Append this repair evidence and preserve all earlier findings.                                                              |

The prior 21-file R1/R2 inventory is preserved; only its shared report receives this authorized append. The other 20 pre-existing local files retain their starting hashes. The complete working tree now has **16 modified tracked files / eight untracked files / zero deletions**, 24 files total, with nothing staged. The original readiness file is unchanged. There is no production reference to the driver or PS1 helper, and no dependency, security, packaging, Source-history, diagram, permission or other application file changed in this repair. Final root type-check, root lint, report-only Markdown Prettier write/check, `git diff --check` and all eight untracked-file whitespace checks passed. Git remains on `feature/marktext-plus-one` at `cc74c31242534940d487403d7b58958e3a3fd567`; the diagram-viewer spec still matches HEAD byte-for-byte.

All new logs, scripts, snapshots and results are outside the checkout under `$env:TEMP\MarkTextPlus1-native-driver-8fa8c5a6-85bd-4b0a-8d72-9f512cced79d`; `$env:TEMP\MarkTextPlus1-native-driver-path.txt` records that location. The original baseline/R2 archives remain at the earlier review root, referenced by `archives-path.txt`. `initial-inventory.json`, `foreground-summary.json`, `baseline-repeated.log`, `r2-repeated.log`, both `*-source-all.log`, `r2-selected.log`, `r2-hover-rerun.log`, `r2-diagrams.log`, static-check logs and matching result directories retain the evidence. The initial nine-failure sample and partial smoke run are retained separately. Clipboard-value fields generated by existing disposable-fixture attachments were removed from 144 TEMP JSON artifacts; new driver metadata never reads clipboard contents.

**Windows follow-up and decision.** The native-input verification gate is **satisfied for the tested Windows environment**: repeated representative cases and both full Source runs passed with real native input and unchanged restoration assertions. For a normal rerun, keep the desktop unlocked and mouse/keyboard/clipboard idle, use the approved Windows runner and run the complete Source command above from the actual desktop package. Driver refusal on inaccessible/obscured windows, held modifiers or lost foreground/focus is an infrastructure failure to diagnose, not permission to bypass the guards. Fullscreen activation without an available caption, other display configurations and other operating systems are not newly verified.

R2 can proceed to owner physical Windows acceptance using the diagram/layout/history/integrity procedure above. Include the diagram toolbar hover/open/export action and the exact native Source round trip. Keep the original unavailable timestamp comparison and earlier unconfirmed physical-selection cause explicitly unverified. **Unconditional final commit readiness is not claimed** while the broader run's intermittent hover failure remains unclassified and owner R2 acceptance is pending. Review that failure/evidence and any decision to accept the limitation before approving a commit. No R2 acceptance, production workaround, R3, preview host, Split activation, staging, commit, push, merge, reset or stash was performed.

#### 12 November 2026 — Final hover investigation, physical acceptance and scope review

**Owner-reported final acceptance.** The owner reports **all six R2 functional checks passed**, native Windows Source verification passed, and final post-test integrity passed for **both protected documents**: unchanged SHA-256, byte length and full-precision modification timestamp. These are physical Windows checks reported by the owner, not agent-performed physical tests. The two documents' paths/hash values were not supplied in this request and are not invented here. This new completed post-test comparison clears the current physical-integrity gate; it does not retroactively perform an earlier unavailable timestamp comparison or establish the cause of the older physical Source-selection observations. Earlier failed/unverified checkpoints above remain historical evidence. The statements above that owner R2 acceptance was pending describe their earlier checkpoints.

**Controlled reproduction.** The checkout started on `feature/marktext-plus-one` at `cc74c31242534940d487403d7b58958e3a3fd567`, with 16 modified tracked files, eight untracked files, no deletions and an empty index. All 24 local files were hashed before work. The existing isolated baseline/R2 archives and installed dependency junctions were reused, preserving their independently resolved Muya source and application builds. Current test-driver files were copied into both archives. Tests ran serially with one worker on the same Windows desktop, with owner-approved idle input and no concurrent GUI session or build.

The **entire unchanged 16-case diagram-viewer file**, repeated three times with `--trace=on`, recorded **47 passed / one failed on baseline** and **47 passed / one failed on R2**, 1.5 minutes each, exit 1. Both failures were the original first-case hover assertion, before viewer opening. This reproduces the failure on committed Stage 2B.1; its attribution is supported by comparison rather than by the earlier isolated passes alone.

**Confirmed fixture readiness defect.** `beforeAll` waits for a matching SVG anywhere among four diagram attachments. The hovered first diagram is not necessarily the attachment that satisfied that wait. `hoverDiagram()` then relied on visible block geometry and its existing fixed delays, without establishing that the specific preview had completed rendering. The toolbar builds its item list at mouse-handler time; View is included only if the hovered attachment already contains rendered media. A toolbar built while that attachment is loading can retain only Edit/Delete after the SVG arrives, until another pointer move rebuilds it.

The failed API traces recorded an early hover at `(606, 106.390625)`. Their failure-time DOM snapshots showed the first rendered diagram and a toolbar listing **Edit block / Delete block**, with **no View diagram**. Successful lifecycle observations showed an already-finalized first preview before hovering, its settled 159.59375-pixel block height, and a hover center around `(606, 173)` followed by a toolbar render that included View. Code inspection confirms the render-dependent item policy. No foreground-window failure, overlapping overlay or missing target figure was established as the cause of this hover failure. R2's extra render-target wrapper is skipped by the toolbar's exact block-name lookup; it still resolves the enclosing diagram figure, and the same failure occurs without that wrapper on baseline.

Temporary lifecycle observers wrapped toolbar show/hide/render and recorded geometry, hit stacks, render/finalization state, active-block state, focus and pointer events. Three surrounding cases repeated three times passed **nine/nine on baseline** (28.9 seconds) and **nine/nine on R2** (26.4 seconds). In those observed runs the first target was already ready before hovering, so they did not capture a failed toolbar-build call and are not presented as direct timestamps of the failed calls. A lighter failure-only snapshot/screenshot variant, with no added pre-assertion actions, also passed **nine/nine on baseline** (19.9 seconds) and **nine/nine on R2** (22.0 seconds). These observations explain why instrumentation/isolated passes alone were insufficient to close the issue.

CLI traces of the unchanged Electron runs contained test API events and failure-context snapshots, not browser-context DOM/screencast data. Explicit Electron-context tracing in the temporary observed copies captured real DOM snapshots/screenshots of passing interactions. No failed PNG from those passing diagnostic runs is claimed. All diagnostic code and artifacts remain outside the checkout; no real document or personal profile was inspected.

**Narrow test-only correction.** `diagram-viewer.spec.ts::hoverDiagram()` now requires the requested attachment's finalized `role="img"` and attached SVG before scrolling, measuring and moving the pointer. These are two added readiness assertions against existing renderer signals. All **37 original `expect(...)` calls** and the Markdown fixture are preserved; the final file has **39** such calls. The toolbar-position, viewer-open, seven export controls, export/copy/zoom, renderer-error and other behavioral assertions remain unchanged. No new sleep, larger timeout, retry, skip, expected-failure marker, fake renderer, direct toolbar invocation or production change was introduced. The existing 120/150 ms waits were not enlarged or used as the correction.

The application retains its existing mouse-driven toolbar refresh policy for a stationary pointer over a loading diagram. This test correction does not claim to improve that separate inherited UX behavior; it establishes the rendered-target precondition for testing the View action. No production correction was necessary or made for the reproduced fixture defect.

**Repeated post-correction evidence.** The full corrected diagram file passed **48/48 on baseline** and **48/48 on R2**, 1.3 minutes each, exit 0. This includes three fresh fixture repetitions of the first case and all surrounding export/viewer cases. The pre-correction 47/one results and the previous 105/one broader run remain recorded. Counts overlap and must not be summed as unique tests. The final relevant broader selection and static checks are recorded below.

**Complete code/scope audit.** The review covered the actual tracked diff and all eight untracked files, including the original readiness investigation, both R1 tests, all R2 tests, native interop and documentation. No additional blocking correctness finding was identified. Resource ownership remains explicit: permanent removal disposes, live moves detach, recursive disposal skips reparented children, asynchronous render results are request-owned, and supported renderer finalizers are retained. R1 endpoint ownership and root-subscription teardown remain intact. General insertion APIs still rely on callers not reinserting permanently disposed instances, and third-party network/font work may be invalidated rather than truly cancelled; the existing documented limits and R3 prerequisites remain in force.

There is no dependency/lockfile, branding, packaging, application security, permission or Source reconciliation change. The only desktop production source involved in this combined local work is the consumed Muya engine; desktop main/preload/renderer application files are unchanged from the committed baseline. The native helpers are test-only, with no production imports/references. Their temporary window activation does not change production focus policy or global foreground restrictions. `packages/muya/eslint.config.mjs` changes only its vendored-adapter comment, not lint rules or ignores. The diagram-language test fixture now destroys its owned editors; its original assertions and timeout are intact. No existing test was deleted or weakened.

Split is still rejected by `isAvailableDocumentLayout`, the editor store's activation validation and the three-item native layout menu. No Split renderer, dedicated preview host, live-update policy or R3 work is present. Generated applications, logs, traces, screenshots, profiles, baseline archives and credentials are not part of the Git inventory. No unrelated user work was identified.

**Complete combined inventory.** There are **25 intended files: 17 modified tracked, eight added/untracked, zero deleted**. Only the report and the existing diagram-viewer fixture change during this final review; all other pre-existing local file hashes are preserved.

| Status   | File                                                                                 | Ownership                                                            |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Modified | `docs/MarkTextPlus1/stage-2b-split-view.md`                                          | Investigation, design, verification and owner acceptance history.    |
| Modified | `packages/desktop/test/e2e/diagram-viewer.spec.ts`                                   | Specific-attachment render readiness before hover.                   |
| Modified | `packages/desktop/test/e2e/nativeApplicationMenu.ts`                                 | Targeted, guarded native input and delivery acknowledgement.         |
| Modified | `packages/desktop/test/e2e/source-navigation-restoration.spec.ts`                    | Native target call sites/diagnostics; original assertions preserved. |
| Modified | `packages/muya/eslint.config.mjs`                                                    | Vendor-adapter comment only.                                         |
| Modified | `packages/muya/src/assets/styles/blockSyntax.css`                                    | Request-target SVG sizing at unchanged specificity.                  |
| Modified | `packages/muya/src/block/base/parent.ts`                                             | Ownership-aware recursive disposal and unlinking.                    |
| Modified | `packages/muya/src/block/base/treeNode.ts`                                           | Disposal lifetime and move-preserving detach.                        |
| Modified | `packages/muya/src/block/content/langInputContent/__tests__/diagramLanguage.spec.ts` | Fixture-owned editor teardown.                                       |
| Modified | `packages/muya/src/block/extra/diagram/diagramPreview.ts`                            | Render lifetime, stale-target isolation and cleanup.                 |
| Modified | `packages/muya/src/block/extra/diagram/index.ts`                                     | Guard delayed language completion.                                   |
| Modified | `packages/muya/src/editor/index.ts`                                                  | R1 input subscription ownership/teardown.                            |
| Modified | `packages/muya/src/muya.ts`                                                          | R1 input teardown and R2 tree disposal.                              |
| Modified | `packages/muya/src/selection/TextSelection.ts`                                       | Both-endpoint live-instance ownership validation.                    |
| Modified | `packages/muya/src/types/index.d.ts`                                                 | Sequence cancellation/disposer declarations.                         |
| Modified | `packages/muya/src/utils/diagram/render.ts`                                          | Request validity, native cleanup and finalization cancellation.      |
| Modified | `packages/muya/src/utils/diagram/sequence/sequence-diagram-snap.js`                  | Narrow font/canvas lifecycle adapter.                                |
| Added    | `packages/desktop/test/e2e/diagram-lifecycle.spec.ts`                                | Two real-renderer/permission/integrity cases.                        |
| Added    | `packages/desktop/test/e2e/nativeWindow.ps1`                                         | Test-only native window activation/focus interop.                    |
| Added    | `packages/muya/src/__tests__/previewHostReadiness.spec.ts`                           | Original five investigation probes, unchanged.                       |
| Added    | `packages/muya/src/block/extra/diagram/__tests__/diagramLifecycle.spec.ts`           | 19 lifecycle/integration cases.                                      |
| Added    | `packages/muya/src/editor/__tests__/inputSubscriptionCleanup.spec.ts`                | 11 R1 input cases.                                                   |
| Added    | `packages/muya/src/selection/__tests__/instanceOwnership.spec.ts`                    | 13 R1 selection cases.                                               |
| Added    | `packages/muya/src/utils/diagram/__tests__/renderOwnership.spec.ts`                  | Eight renderer-ownership cases.                                      |
| Added    | `packages/muya/src/utils/diagram/__tests__/sequenceLifecycle.spec.ts`                | Two actual-adapter cancellation cases.                               |

**Proposed commit boundaries, for owner review only.** Three coherent commits can preserve dependency order:

1. `fix(muya): isolate selection ownership and release input subscriptions` — R1 selection/editor changes, its two regression files and only the `editor.destroy()` addition in `Muya.destroy()`.
2. `fix(muya): dispose diagrams and reject stale render completions` — R2 lifetime/render/type/style changes, fixture teardown, R2 unit/real-renderer tests, the unchanged original readiness file, and the `scrollPage.dispose()` addition in `Muya.destroy()`.
3. `test(desktop): verify native input and await rendered diagrams` — the three native-driver files, diagram-viewer readiness correction and the complete shared report with acceptance/evidence.

`muya.ts` is shared between the first two proposed commits and would require deliberate hunk selection later; the report can land with the final commit so it describes the complete verified milestone. If a single atomic milestone commit is preferred, `fix(muya): isolate instances and retire stale diagram renders` can include the complete 25-file set and describe its test-infrastructure support in the body. These are proposals, not Git operations. Nothing is staged, committed, pushed, merged, reset or stashed.

Suggested bodies for the three proposed commits:

1. Validate both native selection endpoints against the live owning Muya root. Release root input dispatch on destruction without stopping surviving instances. Add ownership and subscription regressions.
2. Give diagram attachments permanent disposal and request-owned render targets. Reject obsolete completions and release supported renderer resources on removal, replacement and destruction. Preserve live moves and history with readiness, lifecycle and real-renderer coverage.
3. Bind native Windows input to the intended foreground window and acknowledge delivery. Await the hovered attachment's finalized media while retaining the existing behavioral assertions. Record the investigation, final regressions and owner Windows integrity acceptance.

**Final regression/verification results.** All commands used the existing installed toolchain; no dependency was installed or upgraded.

| Check                                                              | Final result                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged full diagram suite, three repetitions, before correction | Baseline **47 passed / one failed**; R2 **47 passed / one failed**, 1.5 minutes each. Historical failures retained.                                                                                           |
| Corrected full diagram suite, three repetitions                    | Baseline **48 passed**; R2 **48 passed**, 1.3 minutes each, exit 0.                                                                                                                                           |
| Final existing 12-file desktop selection                           | **106 passed**, no failures/skips, 9.6 minutes, exit 0. Includes all 24 Source cases, Reading/Preview, source/visual history, no-op byte/timestamp checks, Split rejection and Electron security regressions. |
| Final separate real-renderer desktop file                          | **Two passed**, 9.8 seconds, exit 0.                                                                                                                                                                          |
| Original readiness plus all R1/R2 focused units                    | **58 passed**, six files, 11.41 seconds, no failures/skips, exit 0: five original probes, 24 R1 cases and 29 R2 cases.                                                                                        |
| `pnpm.cmd run typecheck`                                           | **Passed**, exit 0, including Muya declarations and desktop test types.                                                                                                                                       |
| `pnpm.cmd run lint`                                                | **Passed**, exit 0, zero errors / 166 existing warnings.                                                                                                                                                      |
| `pnpm.cmd -C packages/muya lint`                                   | **Passed**, exit 0, zero errors / four existing warnings in unchanged `format.ts`.                                                                                                                            |

The 106-case command used the same exact 12-file list documented above, one worker and the line reporter; the separate real-renderer file also used one worker. Full diagram repetitions used `pnpm.cmd exec playwright test test/e2e/diagram-viewer.spec.ts --repeat-each=3 --workers=1 --reporter=line --trace=on`, from each archive's desktop directory, with distinct TEMP output directories. The fresh unit command selected `previewHostReadiness`, `instanceOwnership`, `inputSubscriptionCleanup`, `diagramLifecycle`, `renderOwnership` and `sequenceLifecycle` with `--maxWorkers=2 --reporter=dot`. Results overlap: repeated diagram cases and Source cases are included in the broader selection; the focused units are included in the previously completed full Muya suite. No entire-repository desktop UI pass is claimed.

The complete **2,929-pass Muya unit run** and **1,276-pass / 36-existing-skip desktop unit run** remain the latest full unit results. They were not unnecessarily rerun: production and unit-test files retain their verified contents, and this review changes only E2E readiness plus documentation. The prior successful build likewise covers unchanged application source. The additional inherited CSS check above remains a documented baseline finding, not a newly green check or a new regression. No final selected regression remains failing; the historical failed runs have not been erased or reclassified as passes.

All new investigation artifacts are under `$env:TEMP\MarkTextPlus1-final-hover-1665be4b-cc17-49d8-a63e-a6f6414dc2f3`; `$env:TEMP\MarkTextPlus1-final-hover-path.txt` records the root, and `archives-path.txt` points to the isolated builds. `*-unchanged.log`/results retain failed API traces and error-context snapshots; `*-observed.log`/results retain lifecycle JSON and explicit Electron-context `lifecycle-trace.zip` snapshots/screenshots; `*-late.log`/results retain the passing failure-only diagnostic attempts; `*-corrected.log`/results retain repeated post-correction traces. `r2-final-selected.log`, `r2-final-renderers.log`, `final-focused-units.log`, `final-typecheck.log`, `final-lint.log` and `final-muya-lint.log` record final verification. Existing fixture clipboard-value fields were removed from 40 TEMP JSON artifacts after testing. No diagnostic observer, temporary path, generated output, log or screenshot is added to production/tests in the checkout.

**Commit-readiness conclusion.** With owner physical acceptance and both protected-document post-test integrity checks recorded, the native-input gate passed, the fixture defect corrected, final relevant regressions green and no blocking scope/security finding, the combined **25-file change set is ready for owner approval of a Git commit**. This is readiness for the R1/R2 repair milestone and supporting tests; it is not completion of the dedicated preview host or authorization for R3. The baseline toolbar's stationary-hover refresh policy, broader renderer-isolation prerequisites and documented inherited warnings/CSS finding are retained as limitations. No further production fix is proposed by this investigation. Final report-only Prettier write/check, tracked and all eight untracked-file whitespace checks, preserved-file hashes and Git-inventory checks passed. Branch and HEAD remain unchanged, with 17 modified tracked files, eight untracked files, no deletions and an empty index. No Git staging or history operation was performed.
