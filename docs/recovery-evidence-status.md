# Recovery evidence status

Checked November 2, 2026, on branch `codex/playable-motion-remixes` at `f6cc28251a42ad61dda25d28fe47ccf2787baf72`. This page records which historical files are on disk and what a later run must leave untouched. It assigns no rubric score and no user metric.

The original checkout `/Users/richardliu/code/meta-ai-developer-hackathon` is absent. The reports backup supplied for this import is `/Users/richardliu/Downloads/reports`. It was copied into gitignored `reports/` with `rsync -a --ignore-existing` at `2026-11-02T19:41:35-0500`. 613 files were added. 11 paths already existed and were not replaced. Six of those differ and the local bytes were kept: four `product-review` screenshots, `frontend-build/style.css`, and `frontend-build/assets/app.js`. Their backup copies remain in Downloads. Thirteen local lab job and session files were already here and were preserved. No source file was left uncopied. Details and hashes are in `/private/tmp/motion-transfer-cursor-next/evidence.handoff.md`.

The ledger figures below are that import snapshot. They are not a claim that `reports/motion-transfer-phase/phase-budget.json` stays byte-identical after later jobs. This page does not re-open the live ledger. After the snapshot, root video 001 completed with known cost `$0.02293425` on the contact-sheet fallback. No other paid call was performed.

## Available

Import snapshot of `reports/motion-transfer-phase/phase-budget.json` at `2026-11-02T19:41:35-0500`: sha256 `18f52637c3d05d2330eaf084d67d80f6f0a15dfe95353697032e930637dc0767`. At that time the file matched the backup byte for byte, and `createPhaseBudget().status()` and `.journal()` accepted it without writing. Later jobs can change the live file. Do not treat this hash as the current ledger.

The definition is `motion-transfer-additional-inference-v2` (`44f4ac30d1ee5f299ff6d52daae64abede6e5bd89668584684573def882213fd`), ceiling `$50`. One migration, at `2026-11-02T23:36:21.075Z`, records the previous `motion-transfer-additional-inference-v1` ceiling of `$45`. `historicalSpendingIncluded` is false, so older lab spend is outside this file.

At the import snapshot, `status()` reported known/settled `$1.8220899560000001`, reserved `$0.481782562`, remaining `$47.696127482`. `uncertain` is false. `unresolvedBilling` is true. There is one bounded-unknown reservation and no overrun. The four rows are:

| Reservation | Status | Max | Estimated |
| --- | --- | --- | --- |
| `recovery:8ef96794-7cdf-48ad-a4df-bad49d1eae08:841908f9-be2c-43fd-b77a-23cbad6c7a99` | bounded-unknown | 0.5 | 0.018217438 |
| `recovery:c83512fd-1be7-42f4-a5d5-e265ebc689db:f3877944-5674-4e57-9e7d-ad5580f32d1e` | settled | 0.5 | 0.04127947600000001 |
| `recovery:67a02792-0e21-48fa-832c-991d00085d85:0f594188-18ed-4e7a-9aaf-6e2843823e9a` | settled | 6 | 1.689036 |
| `recovery:47fd490b-4d62-44d5-9081-ca069128fc0b:b74df316-8568-4e68-bd74-0c8c994f1fba` | settled | 0.5 | 0.07355704199999999 |

The first row is the old recovery reservation. Its known estimate is inside the settled total, and `$0.481782562` of its `$0.50` cap stays reserved. The file does not contain a provider charge for that remainder.

`readRecoveryCampaign` accepted `reports/motion-transfer-phase/wonder-development-001`. Campaign `67a02792-0e21-48fa-832c-991d00085d85`, protocol `9c7cda7c802c7ca4ab51729266af7ca21e52b886c6e61659e21ff38d6b922c5e`, model `muse-wonder-1.0`, definition sha256 `c9f0a0620e3567ef2ca4f2b7fbb57eaff04eadb97c14bb72491f706161656a89`. Trial `0f594188-18ed-4e7a-9aaf-6e2843823e9a` is still `failed` / `recipient-or-export`. The summary has one donor acceptance, zero accepted deliveries, estimated cost `$1.689036`, reserved cost `$0`, and a null Wilson interval. Raw `journal.json` sha256 is `3b4c3a246aeb1767036cedeefef03c9d10d6e7b9833b697f0ed41d81c39ba528`. Its internal integrity field is `d09048ebab43acaf6f2a1ddfbbcfbc92fd00a89c069b6237eb9c6849ce857902` and matches the body digest.

Session `fa8e3d4a-8578-4098-8042-f29e607c9267` has 20 completed requests. Exact report `reports/motion-transfer-phase/wonder-development-001/reports/aa6b3cf7c82f88102242356fa5aab2f3cb9e9f8a4e61f069e6251aecf598cf76.json`. Attempt 1 failed development 0/13, with `idle` diverging at tick 1. Attempt 2 failed development 11/13, on `diagonal` at tick 11 and on `neutral-after-left-dash`. Attempt 3 passed development 13/13 and acceptance 20/20. Frozen candidate `accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f` matches `digest({candidate, timerFields})`.

`verifyDeliveryReceipt` and `createIntegrationPublication(...wonder-delivery-001).read` accepted the separate host publication. Receipt `reports/motion-transfer-phase/wonder-delivery-001/delivery-receipt.json` is `delivered` at `2026-11-03T00:00:11.872Z`. Publication `f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57`. Package `621b47a30f49a2e8edc4418c262c6d5b7f64fed750bd9ad94ee3aae8dc41424e`. ZIP `cf61ad805b090392caa206c7fe6a5c8d803c25a839650a05436db842a242fcae`, 1,820,653 bytes, 38 files. Component `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858` recomputes from the published `component/component.ts`, `component/component.js`, and `component/contract.json`. The reloaded publication has 3 passing Node checks, 7 passing browser checks, `metaCalled` false, and no external requests. Receipt source hash `80725ec1bb8309a2ee6636eb798aa5d983bbcb8c686828a7ec907935efc5029f` matches `deliverySource()` on the current tree. The receipt's commit `5533e4d59abef351fcc7788d330401bb2de7a02c` does not contain `scripts/deliver-accepted-recovery.mjs`, so that hash is not a pure commit snapshot.

`development-001`, `development-002`, and `development-003` were copied and were not re-opened in this check.

## Checked-in Wonder publication

The gitignored delivery directory and the campaign journal stay where they are. The campaign trial is still `failed` / `recipient-or-export`, and its journal sha256 is still `3b4c3a246aeb1767036cedeefef03c9d10d6e7b9833b697f0ed41d81c39ba528`. Three public artifact files were copied byte for byte into the default publication fallback:

- `integration/recordings/recoveries/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/receipt.json` — 633 bytes, sha256 `746f21de6509d33cfcee1e30655dca5c122e6e630532422c4e34501de773e7c2`
- `integration/recordings/recoveries/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/project.json` — 1,963,190 bytes, sha256 `9d43437b85bdb0f23b734215310310a421f73772bd8f5b177989279340e9bf29`
- `integration/recordings/recoveries/f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57/validation.json` — 24,452 bytes, sha256 `635a5f6474bf1195f7da3f48b28c83e2ef0e29cbca7327a9ca0ded8127b6a8d9`

No `.env`, auth file, or phase ledger was copied. A structural walk of the three JSON files found no credential-shaped strings, no `encrypted_content`, and no stored reasoning items. The embedded investigation has public turn messages (`phase`, `refused`, `text`) and a `reasoningEffort` setting. `NOTICES.txt` is in the package and names Dashy Dango, JUJUMP, and ABA Games. The package also contains the component source, contract, provenance, development and acceptance evaluations, recovery history, and `evidence/investigation.json`.

`createIntegrationPublication` on an empty temporary directory fell back to that checked-in directory. The rebuilt ZIP is 1,820,653 bytes, sha256 `cf61ad805b090392caa206c7fe6a5c8d803c25a839650a05436db842a242fcae`, with 38 files, 3 passing Node checks, and 7 passing browser checks. Component, candidate, session, and package ids match the receipt.

`loadAcceptedComponent` and `resolveComponentRef` accepted the local session package at `reports/motion-transfer-phase/wonder-development-001/sessions/fa8e3d4a-8578-4098-8042-f29e607c9267/components/accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f/`. That package is still gitignored and was not added to the pin. Its component id matches the publication. `componentIdentity` reports a separate component-package publication id, `e387f441c204d07edff7f3e9850c7ab953fff3bba13274c582be57e194b770c6`. A clean clone can rebuild the ZIP from the three checked-in files. It cannot call `loadAcceptedComponent` unless that session directory is present. No new loader was added.

## Safe resume

The import snapshot above is the ledger this page measured. Later jobs, including video 001, are outside that measurement. Do not create another `phase-budget.json`, and do not run the allowance increase again. Do not settle, reconcile, or reserve the bounded-unknown row from this snapshot. At import time, `reserve()` only refused `uncertain` and `overrun`, so the bounded-unknown row would still have allowed another reservation. No further paid call is authorized by this page.

Leave the Wonder campaign journal failed. Zero accepted deliveries is the campaign result. The delivery directory is the later publication of the same frozen candidate. Do not rerun delivery into `wonder-delivery-001`, and do not edit either tree so the failed trial looks delivered. A second delivery into that directory is supposed to stop because the receipt exists.

The frozen ten-trial arm has not been run. One accepted donor candidate and one later publication are not a reliability rate.
