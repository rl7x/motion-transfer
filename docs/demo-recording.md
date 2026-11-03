# Demo recording

This prepares a local three-minute captioned video. It does not deploy, upload, post, or call a paid model.

The recording server is `createPreviewServer` with a read-only Roadster reader. Remix and investigation creation stay disabled. The script does not load `.env` and does not run `scripts/preview.mjs`.

## Requirements

Node.js 22 or newer, Google Chrome, the repo's existing Playwright dependency, and `ffmpeg` on `PATH`. No new package is required.

Suggested scripts for the orchestrator to add. This change does not edit `package.json`:

```sh
"record:demo": "node scripts/record-demo.mjs"
"record:demo:capture": "node scripts/record-demo.mjs capture"
"record:demo:render": "node scripts/record-demo.mjs render"
```

## Run

From the repository root:

```sh
node scripts/record-demo.mjs
```

`capture` records the browser shots and writes `reports/demo/capture.json`. `render` edits those shots into the final files. The default mode does both. Render can be repeated without opening the app again.

```sh
node scripts/record-demo.mjs capture
node scripts/record-demo.mjs render
node scripts/record-demo.mjs render --fresh-acceptance reports/demo/fresh-acceptance.json
```

`--headed` forces a visible Chrome window. Capture already retries once in a visible window if the headless window has no Roadster challenge.

Outputs, all under ignored `reports/demo/`:

- `motion-transfer-demo.mp4` — 1280×720, 30 fps, H.264, `yuv420p`, 180 seconds, no audio
- `motion-transfer-demo.srt` — standalone captions
- `provenance.json` — shot paths, artifact ids, local URLs, ffmpeg version, commands, and checks
- `clips/`, `segments/`, `stills/`, and `cards/` — intermediate files

## What the default cut shows

Saved playback only, in this order: the ordinary landing misses the green zone, the same controls plus the saved dash reach it, the Dashy Dango cartridge, the saved-recovery card, PAKU PAKU, the saved neutral-after-left investigation, the matched landing coordinates, JUJUMP, one saved local remix or the remix form, a finite-trace results card, and the credits.

Corner labels distinguish upstream games from hackathon work. Lower thirds stay to one or two lines. Gameplay is not sped up. `provenance.json` records each shot's wall-clock time when rendering is slower than the game.

The November 2 campaign and the later development trials stay labeled as historical. The neutral-after-left conclusion stays a saved model interpretation. The cut does not claim a public URL, a phone, external users, a fidelity chart, or a Muse Code session.

## Substituting a later acceptance

Render keeps the saved investigation until a file is passed explicitly. That file has to say `"accepted": true` and point at a local recording. It also names the trial, the harness (`in-app` or `muse-code`), and the component id. A `publicUrl`, phone, user count, or rate field is rejected. Missing clips are rejected. The historical campaign sentences stay in the results card.

## Checks

```sh
node --test --test-concurrency=1 tests/demo-recording.test.mjs
```

The browser recording itself is one Chrome at a time. Do not run it beside another browser test.
