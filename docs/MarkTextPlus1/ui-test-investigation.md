# MarkText+1 Stage 0.5: automated UI test investigation

Date: **23 October 2026**. Starting checkout: `d19cc7058cb993d9584d91c3e33c37df73e76092` (`feature/marktext-plus-one`), which contains the approved [Stage 0 baseline](baseline-feature-matrix.md). Requirements remain [specification v1.0](specs.md). The starting working tree was clean.

## Outcome

The desktop and Muya UI smoke checks can run reliably outside the restricted command-execution sandbox. The Electron environment and Windows launcher/locator issues were fixed in test code. No application source, production settings, dependency manifest, lockfile, or Muya code/configuration changed. No commit was created.

The command-execution sandbox is different from Electron's renderer sandbox. Running these checks through an approved unrestricted command runner does not disable Electron security: the desktop integration check asserts sandbox=true, contextIsolation=true, nodeIntegration=false and webSecurity=true, as well as verifying that renderer require/global/Buffer and legacy preload globals are unavailable.

## Root causes and isolated experiments

| Experiment                                                                                                       | Actual result                                                                                                                                               | Conclusion                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unmodified desktop launch outside command sandbox, with inherited ELECTRON_RUN_AS_NODE=1                         | Failed before assertions; Electron rejected --remote-debugging-port=0, exited 9. afterAll also attempted app.close on undefined.                            | The inherited Node-only mode is a confirmed independent launch failure; broader host permissions alone do not fix it.                                                                                           |
| Unmodified desktop launch outside command sandbox, removing only ELECTRON_RUN_AS_NODE in that shell              | 1 launch test passed, exit 0, 4.9 s.                                                                                                                        | The original application/artifacts and Playwright arguments work without a dependency or application change.                                                                                                    |
| Minimal temporary Electron entry, direct installed electron.exe, clean child environment, inside command sandbox | GPU child repeatedly exited -1073741515; renderer launch-failed (49); parent exited 2147483651.                                                             | Failure reproduces without MarkText or Playwright, excluding their application/test logic as the cause of this host-specific startup failure.                                                                   |
| Same minimal entry inside command sandbox with --disable-gpu                                                     | Same GPU/renderer failure.                                                                                                                                  | GPU disabling is not a repair here. Flag tested only in a disposable diagnostic; not added to tests or production.                                                                                              |
| Same minimal entry and installed executable outside command sandbox, no GPU flags                                | Window loaded; exit 0; sandbox, context isolation and web security true; Node integration false. No runtime installation performed.                         | The command-execution restriction causes the difference. No missing runtime dependency requiring installation was demonstrated; the precise Windows loader restriction behind -1073741515 remains unidentified. |
| Direct Node spawnSync of Windows electron.cmd without shell                                                      | EINVAL.                                                                                                                                                     | The shell wrapper is not a native executable and is unsuitable for the harness's direct second-instance spawn. Playwright could launch the wrapper, but the extra wrapper was unnecessary.                      |
| Unmodified Muya Chromium smoke outside command sandbox                                                           | All 6 tests passed; process exited 0 in 8.5 s, including server teardown.                                                                                   | No Muya application/configuration repair is needed for the reported smoke hang.                                                                                                                                 |
| Muya smoke inside command sandbox with a temporary event reporter and pw:webserver diagnostics                   | All 6 onTestEnd events were passed; log stopped at Terminating the WebServer; 30 s global deadline reported timedout. Invocation did not clean up normally. | The original apparent browser-test hang is server/process teardown, not a failing smoke assertion. This restricted run is not counted as a successful suite.                                                    |
| Playwright-equivalent taskkill /PID <owned-disposable-child> /T /F inside command sandbox                        | Exit 1, ERROR: Access denied.                                                                                                                               | Restricted process-tree cleanup cannot stop even the disposable child created by that diagnostic.                                                                                                               |
| Same disposable-child cleanup outside command sandbox                                                            | Exit 0; child tree terminated.                                                                                                                              | Host permission difference explains the teardown failure path. No arbitrary user process was terminated.                                                                                                        |

The installed Playwright implementation confirms the mechanism: Windows web-server cleanup calls killProcessTree, which invokes taskkill /T /F, then waits for process cleanup. The relevant installed files are `node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/lib/runner/index.js` and `node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core/lib/coreBundle.js`. Failed process-tree termination can leave Vite alive and the runner waiting. These dependency files were inspected, not edited.

The diagnostic restricted Vite server was identified by its listener and workspace command line and stopped through an approved unrestricted runner. Do not use broad process-name termination against node, chrome or electron: it could close unrelated work.

Electron documents that [ELECTRON_RUN_AS_NODE starts a normal Node process](https://github.com/electron/website/blob/main/docs/latest/api/environment-variables.md#electron_run_as_node); Playwright documents [its executablePath, env and cwd launch options](https://playwright.dev/docs/api/class-electron#electron-launch). The installed implementation and the controlled experiments above are the evidence for this checkout, rather than assumptions about newer library behavior.

## Test-harness changes

All paths below are relative to `packages/desktop/` unless stated otherwise.

| File                                                 | Change and purpose                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/e2e/electronEnvironment.ts` (new)              | Builds an isolated child environment; removes ELECTRON_RUN_AS_NODE, including Windows case variants; retains unrelated values and explicit test overrides. Does not mutate parent process.env.                                                                                                               |
| `test/e2e/helpers.ts`                                | Uses that environment; resolves the installed native executable from package-local path.txt on Windows as already done on other platforms; closes a partially initialized app on window-readiness failure before rethrowing the original error. Keeps the normal application package directory as the entry. |
| `test/e2e/helpers.ts::openProjectFolder`             | Uses an exact-title locator instead of interpolating a filesystem path into CSS. The first broader run had 14 passes and one timeout despite the file being visible: Windows backslashes were CSS escapes. The same test passed after this helper correction.                                                |
| `test/e2e/issue-3020-second-instance-args.spec.ts`   | Applies child-environment sanitization to direct second-instance spawn. Native executable resolution avoids the confirmed .cmd spawn error.                                                                                                                                                                  |
| `test/e2e/issue-5685-opened-files-resize.spec.ts`    | Applies sanitization to the existing restart launch.                                                                                                                                                                                                                                                         |
| `test/e2e/multi-folder-sidebar.spec.ts`              | Applies sanitization to session-restoration launch, retaining its existing error-counter setting.                                                                                                                                                                                                            |
| `test/e2e/launch.spec.ts`                            | Guards teardown when setup never returned an app; adds a real-GUI assertion that the Node-only flag is absent in Electron.                                                                                                                                                                                   |
| `test/e2e/context-isolation.spec.ts`                 | Extends the existing security check with actual BrowserWindow web-preference assertions.                                                                                                                                                                                                                     |
| `test/unit/specs/electron-environment.spec.ts` (new) | Three regressions cover parent-env preservation, test overrides/unset values, and Node-only mode in overrides/case variants.                                                                                                                                                                                 |
| `docs/MarkTextPlus1/baseline-feature-matrix.md`      | Adds a link to this follow-up; preserves historical Stage 0 results.                                                                                                                                                                                                                                         |
| `docs/MarkTextPlus1/ui-test-investigation.md` (new)  | This investigation, commands, evidence and manual fallback.                                                                                                                                                                                                                                                  |

No retries, skips, timeout increases in repository configuration, error suppression changes, GPU flags or security bypasses were added. Existing crash-test error recording remains opt-in. Existing command/test behavior and the production build were preserved. The Muya test configuration is unchanged because its normal execution completes outside the restricted host.

## Verification record

Windows x64; Node v24.22.1; pnpm 10.33.4; Electron 42.1.0; Playwright 1.64.0; existing desktop build artifacts from the user-reported successful build. No rebuild, native runtime repair or package installation was needed. The post-fix UI runs deliberately retained ELECTRON_RUN_AS_NODE=1 in the parent environment to exercise the child-environment fix.

Commands ran from the repository root. In the commands below, `$stage05Results` is a unique directory under `$env:TEMP`. Logs are `%TEMP%/MarkTextPlus1-stage05-<suffix>.log`, outside the checkout. Test screenshots/failure reports also stayed in temporary output directories.

| Command / selection                                                                     | Result                                                         | Log suffix / scope                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Original launch, inherited environment                                                  | Failed as described above                                      | desktop-original-inherited; diagnostic baseline, not hidden.                                                                   |
| Original launch, only Node-only variable removed                                        | 1 passed, exit 0                                               | desktop-original-cleanenv.                                                                                                     |
| Unmodified Muya `tests/smoke`, Chromium, 1 worker                                       | 6 passed, exit 0, 8.5 s                                        | muya-original-smoke.                                                                                                           |
| Restricted Muya smoke with temporary event reporter, 30 s global deadline               | 6 individual passed events; run timed out and required cleanup | muya-restricted; not counted as a passing suite.                                                                               |
| First repaired desktop smoke group                                                      | 14 passed, 1 failed; exit 1                                    | desktop-smoke; existing Windows CSS-path bug exposed after startup was repaired.                                               |
| Final desktop group A, command below                                                    | 15 passed, exit 0, 25.9 s                                      | desktop-smoke-final.                                                                                                           |
| Final desktop group B, command below                                                    | 20 passed, exit 0, 1.3 min                                     | desktop-state-safety; includes all 13 Reading Mode tests, five source transition/parity tests and both modified restart paths. |
| Final desktop group C, command below                                                    | 8 passed, exit 0, 17.9 s                                       | desktop-export-parity; remaining three parity/saved-state tests and all five release web-security/export tests.                |
| Muya smoke repeated twice, command below                                                | 12 passed, exit 0, 13.0 s                                      | muya-smoke-repeat; verifies repeated completion and server cleanup.                                                            |
| `pnpm -C packages/desktop exec vitest run test/unit/specs/electron-environment.spec.ts` | 3 passed, exit 0                                               | New environment regressions.                                                                                                   |
| ESLint over the eight changed/new test files                                            | Passed, exit 0; 7 existing warnings in multi-folder-sidebar    | Before the final shared folder-locator correction.                                                                             |
| `pnpm run lint`                                                                         | Passed, exit 0; 0 errors, 166 warnings                         | lint; final helper changes included. Same warning count as Stage 0.                                                            |
| `pnpm run typecheck`                                                                    | Passed, exit 0                                                 | typecheck; final test-harness types plus existing engine declarations.                                                         |

Final desktop groups A/B/C cover **43 distinct tests**, with no skipped or expected-failure result in these groups. Earlier diagnostic failures and the initial 14/1 run are retained above; they are not added to the final pass count. The three new unit checks are separate from those UI checks.

### Exact automated commands

Run these in normal Windows PowerShell at the repository root. In an agent environment, use the approved command runner outside its process sandbox for the UI commands. Do not change Electron BrowserWindow security or use --no-sandbox to work around host restrictions.

```powershell
$stage05Results = Join-Path $env:TEMP ('MarkTextPlus1-stage05-' + [guid]::NewGuid().ToString('N'))

# Group A
pnpm -C packages/desktop exec playwright test test/e2e/launch.spec.ts test/e2e/context-isolation.spec.ts test/e2e/issue-3020-second-instance-args.spec.ts test/e2e/layout-toggles.spec.ts test/e2e/cli-read-only.spec.ts test/e2e/source-mode-flush.spec.ts --reporter=list --output (Join-Path $stage05Results 'desktop-a') --global-timeout=240000

# Group B
pnpm -C packages/desktop exec playwright test test/e2e/reading-mode.spec.ts test/e2e/parity-source-undo-saved.spec.ts test/e2e/multi-folder-sidebar.spec.ts test/e2e/issue-5685-opened-files-resize.spec.ts --grep 'reading|source mode|source-mode|multi-folder sidebar|an app restart' --reporter=list --output (Join-Path $stage05Results 'desktop-b') --global-timeout=240000

# Group C
pnpm -C packages/desktop exec playwright test test/e2e/web-security.spec.ts test/e2e/parity-source-undo-saved.spec.ts --grep 'web-security|PG15|G6|a save clears the dot' --reporter=list --output (Join-Path $stage05Results 'desktop-c') --global-timeout=180000

pnpm -C packages/muya/e2e exec playwright test tests/smoke --project=chromium --workers=1 --repeat-each=2 --reporter=list --output (Join-Path $stage05Results 'muya') --global-timeout=90000
pnpm -C packages/desktop exec vitest run test/unit/specs/electron-environment.spec.ts
pnpm run lint
pnpm run typecheck
```

The grep expressions select relevant existing tests, not expected-success outcomes. Playwright includes filenames and describe titles when matching: group B selects all Reading Mode tests; groups B/C together select the entire eight-test parity file. A known failing folder-search test was fixed and rerun rather than excluded. Global deadlines bound diagnostic commands, without modifying individual test timeouts or converting failures to skips. Run desktop groups sequentially to avoid desktop-focus interference.

## Remaining limitations and manual fallback

The restricted command environment itself remains unsuitable for Electron's native child processes and Playwright Windows process-tree teardown. The safe operational repair is an approved normal Windows process environment, not a production flag or weakened app sandbox. The exact native loader restriction inside the command sandbox is not diagnosed further; the passing same-binary comparison establishes that no runtime installation is required for the tested normal environment.

Not run in Stage 0.5: the full desktop E2E suite; full Muya editing/diagram/browser suites; Firefox/WebKit; the full desktop/engine unit and conformance suites already recorded in Stage 0; installers/other-platform packaging; Windows file-association dispatch; real OS bitmap clipboard/file-manager drag/drop; physical printing; accessibility/scaling walkthrough; a complete no-op hash/mtime/encoding fixture matrix. The focused suite does exercise real temp-file saves, default reading, external changes, dirty close/unlock/save, source undo, native copying, session restore and HTML/PDF export. It does not certify every Stage 1 acceptance gate or every upstream capability.

For a manual no-op disk-integrity check, use disposable fixtures and a fresh profile. This does not install anything or use an existing personal application profile. If another instance interferes, close it normally after saving your work rather than killing its process.

```powershell
$stage05Manual = Join-Path $env:TEMP ('MarkTextPlus1-manual-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage05Manual | Out-Null
$stage05Fixture = Join-Path $stage05Manual 'read-check.md'
[IO.File]::WriteAllText($stage05Fixture, "# Reading check`r`n`r`n- [ ] task`r`n", [Text.UTF8Encoding]::new($true))
$stage05Hash = (Get-FileHash -LiteralPath $stage05Fixture -Algorithm SHA256).Hash
$stage05Modified = (Get-Item -LiteralPath $stage05Fixture).LastWriteTimeUtc.Ticks
$stage05Length = (Get-Item -LiteralPath $stage05Fixture).Length
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm -C packages/desktop exec electron . --user-data-dir (Join-Path $stage05Manual 'profile') --read-only $stage05Fixture

# After closing the test app:
if ((Get-FileHash -LiteralPath $stage05Fixture -Algorithm SHA256).Hash -ne $stage05Hash) { throw 'File bytes changed' }
if ((Get-Item -LiteralPath $stage05Fixture).LastWriteTimeUtc.Ticks -ne $stage05Modified) { throw 'File timestamp changed' }
if ((Get-Item -LiteralPath $stage05Fixture).Length -ne $stage05Length) { throw 'File length changed' }
```

While that app is open:

1. Confirm Reading Mode in the View menu or statistics popover. Try typing, paste, cut, formatting, checkbox toggling, undo and Save. The document must stay unchanged; selection/copy and safe navigation must work.
2. Toggle the sidebar with Ctrl+J and the View menu, resize it, and navigate the outline. Close the app and run the three integrity comparisons above. Repeat with LF/no-BOM, UTF-16/BOM and trailing-blank fixtures as needed; record results rather than assuming one fixture proves all encodings.
3. In a separate disposable copy, explicitly unlock, edit visually, switch to source, edit, return and undo/redo. Confirm pending text survives. Lock a dirty tab and verify autosave pauses; Cancel close, then explicitly unlock/save. Compare saved text and the unsaved indicator.
4. Test local images, table/math/diagram output, HTML/PDF export, and session restore. Perform real OS clipboard/image-drop, file association, native dialogs, scaling and printer checks separately where required.

The current baseline deliberately exits source when entering Reading Mode and blocks find while reading. Stage 0.5 preserves those existing behaviors; the specification's read-only source/find/always-visible indicator changes remain Stage 1 work. Do not describe those planned improvements as already implemented.

## Stage 1 readiness

The startup/teardown blockers now have reproducible environment diagnoses and a passing normal-Windows execution path. The focused baseline UI coverage includes the safety, state and restart paths most relevant to Stage 1. Stage 1 can proceed after owner review using this runner and the [existing Stage 1 acceptance criteria](baseline-feature-matrix.md#stage-1-acceptance-and-readiness); full fixture/manual/parity gates still apply to its changes. Stage 0.5 implements no MarkText+1 feature and stops here for review.
