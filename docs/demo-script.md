# Three-minute demo script

Record this from the local preview. The edit is three minutes. Several source clips are longer than their slots because each saved landing is about 13 seconds of game time. Cut to the result line. Play any full landing you keep at normal speed, and leave a caption that the wait was not shortened.

This cut uses **saved** playback. It does not show a fresh recovery, a fresh remix generation, a public URL, or a phone. Those fallbacks are at the end.

The automated cut is `node scripts/record-demo.mjs`. It writes ignored `reports/demo/draft.mp4`, `reports/demo/draft.srt`, and `reports/demo/provenance.json`. `capture` and `render` stay separate so a later local acceptance clip can replace the investigation segment without reshooting. This pass does not pass `--fresh-acceptance`.

## What the viewer is seeing

| On screen | Who made it |
| --- | --- |
| Dashy Dango, the WASM-4 cartridge | Upstream, samX500 and willGuimont. Notice: `targets/dashy-dango/NOTICE.txt`. |
| PAKU PAKU and JUJUMP | Upstream, Kenta Cho / ABA Games. MIT pins in `recipients/`. |
| RDSTR Stunts car, renderer, track, stunt physics, audio | Upstream, sebayaki. The kickflip “TOO SHORT” card belongs to that game’s other stunt. This demo uses the backflip green zone, challenge id `backflip-landing-v1`. |
| Saved dash controller, adapters, green-zone challenge, remix form, investigation journal, checks | Hackathon work in this repository. |

Burn a corner label into every shot: `UPSTREAM` or `HACKATHON`, and `SAVED — NO NEW MODEL REQUEST` on every playback shot. The app does not draw those labels.

## Recorder setup

From the repository root, with Node.js 22 or newer and Google Chrome (WebGL on). One server is enough. Leave it running.

```sh
npm install
npm run dev:transfer
```

Open `http://127.0.0.1:4173`. Wait until the status pill reads `VERIFIED TRANSFER` and the line `Preparing the saved challenge…` is gone. If the destination buttons do not include `RDSTR STUNTS`, the browser has no WebGL and this script cannot be shot.

Useful URLs on that same server:

| Shot | URL |
| --- | --- |
| Challenge, saved parent transfer | `http://127.0.0.1:4173/` |
| Donor cartridge | `http://127.0.0.1:4173/donor/play` |
| PAKU PAKU before/after | `http://127.0.0.1:4173/?destination=paku-paku` |
| JUJUMP saved transfer | `http://127.0.0.1:4173/?destination=jujump` |
| Saved local 3 m backward remix | `http://127.0.0.1:4173/roadster/play/f67245c401fc82cfd516d6e333fe67dad2acfd232ca7607baea6a6d05d912fbf` |

The playable remix bytes are the committed evidence file named in `docs/demo-recording.md`, not `reports/lab/`. Capture checks that file’s identity, writes a playback copy under `reports/demo/playback-artifacts/`, and opens it on the recording server. It is a child of committed Roadster id `6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38` (`transfers/roadster/current.json`). Its summary is a press-activation, opposite-direction dash at unit scale 0.05. Do not press `Adapt with Meta` or `Remix with Meta`. If the evidence file is missing, record the form and label it `FORM ONLY`.

`npm run dev` on port 4444 is the donor alone. Prefer `/donor/play` on the preview server so the recording stays on one origin.

Window: Chrome, about 1280×800, bookmarks bar hidden. Click a game canvas before sending keys. Donor keys are arrows and X. PAKU and JUJUMP use Space to turn or jump, and D to dash after the transfer. The car challenge uses the on-screen buttons; X dashes only after `Borrow dash`.

## Capture list

Record these as separate clips. Wall-clock lengths are recording time, not the edited slot.

| Clip | Do this | Stop when | Label |
| --- | --- | --- | --- |
| A. Original landing | On `/`, click `Watch original`. | `#challenge-result` reads `Outside the zone. Try a different dash timing.` Hold 2 seconds. | `SAVED PLAYBACK` |
| B. Borrowed landing | Click `Watch borrowed dash`. | The result reads `Landed in the zone!` Hold 2 seconds. | `SAVED PLAYBACK` |
| C. Donor | Open `/donor/play`, click the canvas, start with X, dash with X. | One visible dash, about 6 seconds. | `UPSTREAM` |
| D. Same controller, pixel game | Open `/?destination=paku-paku`. Hold D on the transferred side. | One dash, about 6 seconds. | `UPSTREAM GAME` plus `HACKATHON ADAPTER` |
| E. Saved investigation | On `/`, open `Explore the recovery, source and verification`. Click `View recorded investigation · no model call`. | The neutral-after-left conclusion is readable, about 20 seconds. | `SAVED INVESTIGATION` |
| F. Landing numbers | Back on the challenge, open `See the matched-input evidence`. | Both landing coordinates are readable. | `SAVED MEASUREMENT` |
| G. Second engine | Open `/?destination=jujump` and jump once with Space, then dash with D. | About 10 seconds. | `UPSTREAM GAME` plus `HACKATHON ADAPTER` |
| H. Saved remix | Open the local remix URL above. Read the mapping line. Press `Launch car` only if the challenge is idle. | About 12 seconds. The button must stay `Press to dash`, which marks the fresh-press child. | `SAVED LOCAL REMIX` |
| I. Credits | Scroll to the footer. | The three upstream names and the notices links are readable. | `CREDITS` |

If clip H 404s, record the remix form at `#remix-heading` without submitting. Caption that take `FORM ONLY`.

## Edited timeline

| Time | Picture and action | Burned-in caption |
| --- | --- | --- |
| 0:00–0:12 | Hard cut from clip A’s result line to clip B’s result line. No title card first. | `Same recorded stunt. The second landing adds a dash recovered from another game’s compiled cartridge.` Corner: `UPSTREAM: RDSTR Stunts by sebayaki` and `HACKATHON: green zone`. `SAVED PLAYBACK`. |
| 0:12–0:32 | Clip C, then the page’s `SAVED RECOVERY` card (`Borrow the dash`), then clip D. | `One saved controller, replayed in a pixel game and in the car.` |
| 0:32–1:05 | Clip E. Keep the button text `View recorded investigation · no model call` in frame, then the saved conclusion. | `Saved Muse Spark investigation. The view button makes no model call. The host mapped the boundary, state, and checks. The neutral-after-left conclusion stays a saved model interpretation.` |
| 1:05–1:25 | Clip F, full screen on the two coordinates. | `Saved matched inputs. Native landing −49.47 m, outside the zone from −42.3 m to −40.4 m. The same controls plus this dash land at −41.38 m. The dash is 6 m across 8 updates; the landing shift is about 8.09 m because native motion moves too. By-feel and video scores are not in this cut.` |
| 1:25–1:48 | Clip G. Point at `JUJUMP` and the shared component id prefix if the destination chip is visible. | `Author-built adapter on Kenta Cho’s JUJUMP. Same frozen component. This is not an outside developer’s session.` |
| 1:48–2:08 | Clip H, or the unsubmitted form. | `Saved local remix: backward, fresh press, 3 m. Committed child. Playback sends no new request.` |
| 2:08–2:38 | Editor card, spoken or on screen, using only the figures in the results block below. | `One behavior, finite traces, saved recovery. The campaign did not accept a new component.` |
| 2:38–3:00 | Clip I, then a closing card with the local command. | `Hackathon work: recovery harness, saved dash, adapters, green-zone challenge, remix flow, and checks. Dashy Dango, PAKU PAKU, JUJUMP, and RDSTR Stunts are upstream. Run npm run dev:transfer and open http://127.0.0.1:4173.` |

Exact positions asserted by the challenge test: baseline x `-49.46847388339292`, transferred x `-41.37543628862018`, 766 control frames, dash at tick 636, eight active updates summing to 6. The UI prints two decimal places. Both landings are graded `perfect` by the upstream touchdown grader; the challenge result is the green zone, so the original run still shows `Outside the zone`.

## Results card, 2:08–2:38

Use these lines and no others. Leave a blank line where a count does not exist.

- Saved component `1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2`. Muse Wonder 1.0 generated it; Muse Spark 1.3 repaired it. Estimated generation cost `$0.28511425` across three historical requests. Finite checks: 12 development, 21 regression, 20 acceptance traces; 6,744 ticks; maximum position error 0 at tolerance 0.25 source pixels. Source: `components/dashy-dango-dash/README.md`.
- November 2 developer campaign `eb9ac874-30ad-4a0b-9bcc-78f8c25f539a`: 2 of 3 tasks completed, estimated `$0.7299162`, reservations settled. The recovery task submitted no candidate. Source: `benchmark/recordings/README.md`. The root README rounds the same campaign to `$0.7299` and reports two later development trials at `$0.640187`, one reaching 10 of 13 development checks. Neither passed acceptance.
- Phase budget: do not recreate a journal. The missing historical v1 ledger is not quoted. If a different ledger is on disk, the card says it is not quoted and gives no ceiling or reservation. Say that this is not an acceptance and not a finished ten-trial rate.
- `docs/fresh-recovery.md` describes a historical Wonder trial. Its raw campaign files are not in this checkout, so do not label that prose as a verified fresh acceptance.
- Public player counts, independent users, a fidelity chart, a Muse Code clean-room rate, and a hosted link: omit. They are not evidenced in this cut.

## Fallbacks

**Fresh recovery, use only with a new artifact.** If a later run accepts a component and writes that acceptance next to a local recording, render again with `--fresh-acceptance`. The file has to say `"accepted": true` and name the trial, the harness (`in-app` or `muse-code`), the component id, and a local clip. A public URL, phone, user count, or rate field is rejected. Until that file exists, keep the saved investigation. `docs/fresh-recovery.md` is not that file. Do not restage a live model call for the video.

**Fresh remix.** A new `Adapt with Meta` or `Remix with Meta` submission is a paid call. This script does not include one. If a later approved run produces a new child, replace clip H with that child and caption `FRESH REMIX` plus its artifact id. If clip H is missing, show the form and caption `FORM ONLY — NO GENERATION IN THIS TAKE`.

**In-app agent only.** This cut has no Muse Code session. Do not title the investigation shot as Muse Code.

**Public and phone shots.** Skip them until a public playback URL answers on another network. The closing card stays on `npm run dev:transfer`.

## Checks the recorder can repeat

```sh
node --test --test-concurrency=1 --test-name-pattern="exact native input trace" tests/roadster-challenge.test.mjs
```

That command checks the saved zone geometry and does not call Meta. The browser half of `tests/roadster-challenge.test.mjs` writes `reports/roadster-challenge.png`; this script does not ask the recorder to run it during the take.
