# Contact-sheet fidelity comparison

Study `f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5`. Muse Spark 1.3 answered two requests. The probe settled at `$0.00597225`. The candidate settled at `$0.016962`. The journal total is `$0.022934250000000003`.

The probe's reported sprite box did not overlap a recorded player box, so the candidate used the numbered contact sheet instead of the video. With the supplied public-contract defaults, that candidate passed 0/40 traces. Its maximum position error is 271.0249570072505 source pixels. The saved recovery passed 40/40 with maximum position error 0. Those defaults are `walkingSpeed` 2, `dashDistance` 60, `cooldownTicks` 25, and `initialCooldownTicks` 10. They were supplied, not recovered from the pixels.

This directory does not contain a from-video candidate, a by-feel baseline, or a reliability rate. `recording.json` maps every copied file to its original path, size, and SHA-256. The phase ledger, credentials, and private reasoning are not included.

The study layout matches the campaign directory. To recheck the pinned results without changing them, copy this directory and run the scorer on the copy. A complete `fidelity-study/results.json` is validated and reused.

```sh
tmp=$(mktemp -d)
cp -R benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5 "$tmp/campaign"
node scripts/score-video-comparison.mjs --campaign "$tmp/campaign"
rm -rf "$tmp"
```

Do not delete or replace `fidelity-study/results.json` in this recording.
