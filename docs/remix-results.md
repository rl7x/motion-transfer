# Fixed remix set

Campaign `c1655c4c-221d-487f-b05f-c1d667c05b39` finished with status `complete`. The source run is `reports/motion-transfer-phase/remix-001`. The tracked copy is `assets/benchmark/remix-recordings/c1655c4c-221d-487f-b05f-c1d667c05b39/`. This is one fixed request set on `muse-spark-1.3`: six supported prompts and two negatives. It is not a rate of adoption, reliability, or productivity.

The journal integrity hash matches the campaign body. The definition hash is `ea1d57a3109940146edebb89f827c4857400b3644554212deaf3a39d351635e6`, and its prompts match `REMIX_PROMPTS`. Provider retries are false. Each attempt records `maxCostUsd` 0.05. All eight requests have status `completed` and `reservedCostUsd` 0. No attempt is `interrupted` or `blocked`.

The eight recorded costs sum to $0.06688125. The journal summary field stores that sum as `0.06688124999999999`. Total latency is 175317 ms.

| Prompt | Kind | Stored outcome | Intent | USD | ms |
| --- | --- | --- | --- | ---: | ---: |
| half-distance | supported | matched | held, facing, 0.05 | 0.00800975 | 22080 |
| backward | supported | matched | held, opposite, 0.1 | 0.0084675 | 23368 |
| fresh-press | supported | matched | press, facing, 0.1 | 0.0089715 | 26211 |
| backward-fresh-press | supported | matched | press, opposite, 0.1 | 0.00813 | 27832 |
| three-meter-followup | supported | matched | press, opposite, 0.05 | 0.00778125 | 24078 |
| nine-meter | supported | matched | held, facing, 0.15 | 0.008161 | 28058 |
| flight | unsupported | expected-unsupported | no child | 0.0082525 | 12226 |
| noop | noop | expected-noop | no child | 0.00910775 | 11464 |

Stored outcomes were kept. Independent checks found 0 mismatches. There is no `unpublished/` directory.

## Parent chain

The base parent is `6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38` at `assets/transfers/roadster/versions/6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38`. `readRoadsterArtifact` accepted it. Its intent is held, facing, 0.1. Its component is `1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2`.

Five supported prompts bind that base id. `backward-fresh-press` published `4704a93ba3eb977448fd15a6393034cd3623cba9fdd28e050a5d3406ce437d0c` with parent `6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38`. `three-meter-followup` published `beb299c5dbc82b3f40e460680727f278425dfed889d4698a0a24f6b796af5383` with parent `4704a93ba3eb977448fd15a6393034cd3623cba9fdd28e050a5d3406ce437d0c`. The follow-up's parent adapter SHA-256 matches that published parent. Every matched child uses the same component id.

| Prompt | Parent | Child | Frame |
| --- | --- | --- | --- |
| half-distance | 6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38 | 6ad240e07ce5cd0af4be0788548c52ceb8f8b8a9251d719ae02b218a4ea33ebe | published/artifacts/6ad240e07ce5cd0af4be0788548c52ceb8f8b8a9251d719ae02b218a4ea33ebe/frame.html |
| backward | 6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38 | 329e0778f19eca92d459f26f17d2beec2e83530d833a332097b546ef901fc01c | published/artifacts/329e0778f19eca92d459f26f17d2beec2e83530d833a332097b546ef901fc01c/frame.html |
| fresh-press | 6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38 | 3c158d2532751b4b6d4b190e662290d8f876acc32483106d7f1c1f8ac1e80369 | published/artifacts/3c158d2532751b4b6d4b190e662290d8f876acc32483106d7f1c1f8ac1e80369/frame.html |
| backward-fresh-press | 6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38 | 4704a93ba3eb977448fd15a6393034cd3623cba9fdd28e050a5d3406ce437d0c | published/artifacts/4704a93ba3eb977448fd15a6393034cd3623cba9fdd28e050a5d3406ce437d0c/frame.html |
| three-meter-followup | 4704a93ba3eb977448fd15a6393034cd3623cba9fdd28e050a5d3406ce437d0c | beb299c5dbc82b3f40e460680727f278425dfed889d4698a0a24f6b796af5383 | published/artifacts/beb299c5dbc82b3f40e460680727f278425dfed889d4698a0a24f6b796af5383/frame.html |
| nine-meter | 6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38 | 62d85e9a22935b87c34011a89648f89c94210805953cb3ca6b20bbbb486e6b77 | published/artifacts/62d85e9a22935b87c34011a89648f89c94210805953cb3ca6b20bbbb486e6b77/frame.html |

Frame paths are relative to the recording directory.

## Finite checks

For each matched child, `readRoadsterArtifact` accepted the manifest and file bytes. The artifact intent, submission intent, conformance intent, and browser intent are the three-field expected intent. The copied `verification.json` passed, including conformance and browser. The generation record names the same parent id and component id. Journal child file hashes match the artifact bytes. `notices.txt` is present and is SHA-256 `5dd7dca96e3e864fb37554a033b5c15fcddadd935f1abec0f5825fc4cebd2f13` on every matched child. `frame.html` is present in the recording.

Flight stored `expected-unsupported`. Its submission source is empty, its intent matches the base parent, and it has no child. The stored error is 500 characters, ending in the campaign's truncation of the unsupported explanation. Noop stored `expected-noop` with the error `The proposed mapping does not change the parent`. Its submission source is 2098 characters and SHA-256 `800eaf10315ee22ba9c9c457a4209fb21b6fa9ee70d8ba1e0022825ef29ea35b`, the same hash as the base parent adapter. It has no child. The no-op rule accepts that error message without requiring an empty source.

## Limitations

The recording omits the phase ledger, credentials, locks, and process logs. The journal and generation records contain `reasoningTokens` counts and do not contain reasoning text. The base parent was re-read and was not copied again. No unpublished model output was present to retain. A checkout re-reads the pinned `frame.html` files through `readRoadsterArtifact`, as described in the recording README. These eight prompts were not rerun.
