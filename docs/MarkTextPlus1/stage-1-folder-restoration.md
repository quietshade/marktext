# Stage 1.5 — Opened-folder restoration

Date: 23 October 2026. Checkout: `214a9aad84b19a1d1cdea2b71668861ba99b1675`, with the previously reviewed, uncommitted Stage 1 changes retained. Requirements: [README](README.md), [specification](specs.md), [baseline matrix](baseline-feature-matrix.md), [Stage 1 report](stage-1-viewer-mode.md) and [approved Windows UI runner](ui-test-investigation.md).

## Finding and scope

An inherited session-cleanup defect is confirmed and fixed. When a folder window closed while another editor window remained, `EditorBufferStore.handleClose()` deleted its entire session snapshot if it had no tabs or only saved tabs. The condition did not consider opened folder roots. Restore All therefore had no snapshot from which to restore that window's folders, even though the renderer and main process had saved them correctly before closing.

The condition predates Stage 1: `git blame` attributes the deletion condition to `85607dd2d`; the pending-document refinement is from `ccc163421`. Stage 1 did not change the project store, buffered-state store, editor-window restoration, root management or startup selection pipeline.

The user confirmed that Open Folder stayed in the same window and that exit used its X button. A fresh, genuinely single-editor-window session already passed before this fix. After the fix, three launch/close cycles using the actual `pnpm run start` script, the X button, Restore All, layout restoration, default Reading Mode and visual editing layout also pass. The cleanup defect depends on another editor window existing at close time; Open Folder need not create that other window. A separate regression covers opening in the current window while a second editor window already exists.

**The exact cause of the user's previous single-window incident is not conclusively established.** The reproduced cleanup defect explains a missing entire folder session under the documented multi-window condition. It would not explain deletion if there truly was only one editor window throughout. No speculative fallback to `lastOpenedFolder`, profile reset or session migration was added.

## Restoration pipeline checked

| Step                     | Source and observed behavior                                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open and display         | `renderer/src/store/project.ts` receives `mt::project-roots-changed`, maintains `roots`, and supplies the sidebar tree. The legacy single-tree getter is not the multi-root session authority.                                                                    |
| Capture tree state       | The project store's `CREATE_BUFFERED_STATE` records every root pathname and relative collapsed paths. Expanded ancestors are recreated as watcher events populate the tree.                                                                                       |
| Capture documents/layout | `renderer/src/store/bufferedState.ts` combines editor tabs, project roots and layout into the version 3 snapshot. Close flushes source edits and awaits the snapshot write before sending `mt::close-window`. Restoration temporarily suspends snapshot creation. |
| Persist canonical roots  | `main/editorBufferStore/index.ts` obtains the sender's stable `restoreBufferId` and main-owned `projectRoots`; the renderer's collapsed paths are merged into those canonical roots. JSON snapshots use the existing atomic write path.                           |
| Close                    | `main/app/windowManager.ts` calls `handleClose` before destroying the window. This was the confirmed loss point: a correctly saved folder snapshot could be deleted as if it were expendable clean-document state.                                                |
| Select startup           | `main/app/index.ts` enumerates retained snapshots for Restore All when no explicit document/folder arguments were supplied. Each snapshot creates its own editor window.                                                                                          |
| Restore roots and tabs   | `main/windows/editor.ts` restores roots before sending `mt::load-state`; `main/windows/projectRoots.ts` publishes the roots and starts their watchers after renderer readiness. The renderer restores tree collapse state, layout, tabs and per-document modes.   |
| Sidebar rendering        | The sidebar renders the root collection, independently of whether the current document lies inside a root. Tests locate the restored folder window and assert its stable session ID, rather than assuming window ordering.                                        |

All abbreviated application paths above are under `packages/desktop/src/`.

## Change

`handleClose` now removes an expendable clean snapshot only when it also contains **no opened roots**. Empty/saved document sessions without folders retain their existing cleanup behavior. Dirty and pending-creation documents remain protected. The existing `readBufferedRoots` compatibility reader also protects legacy root representations.

This keeps closed folder windows as Restore All candidates, including when they close before another window. It does not change sidebar UI, session format, preference defaults, file writes, editor history, security settings or startup selection. The separate existing cleanup policy used when explicitly launching a file/folder is unchanged; explicit launch arguments still take precedence over Restore All. Blank, Open Last Folder and configured-folder startup options are regression-tested separately.

Files added or changed for **this task**:

- `packages/desktop/src/main/editorBufferStore/index.ts` — folder-aware close cleanup.
- `packages/desktop/test/unit/specs/folder-session-cleanup.spec.ts` — nine durable-snapshot cleanup regressions.
- `packages/desktop/test/e2e/folder-session-restoration.spec.ts` — eight Windows desktop restoration/startup regressions.
- `docs/MarkTextPlus1/stage-1-folder-restoration.md` — this report.

The other working-tree changes belong to the previously reviewed Stage 1 work. No dependency manifests, lockfile, root README, production security configuration or user documents were modified by this fix. No commit was created.

## Verification

Checks below were performed using the approved normal Windows runner. No GPU-disabling or sandbox-disabling flags were used. The preview test uses a temporary remote debugging port only to attach Playwright to the normal preview launch; the security regression separately verifies the production BrowserWindow restrictions.

Logs/artifacts are outside the checkout under `%TEMP%/MarkTextPlus1-stage15-*`.

| Command / scope                                                               | Actual result                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New cleanup unit tests against the original condition                         | **4 failed, 5 passed**: the root-bearing snapshots were deleted. Log: `unit-before.log`.                                                                                                                                                                          |
| Pre-fix desktop reproduction                                                  | Single-window case passed; closing the new folder window before the original window failed the assertion that the root snapshot survived close. Log: `before2.log`.                                                                                               |
| `pnpm run build:unpack`                                                       | Passed. Existing ineffective-dynamic-import notices remain. Log: `build.log`.                                                                                                                                                                                     |
| Targeted cleanup, durable buffer, project roots and renderer multi-root units | **23 passed**, four files. Log: `unit-targeted.log`.                                                                                                                                                                                                              |
| `pnpm run test:unit`                                                          | **1,212 passed, 36 existing skips; 119 files passed, 4 skipped**, exit 0. No new skips. Log: `unit-all.log`.                                                                                                                                                      |
| `pnpm run lint`                                                               | Passed, **0 errors, 166 existing warnings**. An initial new test warning was removed. Log: `lint-final.log`.                                                                                                                                                      |
| `pnpm run typecheck`                                                          | Passed after adding an explicit bootstrap-state check in the new preview test; the intermediate run identified optional `window.marktext.env` access in test code. Log: `typecheck-verified.log`.                                                                 |
| Folder/session and broader desktop UI selection                               | **72 passed**, exit 0, including all eight new cases; no skips. Duration: 4.0 minutes. Log: `regression.log`; command below.                                                                                                                                      |
| Real `pnpm run start`, X-button restart probe                                 | **Passed** across three launch/close cycles, restoring the root and Reading Mode tab and preserving file SHA-256, length and modification time. Logs: `preview6.log` and `preview-final.log` (final rerun: 31.4 seconds). Also included in the broader selection. |
| `git diff --check` and protected-file diff                                    | Passed at verification time.                                                                                                                                                                                                                                      |

The eight new UI cases cover same-window opening, new-window opening, same-window opening with an already-existing second editor window, multiple roots, expanded ancestors/collapsed subfolders and roots, hidden sidebar/width restoration, existing locked and editable document tabs, dirty source text, untitled recovery, all other startup options, and the real preview/X-button path. The complex recovery test compares fixture SHA-256, length and `mtimeMs` before and after both shutdowns: recovered dirty text stays in the snapshot, without being saved to its document file.

Development-only test corrections are recorded rather than counted as passes: the initial new-window test incorrectly required a blank clean window to restore as well; an untitled fixture initially seeded text without making it dirty; an unscoped file-title locator matched the restored tab, tree row and opened-file entry. The initial preview launcher also attempted to use an unavailable `npm_execpath`, then environment-only Electron arguments that electron-vite overwrote. The working launcher passes `--user-data-dir` explicitly on the command line. One unsuccessful run had a Windows temporary-directory teardown error; bounded cleanup retries were added, and the selector failure was exposed and corrected. These were test construction failures, not suppressed product failures.

One failed environment-only preview launch may have started the default application profile before the missing debug connection was detected. No test document commands were sent to it and no profile data was directly edited, reset or deleted; normal startup may have refreshed its session snapshot. All successful reproduction and regression runs use disposable profiles and folders. Existing profile preferences and session metadata were inspected without printing Markdown contents.

Reproduce the desktop selection from the repository root:

```powershell
$stage15Specs = @(
  'folder-session-restoration', 'multi-folder-sidebar',
  'issue-2421-sidebar-state', 'issue-5631-folder-collapse',
  'viewer-mode', 'reading-mode', 'cli-read-only', 'cli-missing-file-2143',
  'source-mode-flush', 'parity-source-undo-saved', 'external-reload-undo',
  'layout-toggles', 'document-outline', 'context-isolation', 'launch'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @stage15Specs --reporter=line --output="$env:TEMP/MarkTextPlus1-stage15-review-results"
pnpm run test:unit
pnpm run lint
pnpm run typecheck
```

Not run in Stage 1.5: the complete desktop UI repository suite, Muya/browser suites, packaging, other operating systems, network/removable-drive availability scenarios, crash/power-loss testing and the manual walkthrough below. Muya/rendering behavior was not changed; its Stage 1 results remain historical evidence, not fresh passes for this task.

## Manual Windows retest

These manual steps have not been performed by the agent. Save unrelated work and close other MarkText editor windows normally before testing the single-window case. Do not delete or reset the existing profile.

In a normal VS Code PowerShell terminal at the repository root:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm run build:unpack
$stage15Review = Join-Path $env:TEMP ('MarkTextPlus1-folder-review-' + [guid]::NewGuid().ToString('N'))
$stage15Profile = Join-Path $stage15Review 'profile'
$stage15Root = Join-Path $stage15Review 'project'
$stage15Other = Join-Path $stage15Review 'notes'
New-Item -ItemType Directory -Path $stage15Profile, (Join-Path $stage15Root 'expanded/deep'), (Join-Path $stage15Root 'collapsed'), $stage15Other -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $stage15Root 'read.md'), "# Reading`r`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $stage15Root 'expanded/deep/leaf.md'), "# Leaf`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $stage15Other 'edit.md'), "# Editable`n", [Text.UTF8Encoding]::new($false))
$stage15File = Join-Path $stage15Root 'read.md'
$stage15Before = [pscustomobject]@{
  Hash = (Get-FileHash -LiteralPath $stage15File -Algorithm SHA256).Hash
  Length = (Get-Item -LiteralPath $stage15File).Length
  ModifiedTicks = (Get-Item -LiteralPath $stage15File).LastWriteTimeUtc.Ticks
}
pnpm run start -- --user-data-dir $stage15Profile
```

1. In Preferences > General set Startup action to **Restore All**, enable **Restore previous editor state**, and disable opening folders in a new window. Set the default file mode to Reading Mode for this disposable profile.
2. Use File > Open Folder to open the generated `project` folder. Confirm it stays in the same window. Expand `expanded` and `deep`; leave `collapsed` folded. Open `read.md` and verify Reading Mode. Resize the sidebar.
3. Click the window's **X** button. Wait until the terminal command exits. Run exactly `pnpm run start -- --user-data-dir $stage15Profile` again, with no file/folder arguments. Verify the root, expanded ancestors, collapsed folder, sidebar width, tab and Reading Mode are restored. Repeat the X/restart cycle.
4. Use the sidebar's existing Add Folder (+) control to add the generated `notes` folder. Collapse that root. Open `edit.md`, explicitly switch to Edit Mode, change its text without saving, and create/edit an untitled document. Hide the sidebar, close with X and restart with the same command. Verify both unsaved buffers and their modes survive. Show the sidebar and verify both roots, width and collapse states. The original files on disk must still contain the fixture text.
5. Exercise the confirmed failure condition: use File > New Window to create another editor window; close the folder window with X **first**, then close the remaining window. Restart with the same profile command. The folder window must return with its roots and state. Also test enabling the Open Folder in New Window preference, opening a folder and closing that folder window before the original one.
6. Close the disposable app and compare the unchanged Reading Mode fixture:

```powershell
$stage15After = [pscustomobject]@{
  Hash = (Get-FileHash -LiteralPath $stage15File -Algorithm SHA256).Hash
  Length = (Get-Item -LiteralPath $stage15File).Length
  ModifiedTicks = (Get-Item -LiteralPath $stage15File).LastWriteTimeUtc.Ticks
}
Compare-Object $stage15Before $stage15After -Property Hash, Length, ModifiedTicks
```

The comparison must print no differences. Keep the temporary profile if any step fails.

Finally retest the original workflow using plain `pnpm run start` and the existing preferences. Reopen the missing root once: a snapshot already deleted or saved with an empty root list cannot reconstruct it from this fix. Close with X, wait for the terminal to exit, restart and inspect it again. Do not pass the folder pathname as a startup argument for this Restore All check.

If the root still disappears with exactly one editor window, retain the session files for diagnosis and record root presence **while open, after X closes the app, and after restart**. The relevant files are `<user-data-dir>/editorStates/*_editor_buffer_store.json`, normally under `%APPDATA%/marktext`; inspect `project.roots` and tab counts locally without sharing document Markdown. This distinguishes a missing root update, deletion on shutdown and failed startup restoration. No automatic recreation from `lastOpenedFolder` or repair of historical missing-root snapshots is claimed.

The inherited cleanup fix is ready for review, with the single-window limitation stated above. No later-stage feature work or commit is included.
