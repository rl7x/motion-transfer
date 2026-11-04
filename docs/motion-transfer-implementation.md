# Motion Transfer implementation checklist

> **Historical.** This records the project as it stood earlier in the hackathon, and some of it is out of date. For the current state, see the [README](../README.md).

The summary a new developer should read is the root README. This page only separates what is present from what is still pending. It assigns no score. Ledger rows stay in [recovery-evidence-status.md](recovery-evidence-status.md).

Publication, deployment, outreach, a public video, and independent-use sessions are pending by direction. Paid commands require the existing `$50` ledger. No further paid call is planned. Do not reset the ledger.

## Present

- Accepted local playback: `npm run build:release -- --accepted-roadster assets/transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c`, then `npm run serve:release -- --root reports/release-accepted --port 4174 --base-path /motion-transfer/`. Loopback only. Component `54465741…`, 8 mapping and 8 browser checks, 13 development and 20 acceptance checks, same component as the JUJUMP pin. Source and evidence links are in the bundle. The WebGL2-absent comparison link was tested.
- `npm run dev:transfer` remains the saved library, labeled **SAVED RECOVERY**, controller `1bc4250c…`.
- Wonder publication pin, commit `14ff60d`. Accepted Roadster delivery and pin, commits `cdd0ded` and `7096529`. Portable release and loopback serve, commit `5065a7c`. Capture inputs, commits `49b6b4a` and `eaff839`.
- Fidelity study recorded in `1429e62` and scored once: contact-sheet plus supplied defaults 0/40, saved controller 40/40, one attempt, cost `$0.02293425`. Not a from-video score.
- Fixed remix set, commit `5db79cc`: 6 supported matches and 2 correct negatives, no retries, `$0.06688125`, older saved component.
- Muse echo, commit `982994a`: 13 unpaid checks on pin `1.3.0-R3057.1`. Paid Muse stays closed.
- Creator page, commit `0251bb0`: `npm run build:creator` writes `web/dist/creator/index.html`. Six browser tests passed on a fixture API. `hosting:serve` does not enable generation by itself.
- Donor ISC notice: [assets/targets/dashy-dango/README.md](../assets/targets/dashy-dango/README.md).

## Pending

- Public repository, deploy, outreach, public video, and independent use.
- Hosted creation. The coordinator still refuses the operator generation switch, and the worker diagnostic is unfinished. Do not treat hosting as verified.
- A ten-trial campaign, an accepted Contributor development delivery, and a Muse Code recovery. None of those results exist.
- Binding nothing further is required for the local accepted page. The car pin and the JUJUMP pin already share `54465741…`.

`record:demo` remains available for a local draft. It is not the submission video.
