# Fresh Wonder recovery

`reports/motion-transfer-phase/wonder-development-001` is one Muse Wonder development trial. Protocol `9c7cda7c802c7ca4ab51729266af7ca21e52b886c6e61659e21ff38d6b922c5e`, model `muse-wonder-1.0`, campaign `67a02792-0e21-48fa-832c-991d00085d85`, definition sha256 `c9f0a0620e3567ef2ca4f2b7fbb57eaff04eadb97c14bb72491f706161656a89`. The journal records estimated cost `$1.689036`, reserved cost `$0`, one donor acceptance, and zero accepted deliveries. Its Wilson interval is null. The frozen ten-trial arm has not been run, so this page does not state a reliability rate.

The source journal remains a completed campaign whose only trial failed. Journal sha256 `3b4c3a246aeb1767036cedeefef03c9d10d6e7b9833b697f0ed41d81c39ba528`. Trial `0f594188-18ed-4e7a-9aaf-6e2843823e9a` is still `failed` / `recipient-or-export`. Exact report `reports/aa6b3cf7c82f88102242356fa5aab2f3cb9e9f8a4e61f069e6251aecf598cf76.json`.

## Model result

Session `fa8e3d4a-8578-4098-8042-f29e607c9267` spent 20 completed requests. Wonder produced three candidates. Acceptance ran only after a candidate passed development and was frozen.

| Attempt | Candidate | Result |
| --- | --- | --- |
| 1 | `7c7d417cfbae8218c1b8b93b9b1e0d42afa4760c969a7041889eb956ada08245` | Development failed on `idle` at tick 1. The cooldown timer was 0; the donor observation was 9. Acceptance did not run. |
| 2 | `668981162d05b9ab727e876bee973e8d7499cb0e4342144d01a45e879f19bff3` | Development failed on `diagonal` at tick 11. Owned position diverged while the dash timer matched. Acceptance did not run. |
| 3 | `accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f` | Development passed, 13 checks. Acceptance passed, 20 checks. This is the frozen candidate. |

The frozen component is `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858`. Its provenance lists model `muse-wonder-1.0` and this human work: registering the compiled donor and motion boundary, mapping the read-only motion fields, and authoring the motion ABI, development evaluator, and acceptance generator.

## Host publication

Donor acceptance and publication are separate. The model’s third candidate had already passed acceptance. The campaign then failed in the host, before any integration id was stored. `buildJujumpIntegration` kept `acceptancePassed` and `model` as `undefined` on attempts and requests that had no such value. `case-study.json` omitted those keys. Publication required the in-memory case study and the delivered JSON to be deeply equal, so the trial stopped in `recipient-or-export`.

Commit `d6c2679` (`fix: preserve serialized recovery history during publication`) makes the returned case study the JSON that was actually written. The delivered case study now records attempts 1 and 2 with `developmentPassed: false` and no `acceptancePassed` field, and attempt 3 with `acceptancePassed: true`. Request entries omit `model` because the stored requests have no model field. The campaign report itself names `muse-wonder-1.0`.

`node scripts/deliver-accepted-recovery.mjs --campaign reports/motion-transfer-phase/wonder-development-001 --out reports/motion-transfer-phase/wonder-delivery-001` republished that same frozen candidate. It read the original campaign and exact report, ran the host integration, and wrote a new directory. It did not read credentials, call Meta, or modify the source journal. No other campaign was started.

The delivery ran at commit `5533e4d59abef351fcc7788d330401bb2de7a02c`. The receipt source hash `80725ec1bb8309a2ee6636eb798aa5d983bbcb8c686828a7ec907935efc5029f` covers the accepted-component loader, JUJUMP export, publication, recovery integration, and this delivery command. That hash matches `deliverySource()` for those five files on the current tree at `f6cc28251a42ad61dda25d28fe47ccf2787baf72`. Commit `5533e4d` does not contain `scripts/deliver-accepted-recovery.mjs`, so the hash is the on-disk file digest recorded with that commit id. It is not a tree snapshot of `5533e4d`. The receipt commit field is unchanged.

## Published artifact

Recorded at `2026-11-03T00:00:11.872Z`.

| Field | Value |
| --- | --- |
| Publication | `f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57` |
| Package | `621b47a30f49a2e8edc4418c262c6d5b7f64fed750bd9ad94ee3aae8dc41424e` |
| ZIP sha256 | `cf61ad805b090392caa206c7fe6a5c8d803c25a839650a05436db842a242fcae` |
| Archive | 1,820,653 bytes, 38 files |
| Component | `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858` |
| Candidate | `accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f` |
| Session | `fa8e3d4a-8578-4098-8042-f29e607c9267` |

The final ZIP passed 3 Node checks and these 7 browser checks: `ordinary-play-matches-original`, `native-jumps-gravity-and-landing`, `airborne-dash-retains-gravity`, `swept-platform-contact`, `held-timing-and-frozen-direction`, `death-restart-resets-controller`, `dash-controls-replay`. `metaCalled` is false and the browser made no external requests. Reloading the publication reproduces the same component, package, and check counts.

Receipt: `reports/motion-transfer-phase/wonder-delivery-001/delivery-receipt.json`.

Artifact: `reports/motion-transfer-phase/wonder-delivery-001/integrations/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/`.

A second delivery into that directory stops because the receipt already exists. The receipt is not rewritten.

## Checked-in publication

The campaign directory `reports/motion-transfer-phase/wonder-development-001` and the delivery directory `reports/motion-transfer-phase/wonder-delivery-001` stay separate local evidence. Both are gitignored. The campaign trial is still `failed` / `recipient-or-export`, with zero accepted deliveries. Copying the publication did not change that journal or the delivery receipt.

A clean checkout reads the same host publication from these three files. They are a byte copy of the delivery artifact, not a regenerated package:

- [receipt.json](../assets/integration/recordings/recoveries/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/receipt.json)
- [project.json](../assets/integration/recordings/recoveries/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/project.json)
- [validation.json](../assets/integration/recordings/recoveries/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/validation.json)

`createIntegrationPublication` on an empty directory finds no local `integrations/` copy and falls back to `assets/integration/recordings/recoveries/`. That read rebuilds the ZIP from `project.json`.
