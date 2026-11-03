# Fidelity results

The scored contact-sheet comparison is tracked at `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/`. `recording.json` there maps each file to the original `reports/motion-transfer-phase/video-001` path and its SHA-256. Those report files stay local and untracked. The pinned copies are the files a clean clone can inspect.

The comparison passed **0/40** traces for the contact sheet plus the supplied defaults, and **40/40** for the saved recovery. Maximum position error is 271.0249570072505 source pixels and 0. The probe settled at `$0.00597225` and the candidate at `$0.016962`.

```sh
node scripts/score-video-comparison.mjs --campaign assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5
```

Run that command on a temporary copy, as the recording README describes. The pinned `fidelity-study/results.json` is already complete. The scorer checks it and does not rewrite it. It does not call Meta, repair either candidate, or change the frozen seed.

Suggested root script, to be added by the owner of `package.json`:

```json
"score:video-comparison": "node scripts/score-video-comparison.mjs"
```

## What was measured

The frozen study has 40 traces, seed `3717589184`. A trace passes when position stays within 0.25 source pixels and ownership and output events match exactly. Internal timers are not scored. The result is this finite donor comparison. It is not recovery acceptance and not a productivity estimate.

The probe's sprite box did not overlap a recorded player box, so the candidate request was the numbered contact sheet. The observed label is contact sheet plus the supplied defaults: `walkingSpeed` 2, `dashDistance` 60, `cooldownTicks` 25, and `initialCooldownTicks` 10. Those four numbers were supplied, not recovered from the pixels. The other row is the saved recovery.

There is no from-video candidate, no by-feel baseline, and no external-developer baseline in this comparison. The two settled requests are not a reliability rate.

## Tracked artifacts

- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/README.md`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/recording.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/journal.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/provenance.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-comparison.svg`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-comparison.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/study.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/results.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/from-contact-sheet.ts`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/from-contact-sheet.config.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/saved-recovery.ts`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/saved-recovery.config.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/media/manifest.json`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/media/probe.mp4`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/media/candidate.mp4`
- `assets/benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/media/contact-sheet.png`
