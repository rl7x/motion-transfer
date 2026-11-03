# PARALLAXIA live mechanics: measured results

Measured November 3, 2026 on `feat/parallaxia-live-mechanics`, code commit `bf7cd147fa59de535bbca44312b0b9f31fafdecc`. The ten-task definition was frozen before any campaign request in [the manifest](../src/benchmark/live-mechanics-tasks.json), SHA-256 `12cec5a9dc87845f67ca1585a2d95a7db842a08bf2adfc60c8be33d3ecb93a77`.

**Eight of nine positive tasks passed; the one deliberately infeasible task was correctly unsuccessful.** This selected, tool-driven set is neither a human study nor a general reliability estimate. The left goal remains a failed positive task. No failed task was removed or rerun for a better headline.

## Individual measurements

Task wall time includes the task's assertions; job wall time runs from admission through its terminal verification/publication state. For the six passing generated jobs, the first candidate was also the first playable result. The two unsuccessful jobs include both candidates, verification and repair. JUJUMP playback/export and restart/replay use saved bytes and make no provider request.

| Frozen task | Outcome | Responses | Job wall (s) | Task wall (s) | Estimated inference USD |
| --- | --- | ---: | ---: | ---: | ---: |
| Fresh-press transfer | Passed | 1 | 11.413 | 11.460 | $0.00773850 |
| Backward/fresh-press edit | Passed | 1 | 12.052 | 12.086 | $0.00755700 |
| Distance-only follow-up | Passed | 1 | 11.771 | 11.809 | $0.00783350 |
| Same-component JUJUMP clean export | Passed | 0 | — | 1.281 | $0.00000000 |
| Fixed right goal | Passed | 1 | 18.604 | 18.644 | $0.01096075 |
| Fixed left goal | Failed: lost a life | 2 | 30.816 | 30.845 | $0.02135750 |
| Out-of-bounds goal | Correct rejection | 2 | 25.146 | 25.180 | $0.01846125 |
| Add dash-end native shot | Passed | 1 | 7.889 | 7.921 | $0.00827400 |
| Remove rule, preserve mapping | Passed | 1 | 9.664 | 9.692 | $0.00789850 |
| Restart, reconnect and exact replay | Passed | 0 | — | 5.383 | $0.00000000 |

Eight jobs used ten real Muse Spark 1.3 responses, estimated **$0.09008100** total. Each whole job stayed below $0.15, including its repair. The left goal and infeasible goal each used two candidates and remained unsuccessful. There was **no observed repair benefit in this frozen run**. A separate development composition-removal job did repair an invalid rule module into a passing removal; that is a development trajectory, not another benchmark success.

The campaign ran from 15:45:34.653Z to 15:47:52.821Z. Raw definition, requests, actual responses, attempts, stage timings, worker results, ledger hashes and immutable publications remain in gitignored `reports/live-mechanics/frozen-tasks-v1/`. A compact derived table is in `reports/live-mechanics/frozen-task-measurements.json`. The original failed development trials remain separate; see [the implementation record](live-mechanics-progress.md).

## What the experiment establishes

The curated checkpoint is seed 7, normal mode, sector 1, tick 40, reconstructed from forty native-zero updates. The parent and child start with digest `bbae0d931dec267d9b3f969b6d78b31fc853d474ae28b1f02fdbe22c9d805059`. Both receive native Shoot for the next 120 updates and no native directional input.

The right target was fixed at X 5.5–6.5, Y −11–−7. The original never entered it and lost no life. The generated candidate preserved the held/facing/0.1 mapping and proposed dash intervention tick 112. Its first movement difference occurred at tick 113; it reached X 6, Y −8 at tick 120 without losing a life. The browser and restricted worker reproduced the same final digests for both branches.

The left target was fixed at X −6.5–−5.5 with the same Y range and constraints. Both generated candidates proposed intervention tick 1. The final candidate entered the region at tick 9 but lost a life before the horizon ended. The worker retained this as unsuccessful. Reaching the position alone was insufficient.

The deliberately infeasible target stayed at X 100–101, outside the native playfield. Neither candidate changed it or disabled collisions. The final candidate never reached it and lost a life; the original remained available. No general beatability or permanent survival claim follows from any two-second replay.

Native swept bullet checks remain active during the dash; native enemy body collision rules are retained. The upstream body-contact test samples positions at 60 Hz rather than using a continuous enemy sweep. Practice is separately labeled and shielded, and supplies no survival evidence.

## Artifact identities and release

The accepted recovered component is `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858` throughout PARALLAXIA generation, browser playback, export and the accepted JUJUMP comparison. The component is reused unchanged. Meta generates adapters and a bounded declarative rule. Human-written hooks supply the recipient boundary, deterministic replay, verification and rule scheduler; PARALLAXIA and JUJUMP are licensed upstream games, not games reconstructed here.

| Role | Immutable artifact |
| --- | --- |
| Baseline reuse | `d2c3b5898ad25ccabc014e2d5fe4999f5bac10edbcfc3661d79f276a423bf349` |
| Fresh transfer | `d6cff5512fc7190377579f51e0958c7e1e0bd00f94e3ebd7c8e436791eb7aad4` |
| Backward edit | `0bb5994e21a19f365e877b786443cfd540286948d75961ea5a59345a91717616` |
| Half-distance child | `f325679d9cd9012b78a022878777a34d7f829a158ca91fe0adb7e377e9d38e68` |
| Successful right experiment | `07c2211ed729b557330f669c93808cf62384274fdf0c7cdc6078e2fe0d02755b` |
| Failed left experiment | `e037b4b4eea8fd4e38483b8561c533276e2666ae3245bf9ef335319e80994b1f` |
| Infeasible diagnostic | `5c1609dae3e5eb9a58c913b05e996c4a6e1f4881c40cfdfa910ce3f43b1ae49b` |
| Composition enabled | `a9659224ca957060cfc4ecad78363ca73b51e6277a5e346530f020dc806931c9` |
| Composition removed | `ba4c7c4f7bec361edef128e29f75875e7a70052d069e86f20f16e375e131337f` |

The final local release in `reports/release-parallaxia/` passed the cold-start, exact paired ZIP replay, nested route, baseline reload/back and unsuccessful-diagnostic checks. It features the successful right experiment, includes all eight generated publications and the baseline, and labels both unsuccessful experiments. The exact parent, child, adapter, optional rule, recovered component, notices, checkpoint, future inputs and observed outcomes are available in the ZIP. Experiment ZIPs add a self-contained React `replay.html`. Historical Roadster frame bytes and URLs remain unchanged.

Rebuild this measured release from the retained workspace evidence without inference:

```sh
npm run build:release -- --recipient parallaxia --live-directory reports/live-mechanics/frozen-tasks-v1/live --artifact 07c2211ed729b557330f669c93808cf62384274fdf0c7cdc6078e2fe0d02755b --task-evidence reports/live-mechanics/frozen-tasks-v1/results.json
npm run serve:release -- --root reports/release-parallaxia --port 4174 --base-path /motion-transfer/
```

These paths are local gitignored evidence, not files automatically present in a fresh clone. The distributable release tree is self-contained. A baseline-only build is an explicit `--reuse-baseline` mode and is labeled reuse; it does not reproduce the paid task campaign.

## Later UI and cap changes

After this frozen run, Richard requested removing the persistent age/privacy/model banner and raising the default whole-job cap from $0.15 to $7, including repair. The banner is gone; age confirmation now appears only on a new creation. The backend reserves $7 from the existing $10 reserve bucket because the unchanged remix bucket is $5. The overall allowance stays $50, and previous reservations retain their original bounds. No new paid request was made to validate this cap change; temporary fixtures and browser checks cover admission, settlement, uncertain bounds, cancellation and reconnect. The frozen v1 manifest and its runner retain the original explicit $0.15 envelope for that historical measurement.

## Spending and limits

The restored ledger's sixteen reservations, including the four originally in this checkout, were reconciled before inference. Both histories are preserved in `reports/handoff-reconciliation/20261103T142557Z/`. No allowance migration was repeated.

After development and the frozen run, the existing $50 ledger contains 31 reservations: $2.16501937 estimated usage, $1.045174398 retained reservations, and $46.789806232 remaining. Three bounded-unknown reservations remain. The failed first experiment retains its full $0.15 envelope, with $0.01017725 known estimated usage inside that envelope. These are local ledger figures, not a verified provider balance and not a claim to include all historical CLI spending. New estimated usage during this implementation is $0.16801700. Ledger SHA-256: `1934f39c37ede0c05a4cadf1348e280926151fd5a0372d2a23c23caa21b51d3d`.

Live creation requires configured Standard Meta credentials, the existing reconciled ledger and restricted Docker workers. Playback, restart/reconnection, export and comparisons of saved versions require no inference. Supported edits are distance scale, facing/opposite direction, held/fresh-press activation, and the single next-tick dash-end native-shot rule. Checkpoints are bounded to 3,600 historical updates and experiments to 120 future updates; edits must warm to the same starting state. There is no arbitrary mid-dash state migration, level solver, natural-language goal editor, second live recipient, graze-token rule, or second recovery campaign.

Public hosting, repository visibility, outside-network checks, adoption studies, video and submission remain separate. No public URL or outside-user benefit is claimed. See [local validation](local-validation.md) for actual test results.
