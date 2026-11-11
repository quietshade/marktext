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

The four-layout default preference remains a Stage 2C decision; current startup Source/WYSIWYG defaults are unchanged. Large-document responsiveness and delayed diagram/highlighting races require measurement and tests with the actual later preview host. No 1 MB or live-update timing claim is made for this infrastructure stage. Existing rendering/clipboard fidelity limits and runtime-only undo persistence remain. Stage 2B.2 requires explicit owner approval.
