# Motion Transfer

Borrow a dash from a compiled game, play it on a 3D backflip, and keep the accepted result.

A July 2023 study for the Video Game History Foundation and the Software Preservation Network found that 87% of classic games released in the United States from 1960 through 2009 were not in release (n = 1,500, ±2.5% at 95% confidence; [87% Missing](https://gamehistory.org/87percent/)). Ars Technica, on May 6, 2020, reported that the volunteer whole-program decompilation of Super Mario 64 took about two years ([Beyond emulation](https://arstechnica.com/gaming/2020/05/beyond-emulation-the-massive-effort-to-reverse-engineer-n64-source-code/)). Motion Transfer recovers one dash from [Dashy Dango](targets/dashy-dango/README.md) and checks that controller on finite traces. That is not a whole-program decompilation. Sources are in [docs/problem-statement.md](docs/problem-statement.md). The project is aimed at **Push the Frontier**.

The repository stays private for now. Publication, deployment, outreach, a public video, and independent-use counts are pending. There is no public play URL.

## Play the accepted release

Node.js 22 or newer. These commands build and serve the accepted Roadster pin locally. They do not call Meta.

```sh
npm install
npm run build:release -- --accepted-roadster transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c
npm run serve:release -- --root reports/release-accepted --port 4174 --base-path /motion-transfer/
```

Open `http://127.0.0.1:4174/motion-transfer/`. The server binds `127.0.0.1` only. `serve:release` rejects `--host`. This address is local review, not a public site.

The page is one 3D backflip. The label is **ACCEPTED RECOVERY**. **Borrow dash** uses controller `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858`, the same component as the pinned JUJUMP publication. The Roadster pin passed 8 mapping checks and 8 browser checks. That component passed 13 development checks and 20 acceptance checks. The ordinary landing misses the green zone. The same controls plus the dash reach it. Borrowing and replaying make no model request.

Source, report, notices, and the download are files in the bundle. With WebGL2 removed, the page still offers the JUJUMP comparison, and that check passed. A human mapped the motion boundary, timer fields, and checks.

`npm run dev:transfer` is a different page. It opens `http://127.0.0.1:4173` on the older saved library and labels it **SAVED RECOVERY**, controller `1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2`. PAKU PAKU and JUJUMP on that server are the before/after views of that saved controller. They are not the accepted release.

## What was measured

These figures are outcomes of single runs. They are not a reliability rate. There is no ten-trial campaign and no Muse Code j/3 count. No independent user count is recorded.

| Result | Outcome |
| --- | --- |
| Accepted Roadster adapter | Muse Spark 1.3, `$0.008666`. 8 mapping and 8 browser checks on component `54465741…`. |
| Wonder donor trial | Muse Wonder 1.0, `$1.689036`. One donor acceptance. The campaign journal still has zero accepted deliveries. The pins above are the later publication of that component. |
| Contact-sheet comparison | One attempt. Contact sheet plus the supplied public-contract defaults: 0/40. Saved controller: 40/40. This is not a from-video score. Generation cost `$0.02293425`. Study `f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5`. |
| Fixed remix set | 6 supported prompts matched and 2 negatives behaved as specified. No retries. Cost `$0.06688125`. Those children use the older saved controller, not `54465741…`. |
| Contributor development | Trial 004 timed out. Its `$0.50` cap is retained in full as a second bounded-unknown reservation. No Contributor trial has an accepted development delivery. |
| Muse Code echo | Commit `982994a` pins build `1.3.0-R3057.1`. Thirteen unpaid echo checks passed. Paid Muse stays closed. |

A rough ledger snapshot from November 2, 2026: about `$1.99700237` known, about `$0.905351648` still reserved, ceiling `$50`. The public category, `$15`, is unused. Do not reset the ledger or invent a new allowance. Row-level history is in [docs/recovery-evidence-status.md](docs/recovery-evidence-status.md).

Experiments were authorized inside that ceiling. No further paid call is planned. Commands that spend still require the existing `reports/motion-transfer-phase/phase-budget.json` and do not create a replacement.

## Commands

Free commands make no Meta call.

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build:frontend
npm run test:frontend
npm run verify:motion
npm run verify:challenge
npm run build:creator
npm run score:video-comparison -- --campaign reports/motion-transfer-phase/video-001
```

`npm test` is `node --test --test-concurrency=1 tests/*.test.mjs`. `build:creator` writes `web/dist/creator/index.html`. `score:video-comparison` only scores an existing frozen study. It does not call Meta.

| Script | Use | Paid |
| --- | --- | --- |
| `build:release` | Static tree. Pass `--accepted-roadster <pin>` for the accepted bundle. Without that flag the tree is the saved library. | No |
| `serve:release` | `--root <directory> [--port 4173] [--base-path /]`. Loopback only. | No |
| `verify:release`, `smoke:hosted` | Audit or read-only smoke of an existing tree. | No |
| `dev:transfer` | Saved-library preview at `http://127.0.0.1:4173`. | No |
| `export:jujump`, `verify:integration` | Saved-controller JUJUMP package. Not the accepted pin. | No |
| `probe:integration` | One adapter against the saved controller. | No |
| `record:demo` | Existing local draft recorder. The submission video is being made separately. | No |
| `recover:muse-code` | Unpaid echo preflight. `--paid` stays refused. | No |
| `hosting:serve` | `node hosting/serve.mjs`. Needs `HOSTING_PUBLIC_HOSTS` and `HOSTING_PUBLIC_ORIGINS`. Creation stays off unless a later operator switch is set, and this build exits if that switch is present. | No |
| `hosting:broker`, `hosting:image`, `hosting:coordinator-image` | Local broker and image builds. Worker diagnosis is still open. | No |
| `transfer:accepted-roadster` | One new adapter for an accepted component. `--campaign`, `--out`, and `--phase-ledger` are required. | Yes, existing ledger |
| `video:candidate`, `remix:campaign`, `recover:campaign` | Campaign commands. Each requires the existing ledger. | Yes, existing ledger |
| `benchmark:developer`, `investigate`, `recover:motion` | Older paid entry points. `recover:motion --prepare-only` is local. | Yes, except prepare-only |

`hosting:serve` does not turn on public generation by itself. Hosted creation is not claimed verified. The provider budget and the worker check are still being finished. See [docs/hosting.md](docs/hosting.md).

## Where things stand

| | State | Detail |
| --- | --- | --- |
| Accepted local playback | Working on loopback | This page |
| Saved library preview | Separate, labeled saved | `npm run dev:transfer` |
| Wonder JUJUMP pin | Same component as the car pin | [docs/fresh-recovery.md](docs/fresh-recovery.md) |
| Contact-sheet score | 0/40 versus saved 40/40, one attempt | [docs/fidelity-media.md](docs/fidelity-media.md) |
| Fixed remix set | 8 outcomes, older component | [docs/remix-results.md](docs/remix-results.md) |
| Muse Code echo | 13 unpaid checks. Paid path closed | [docs/muse-code.md](docs/muse-code.md) |
| Hosted creation | Not verified | [docs/hosting.md](docs/hosting.md) |
| Public repo, deploy, outreach, public video, independent use | Pending | [docs/submission-readiness.md](docs/submission-readiness.md) |

## Limitations

- One dash, finite traces, human-mapped boundary. Host hooks are human-written.
- The accepted car and the saved library are different controllers. Do not describe the saved preview as the accepted release.
- The contact-sheet candidate is one attempt with the supplied defaults. It is not evidence that a model recovered the dash from video.
- The echo preflight does not recover a mechanic. A new cartridge still needs the human-mapped boundary.
- No outside developer session and no public player count.

## Credits

Dashy Dango is upstream work by samX500 and willGuimont. PAKU PAKU and JUJUMP are upstream work by Kenta Cho / ABA Games. The RDSTR Stunts car, renderer, track, stunt physics, and audio are upstream work by sebayaki. The recovery harness, controllers, adapters, green zone, remix flow, and checks are the hackathon work. The donor name came from a matcha parfait in Kyoto.

Longer notes: [developer handoff](docs/developer-handoff.md) · [implementation checklist](docs/motion-transfer-implementation.md) · [submission readiness](docs/submission-readiness.md) · [recovery evidence](docs/recovery-evidence-status.md).
