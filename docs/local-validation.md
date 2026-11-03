# Local validation

## Live mechanics checkpoint on this Mac

On November 3, 2026, `npm test` at `bf7cd147fa59de535bbca44312b0b9f31fafdecc` on `feat/parallaxia-live-mechanics` completed with **355 passed, 0 failed, 1 skipped** (356 tests, one suite). Node `v22.23.1`. Started 15:51:41Z, finished 16:09:48Z, elapsed 1,087.02 seconds; exit 0.

The skip is the unpaid Muse echo preflight: pinned `~/.local/bin/muse-bin-1.3.0-R3057.1` is not executable on this Mac. No Muse agent session or paid Muse recovery was started. The restricted Docker isolation/publication test passed in 200.61 seconds, including the coordinator image. The historical other-Mac rejection did not reproduce; no publication or isolation gate was weakened. Failed worker payloads are now retained for diagnosis.

Logs: `reports/live-mechanics/full-suite.log` and `full-suite-metadata.json`. The shared ledger SHA-256 before and after was `1934f39c37ede0c05a4cadf1348e280926151fd5a0372d2a23c23caa21b51d3d`; the suite made no paid provider request.

After that full run, Richard requested removing the persistent age/privacy/model banner and raising the default whole-job cap to $7. Release polish also added the actual frozen-task table, recipient-aware verification CLI, correct nested links, baseline selection across reload/back, and diagnostic reopening without selecting an unsuccessful child. These later changes were checked with focused tests; **the full suite was not repeated after them** when Richard requested wrapping up.

| Later command/check | Actual result |
| --- | --- |
| `node --test --test-concurrency=1 tests/hosting.test.mjs tests/hosting-component.test.mjs tests/parallaxia-generation.test.mjs` | 25/25 passed. Covers $7 reservation before provider access, unchanged historical reservations/$50 definition, settlement, full uncertain bound, insufficient reserve refusal, one repair and reconnect. Temporary fixtures only. |
| `node --test --test-concurrency=1 tests/parallaxia-identity.test.mjs tests/parallaxia-release.test.mjs tests/product-release.test.mjs` | 8/9 passed initially. Only failure was a stale assertion expecting the removed playback audience notice; all recipient/UI, cap/dialog, release CLI/ZIP and other product tests passed. |
| `node --test --test-concurrency=1 --test-name-pattern='injected playback catalog' tests/product-release.test.mjs` | The corrected stale assertion passed 1/1. No model request. |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | Passed after UI/cap changes. |
| `npm run build:frontend`, `npm run build:creator` | Passed after UI/cap changes. |
| Actual generated release rebuild after final changes | Passed (`reports/live-mechanics/final-measured-release-build-v2.log`): nested links, baseline across reload/back, unsuccessful diagnostic retention, all ten task rows, exact system-extracted ZIP, paired exported/site replay and same-component JUJUMP. The preceding final-build attempt exposed iframe history interfering with back navigation; version changes now mount a fresh frame at their reset boundary. The failed build log remains retained. |
| Changed JavaScript syntax and `git diff --check` | Passed. |

The actual generated release in `reports/release-parallaxia/` features right-goal artifact `07c2211ed729b557330f669c93808cf62384274fdf0c7cdc6078e2fe0d02755b`. Its exact ZIP was system-extracted in a fresh browser with nonlocal requests and POSTs blocked; both normal-speed branch end digests matched. Same-component JUJUMP and the nested base path passed. The frozen campaign is **8/9 positive, 1/1 correct negative**, not an all-green campaign. See [individual measurements and limitations](live-mechanics-results.md).

## Historical validation from the handoff

The checkpoints below are retained verbatim as historical records. Their paths and branch names refer to the other Mac; they are superseded by the measurements above.

## Full suite checkpoint at a32f0e9

Recorded 2026-11-03 on branch `codex/playable-motion-remixes` at `a32f0e98c9e762667d31de32d9e8cb624320ffb2` (`a32f0e9`, `fix: bound browser replay rendering in isolated workers`). Node `v26.7.0`. The commit has an SSH `gpgsig` header. Git config was not changed. No paid call, demo capture, deploy, or commit.

`npm test` is `node --test --test-concurrency=1 tests/*.test.mjs`. One run from the repo root.

| | |
| --- | --- |
| Started | 2026-11-03T02:34:58Z |
| Ended | 2026-11-03T02:51:41Z |
| Exit | 1 |
| Tests | 340 |
| Pass | 339 |
| Fail | 1 |
| Skipped | 0 |
| Cancelled | 0 |
| Todo | 0 |
| Suites | 1 |
| `duration_ms` | 1001347.077958 |

Log: `/private/tmp/motion-transfer-cursor-next/qa-reports/npm-test-final.txt`. Failure note: `/private/tmp/motion-transfer-cursor-next/qa-full-failures.md`. Handoff: `/private/tmp/motion-transfer-cursor-next/qa-full-final.handoff.md`.

`reports/motion-transfer-phase/phase-budget.json` SHA-256 before and after: `4e90c6014859155c2d4e1147251d9226794eb799ea9d9abaaf97e7feb3813c00`. The file was not created, reset, migrated, or reconciled.

The failure is `tests/hosting-isolation.test.mjs:134`. `ready.status` was `failed`, expected `ready`. `ready.error` is `Publication requires a real isolated worker result; parent unchanged`, thrown by `hosting/coordinator.mjs:89`. Duration 279419.603666ms. Not a Docker-daemon skip. Both images were built during the test:

- `motion-transfer-verifier:local` `sha256:6e08bf2a24bb44271b9d64a43b09d2e24669e492b9515f621a8be84db1386fc8`, created 2026-11-03T02:37:55Z
- `motion-transfer-coordinator:local` `sha256:2f9e996e47ed56e95c761b1b909daf8ac75162dce9a78ef7afa00d0897f19a10`, created 2026-11-03T02:39:38Z

The test reached the publication assert, so the builds, container probes, and direct saved-adapter `verify-native` in that test passed. The coordinator image command later in the same test did not run. Isolation was not rerun.

`test:frontend` and `benchmark:verify` were not separate commands. Their files are inside `npm test`. The five frontend checks from `90b7c83` were not repeated.

## Work checkpoint

The user requested a wrap-up with no new Cursor or Antigravity sessions. All existing code agents were stopped or had already completed. The remaining Argon worker-entry diagnostic and its named container were stopped; no worker fix was applied and no isolation rerun passed. The next step is to inspect the rejected native/browser worker payload and rerun `npm run verify:hosting:isolation` after a focused fix. Public creation remains disabled. Demo/video polish is left to the user.

## Frontend checks at 90b7c83

These remain the frontend result. No frontend source changed after them. They are not a suite result.

Recorded 2026-11-03T02:16:48Z–2026-11-03T02:17:19Z at `90b7c83f0fc6af2a497b0c53900f8b0959ac92b8`. Node `v26.7.0`.

| Command | Window (UTC) | Result |
| --- | --- | --- |
| `npm run typecheck` | 02:16:48–02:16:50 | exit 0. `frontend-final-typecheck.txt` |
| `npm run lint` | 02:16:55–02:16:57 | exit 0. `frontend-final-lint.txt` |
| `npm run format:check` | 02:17:03–02:17:04 | exit 0. All matched files use Prettier code style. `frontend-final-format.txt` |
| `npm run build:frontend` | 02:17:11–02:17:12 | exit 0. Built `reports/frontend-build/`. `frontend-final-build-frontend.txt` |
| `npm run build:creator` | 02:17:19–02:17:19 | exit 0. Wrote `web/dist/creator/index.html`. `frontend-final-build-creator.txt` |

## Historical baseline at f6cc282

The counts and residual rows below are the earlier suite at `f6cc28251a42ad61dda25d28fe47ccf2787baf72`. They are not the result of the `a32f0e9` run.

# Local validation baseline

Recorded 2026-11-03 from branch `codex/playable-motion-remixes` at `f6cc28251a42ad61dda25d28fe47ccf2787baf72`. Node `v26.7.0`. No paid Meta call, no deploy, no commit. The shared phase ledger was not created or rewritten.

Reports are in `/private/tmp/motion-transfer-cursor-next/qa-reports/`. The coordination note is `/private/tmp/motion-transfer-cursor-next/qa.handoff.md`.

`npm test` is `node --test tests/*.test.mjs`. The runs below add `--test-concurrency=1`.

## Commands and counts

| When (UTC) | Command | Result |
| --- | --- | --- |
| 00:37 | `node --check` on every `*.js`, `*.mjs`, and `*.cjs` outside `node_modules` and `.git` | 381 files, 0 syntax failures |
| 00:46 | same `node --check` after later files appeared | 383 files, 0 syntax failures |
| 00:37 | `npm run typecheck` | exit 0 |
| 00:46 | `npm run typecheck` while `web/app` was mid-edit | exit 2. `web/app/components/recovery-task.tsx` 121, 124, 127: `TS2304` `Cannot find name 'linkHref'` |
| 00:47 | `npm run typecheck` after `import { linkHref } from '../links'` was present | exit 0. `typecheck-current.txt` |
| 00:37 and 00:46 | `npm run lint` | exit 0 |
| 00:37 | `npm run format:check` | exit 0 |
| 00:47 | `npm run format:check` | exit 1. Prettier reported 9 files: `artifact-details.tsx`, `developer-benchmarks.tsx`, `developer-task.tsx`, `investigation-panel.tsx`, `proof.tsx`, `recovery-task.tsx`, `remix-panel.tsx`, `static-content.tsx`, `transfer-context.tsx`. `format-current.txt` |
| 00:37 | `node --test --test-concurrency=1` on phase-budget, recovery-protocol, recovery-integration, recovery-campaign, recovery-recording, recovery-progress, recovery-investigation, recovery-evidence, recovery-context, accepted-delivery, fidelity, hosting | 48 tests, 48 pass, 21.8s, exit 0. `targeted-logic.txt` |
| 00:37 | same runner on video-media, video-candidate, mcp-server, muse-code-preflight | 22 tests, 21 pass, 1 fail, 2.0s, exit 1. `targeted-media-mcp.txt` |
| 00:37 | demo parsing name pattern `timeline\|fresh acceptance\|recording commands\|recorder source` | 4 tests, 2 pass, 2 fail, exit 1. `demo-parsing.txt` |
| 00:40:34–00:43:46 | `node --test --test-concurrency=1 --test-reporter=spec tests/*.test.mjs` | 293 tests, 277 pass, 16 fail, 0 skipped, `duration_ms` 192033.810792, exit 1. `npm-test.txt` |
| 00:45:15–00:46:13 | rerun of `investigation-web`, `jujump`, `lab-web`, `meta-roadster`, `release` only | 17 tests, 16 pass, 1 fail, `duration_ms` 57960, exit 1. `rerun-contaminated.txt` |

Nine of the sixteen full-suite failures were esbuild reading `package.json` while scripts were being inserted (`Expected "," in JSON` at `test:frontend`). `package.json` parses. Those nine passed on the rerun: one investigation view, one JUJUMP Chrome check, six lab-web checks, and the Roadster generation check. They are not current product failures.

## Residual failures from the f6cc282 suite

These were the residual failures of that baseline after the esbuild distinction. They are historical. The `a32f0e9` suite above did not reproduce this list; its one failure is the isolation publication assert.

| Class | Where | What the run showed |
| --- | --- | --- |
| Environmental | `tests/muse-code-preflight.test.mjs:27`, `mcp/preflight.mjs:101` | `Pinned Muse 1.3.0-R3401.1 is not executable at ~/.local/bin/muse-bin-1.3.0-R3401.1`. Present binaries are `~/.local/bin/muse` and `muse-bin-1.3.0-R3057.1`. Pin was not changed. |
| Environmental | `tests/hosting-isolation.test.mjs:25` | `docker build -f Dockerfile -t motion-transfer-verifier:local .` failed in 399ms: `Cannot connect to the Docker daemon` at `unix:///Users/richardliu/.docker/run/docker.sock`. `docker info` exit 1. No image was built. The compose-config test in `tests/hosting.test.mjs` passed without a daemon. |
| Environmental | `tests/demo-recording.test.mjs:126`, `demo/compose.mjs:34` | `ffmpeg failed: No such filter: 'drawtext'`. `/opt/homebrew/bin/ffmpeg` 8.1.2 has no `drawtext` filter and its configure line has no libfreetype. |
| Demo-owned, observed at suite time | `tests/demo-recording.test.mjs:29` and `:63`, then `demo/facts.mjs:76` | `Error: Phase budget ceiling is not $45`. On-disk `reports/motion-transfer-phase/phase-budget.json` (gitignored, birthtime `2026-11-02T23:59:48Z`) has definition `motion-transfer-additional-inference-v2`, `maxCostUsd` 50, `historicalSpendingIncluded` false, and 4 reservations. `facts.mjs` was edited after this failure and now records an on-disk ceiling separately from a v1 `$45` historical name. Demo tests were not rerun after that edit. |
| Demo-owned test bug, still present | `tests/demo-recording.test.mjs:155`, `demo/read-only-lab.mjs:13` | `assert.rejects(() => lab.submit(), /disables model creation/)` lets a synchronous `Error: Demo recording disables model creation` escape on Node v26.7.0. The message matches the regex; `assert.rejects` does not catch the throw. |
| Reproduced product/test failure | `tests/release.test.mjs:149` | `page.waitForURL` timed out at 30000ms after clicking `[data-parent]`. The href assertion had already passed (`../<parentId>/index.html`, generated in `release/materialize.mjs`). Same timeout on the full suite (31057ms) and the rerun (31040ms). |

## Chrome windows

QA held `/private/tmp/motion-transfer-cursor-next/qa-browser.lock` for the full suite (`2026-11-03T00:40:34Z`–`2026-11-03T00:43:46Z`) and the focused rerun (`2026-11-03T00:45:15Z`–`2026-11-03T00:46:13Z`). The lock file is gone. Chrome is free.

## Not run

`npm run test:frontend` was not a separate command. Those files are inside `tests/*.test.mjs` and ran in the full suite. Section 11 commands `verify:motion`, `verify:transfer`, `verify:jujump`, `verify:roadster`, `compare:transfers`, `export:jujump`, `verify:integration`, `verify:guided`, and `benchmark:verify` were not run as their own scripts. `benchmark:developer`, `recover:muse-code` paid mode, and `video:candidate` paid mode were not run.

Signing at the time of this baseline: `commit.gpgsign` is true and `gpg.format` is `ssh` in the user gitconfig. Repo hooks are samples only. No `--no-gpg-sign` bypass was found in project source. No commit was made.
