# Donor video and the fixed remix set

These commands prepare the from-video fidelity condition and the frozen Roadster remix campaign. They do not deploy, publish, or score a candidate against held-out traces.

Rendering is local. `ffmpeg` must be on `PATH`. The pinned Dashy Dango cartridge is replayed through `runtime/replay.mjs`, and each stored picture is the actual framebuffer from `framebufferPng` plus a banner. The banner is a four-digit logical frame counter and lamps for X, Z, left, right, up, and down. Probe frames are repeated 8 times at 8 fps, so each logical tick stays on screen for one second and the eight-tick dash is visible. The candidate clip repeats each tick 4 times at 8 fps. A numbered contact sheet of those still frames is written beside the videos and is labeled image input.

```sh
node scripts/fidelity-media.mjs --out reports/fidelity-media
```

No API key is read. The manifest's frame observations are local audit data and must not be pasted into a prompt.

## From-video candidate

```sh
node scripts/video-candidate.mjs --out reports/video-candidate --phase-ledger reports/motion-transfer-phase
```

This is a paid command. It reuses the existing additional-spend ledger at `reports/motion-transfer-phase/phase-budget.json` and will not create a replacement ledger. Muse Spark 1.3 Standard receives one sampling probe as an inline `input_video` data URL, then one candidate request. The probe cap is $0.40 and the candidate cap is $1.50, both inside the video category's $2 allocation. The reservation is written before the token-count call. Usage is settled exactly. A transport failure keeps the reservation uncertain and does not retry.

The candidate prompt discloses the `init`/`step` ABI, `sourceBodyWidth` 8, the gamepad bits, and the public-contract defaults (`walkingSpeed` 2, `dashDistance` 60, `cooldownTicks` 25, `initialCooldownTicks` 10). Those four numbers are supplied. They are not recovered from the pixels. The prompt does not include the saved component source, donor source, or acceptance traces. Public messages and tool calls are kept. Reasoning items are not.

If the probe's public answer misses the frame counter or the player sprite, the candidate request uses the contact sheet. That request is explicitly image input. Its fidelity condition is `contact-sheet` plus the same supplied public-contract defaults. A localized probe uses condition `video` plus those supplied defaults. `provenance.json` records that label beside the study. A config that changes the supplied defaults is retained and rejected with no second call.

Accepted source is frozen in one study with the existing immutable saved recovery (`components/dashy-dango-dash/component.ts` and `contract.json`) before the study seed is written. The saved candidate's condition is `saved-recovery`. It is the existing component, included for comparison. The saved source is read only while freezing that study, after the provider response, and is never copied into the provider prompt. This command does not score the study and does not repair either candidate from held-out output.

Score a finished campaign with `node scripts/score-video-comparison.mjs --campaign <directory>`. That command calls `scoreFidelityStudy` once on the frozen pair, reuses a complete `results.json` without rewriting it, and writes `fidelity-comparison.svg` plus `fidelity-comparison.json`. It does not call Meta, repair source, or change the seed. The scored contact-sheet comparison is pinned under `benchmark/fidelity-recordings/`, and `docs/fidelity-results.md` states its 0/40 and 40/40 counts.

## Fixed remix campaign

```sh
node scripts/remix-campaign.mjs --out reports/remix-campaign --phase-ledger reports/motion-transfer-phase
```

This is a paid command on the same shared ledger, category `remix` ($5). It starts from the saved forward, held, 0.1-scale Roadster parent and calls `generateRoadsterTransfer` at its existing $0.05 ceiling. Source, conformance, and browser checks stay inside that function. The campaign then requires the full intent and the parent id. A completed response with a different intent is stored under `<out>/unpublished/<prompt>/` and is not published.

A matched result is published with `createLabStore` at `<out>/published`. The artifact contains `adapter.ts`, `adapter.js`, `frame.html`, `notices.txt`, `verification.json`, and `generation.json`. `readRoadsterArtifact` checks the manifest identity before the child id is recorded. The 3 meter follow-up and a later resume load that published artifact, so the parent id is the manifest id. Flight, no-op, and mismatched results are not published. The lab store is closed when the runner finishes.

| Prompt | Expected intent |
| --- | --- |
| Half as long, forward, held | 0.05, held, facing |
| Backward, same distance, held | 0.1, held, opposite |
| Fresh press, same distance, forward | 0.1, press, facing |
| Backward and fresh press | 0.1, press, opposite |
| Follow that child, distance only, exactly 3 meters | 0.05, press, opposite |
| Exactly 9 meters, forward, held | 0.15, held, facing |
| One dash per flight, restored on landing | unsupported, no child |
| Keep the dash the same | no-op, no child |

The 3 meter prompt is sent the published backward/fresh-press artifact, including its adapter, frame, and both retained rules. Each attempt keeps its prompt, parent id, parent intent, latency, outcome, and settled cost. A started prompt is not sent again. Uncertain billing stops the rest of the set.

Suggested root scripts, to be added by the owner of `package.json`:

```json
"render:fidelity-media": "node scripts/fidelity-media.mjs",
"video:candidate": "node scripts/video-candidate.mjs",
"remix:campaign": "node scripts/remix-campaign.mjs",
"score:video-comparison": "node scripts/score-video-comparison.mjs"
```

No new package dependency is required. Do not run the two paid commands until the shared ledger and the request text have been reviewed.
