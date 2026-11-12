# Post-Stage 2A — Sidebar request cleanup

24 October 2026. Baseline: `dabd08cb97ed44fb3cfe8e3131a018d58848638c`, branch `feature/marktext-plus-one`; the working tree was clean at the start. This addresses the minor cleanup concern in the [Stage 2A review](stage-2a-layout-preview.md#final-manual-acceptance-and-git-review--24-october-2026). No commit or push is included; Stage 2B remains deferred.

## Confirmed cause and lifecycle

Before application changes, two new unit regressions failed while the other 16 focused cases passed. Three failed promoted opens retained three numeric IDs (`8`, `9`, `10`) in the actual renderer promotion Set. Main removed its pending reads and retained its existing error notifications, but sent no request-specific terminal failure to the renderer. The Set removed entries only on successful document delivery. Repeating this ordinary sidebar-open sequence with filesystem read failures can therefore accumulate bookkeeping during a running session. The retained entries are numeric IDs, not document buffers; no disk-content loss was established.

The renderer assigns monotonically increasing request IDs and remembers promotion separately from the most recent temporary preview. This is necessary: a promoted file must still open permanently if another preview starts while its read or IPC delivery is pending. Main tracks pending preview reads and mutates their captured options on promotion. The existing request-generation guard invalidates asynchronous work belonging to an old renderer/window lifetime.

The correction adds one typed main-to-renderer event, `mt::sidebar-open-failed(requestId, pathname)`, emitted to the request's owning window when its read fails. The existing notification and logging remain. The renderer removes that exact promotion ID, settles the latest-preview pointer only if it matches, and removes the failed path's intent only if that intent still belongs to the same request ID. An optional ID on the existing transient intent supplies that ownership check; it is not document or session state.

| Outcome                                      | Ownership and cleanup                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful promoted open                     | Keep the ID until document delivery, then consume it. Queued messages with original preview options still produce a permanent tab.                                |
| Failed promoted or ordinary sidebar read     | Remove only the failed ID and its matching intent/latest pointer. Retrying an ordinary failed preview no longer needs a different selection first.                |
| Older failure during a newer same-path retry | Preserve the newer intent and promotion; the failed request cannot clear them by pathname alone.                                                                  |
| Stale unpromoted success                     | Existing main/renderer stale-response guards still discard it. No timeout or bulk promotion cleanup is added.                                                     |
| Cancelled temporary preview                  | Existing cancellation removes the temporary request/intent. A different pending permanent promotion remains valid.                                                |
| Renderer reload                              | Existing generation invalidation discards old completions/failures; the new renderer starts with new local bookkeeping.                                           |
| Window closure                               | Normal window destruction resets main request tracking and releases the renderer. Late reads do not send failures or documents to a replacement/destroyed window. |

The generation guard now also covers sidebar requests made with temporary preview tabs disabled, because those requests carry the same IDs and can be promoted/retried too. Explicit File Open calls without sidebar IDs retain their existing path. No acknowledgement based merely on a missing pending entry is used: main may already have queued a valid successful delivery at that point.

## Files and scope

- `packages/desktop/src/main/windows/editor.ts`: owner-window read-failure event and sidebar-request lifetime checks.
- `packages/desktop/src/renderer/src/store/editor.ts`: exact failure cleanup and transient intent ownership.
- `packages/desktop/src/shared/types/ipc.ts`: typed event payload.
- `packages/desktop/test/unit/specs/editor-preview-tab.spec.ts`: successful/failed ID cleanup, overlap, retry, cancellation and queued-delivery coverage. Tests observe the private Set without adding a production diagnostics API.
- `packages/desktop/test/unit/specs/editor-window-preview-open.spec.ts`: failure notification, same-path read overlap, preview-disabled requests and successful/failed completions after reload/destruction.
- `packages/desktop/test/e2e/sidebar-request-cleanup.spec.ts`: real Electron sidebar gestures with controlled filesystem-read failures, retries and overlapping promotions; unchanged BOM/CRLF/trailing-space fixture bytes and timestamps.
- This report.

No document layout, permission, rendering, session-persistence, file-dialog, dependency, packaging, preload or Electron security implementation changes are included. The previous promotion and pointer-geometry corrections remain in place. A permission-denied error is injected at the main-process read boundary in desktop tests; the tests do not change real user-file permissions or production behavior, use arbitrary startup delays, skip assertions or weaken sandboxing.

## Verification

Checks used the approved normal Windows runner, isolated profiles and disposable files. Final source was built before the final UI run; no build overlapped a running UI suite. Logs and artifacts are outside the checkout under `%TEMP%/MarkTextPlus1-sidebar-cleanup-*`.

| Check                                | Actual result                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-change focused unit reproduction | **2 failed, 16 passed**: retained IDs and missing terminal failure delivery. `before.log`.                                                                                                                                                                                     |
| Final full desktop units             | **1,253 passed, 36 existing skips**, 123 files passed / 4 existing skipped files. Includes 13 added unit cases and all 29 cases in the two focused ownership specs. `unit-final.log`.                                                                                          |
| Final selected desktop UI            | **61 passed, 0 failed, 0 skipped**, 3.3 minutes: 2 new failure/retry cases, 10 sidebar preview/promotion cases, 23 fixed-coordinate/release cases, 5 auto-reveal cases, 7 layout-restoration cases and 14 Viewer Mode cases. `ui-final.log`; artifacts in `ui-final-results/`. |
| `pnpm run build:unpack`              | **Passed** after the final source edit; existing ineffective dynamic-import notices remain. `build-final.log`.                                                                                                                                                                 |
| `pnpm run typecheck`                 | **Passed**. `typecheck-final.log`.                                                                                                                                                                                                                                             |
| `pnpm run lint`                      | **Passed**, 0 errors / **166 existing warnings**, no new warnings. `lint-final.log`.                                                                                                                                                                                           |
| `git diff --check`                   | **Passed**; seven scoped files, no staging, commit or push.                                                                                                                                                                                                                    |

The final UI run retains both earlier delayed-read/queued-IPC promotion races and fixed-coordinate two-click tests; it does not substitute locator double-clicks for pointer-geometry coverage. The new read-failure cases exercise repeated promotions, successful retry, one failed promotion alongside another delayed valid promotion, normal single-click retry, permanent-tab retention, no duplicates, Reading Mode and byte/mtime integrity. The unit cases directly check numeric ID release and same-path request ownership; no production inspection interface was added.

Development results retained for clarity: the first extended unit run had **28 passes and 1 fixture failure** because its exact expected options omitted the existing `readOnly: false` field; the strict expectation was corrected to include it. The first lint run reported 167 warnings because the new send used a non-null assertion; a safe window check removed that new warning. An earlier 61-case UI run and full unit run passed before that final small guard refinement; both complete selections were repeated against the final source. Repeated runs overlap and are not additional distinct tests. No assertion, timeout or skip setting was weakened; no failures remain in the final runs.

Commands from the repository root:

```powershell
pnpm -C packages/desktop exec vitest run --maxWorkers=2
pnpm run build:unpack
pnpm run typecheck
pnpm run lint
$cleanupSpecs = @(
  'sidebar-request-cleanup', 'issue-2395-preview-tabs', 'sidebar-pointer-gesture',
  'sidebar-auto-reveal-528', 'document-layout-restoration', 'viewer-mode'
) | ForEach-Object { "test/e2e/$_.spec.ts" }
pnpm -C packages/desktop exec playwright test @cleanupSpecs --workers=1 --reporter=line --output="$env:TEMP/MarkTextPlus1-sidebar-cleanup-ui-final-results"
```

The pre-change reproduction ran only `test/unit/specs/editor-preview-tab.spec.ts` and `test/unit/specs/editor-window-preview-open.spec.ts`. The entire repository desktop UI, standalone Muya/browser suites, installers and other operating systems were not rerun. Physical hardware double-clicks and real network/removable-drive faults were not newly tested; coordinate input and controlled read failures are the automated evidence. The earlier Stage 2A manual acceptance remains historical, including its explicitly unverified physical Preview IME check. The confirmed retained-ID concern is corrected locally and ready for review; no Stage 2B work is included.

## Manual Windows retest

Use disposable documents and an isolated profile, preserving your real session:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm run build:unpack
$cleanupProfile = Join-Path $env:TEMP ('MarkTextPlus1-sidebar-cleanup-' + [guid]::NewGuid().ToString('N'))
pnpm run start -- --user-data-dir "$cleanupProfile"
```

1. Open a disposable folder containing alpha.md, beta.md and gamma.md. Enable sidebar preview tabs and Opened files. Single-click alpha then beta: one italic temporary tab should be replaced.
2. Physically double-click alpha, beta and gamma without moving the pointer between clicks. All three must remain permanent, and the tree must stay stable between clicks. Repeat in a scrolled tree and with an existing document already open.
3. Double-click an already-open file: focus its existing tab without duplication or permission/layout changes. Make an unsaved edit in an editable test document and verify unrelated sidebar navigation does not lose it.
4. Deterministic failed-read/retry and delayed-promotion verification is available through the automated command below; no manual filesystem-permission changes are necessary. Real removable/network-drive timing remains environment-specific manual scope. Numeric ID retention is verified directly in the unit tests rather than exposed in the application UI.

## Final manual Windows acceptance

On 24 October 2026, the owner reported all four physical Windows acceptance checks passed:

1. Single-click temporary preview tabs behave correctly.
2. Alpha, Beta and Gamma open permanently without sidebar movement.
3. Reopening Alpha focuses the existing tab without duplication.
4. Beta's unsaved edit remains intact after switching documents.

These are **user-reported physical tests**, separate from Codex's automated verification recorded above. The owner has accepted the cleanup. Real network/removable-drive failures have **not been physically tested**; their timing remains outside this manual acceptance, with controlled read failures providing the automated evidence.
