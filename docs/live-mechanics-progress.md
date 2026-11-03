# Live mechanics implementation

Working repository: `/Users/richardliu/code/meta-ai-developer-hackathon`. Started from merged main `a0aed8e` on `feat/parallaxia-live-mechanics` on November 3, 2026. The active implementation plan is the supplied `motion-transfer-live-mechanics-plan.md` in the extracted Downloads handoff; its old Mac paths and branch descriptions are historical.

## Spending reconciliation

Before inference, the working ledger's four reservations were compared with the restored handoff's sixteen and the original archive. All four working records were unchanged and present in the handoff. Neither copy contained later activity; definitions and the single allowance migration matched. Both original ledgers and every overwritten report were preserved in gitignored `reports/handoff-reconciliation/20261103T142557Z/`. The 450 missing reports and eight differing files were imported. The working ledger now has the handoff's sixteen records, SHA-256 `4e90c6014859155c2d4e1147251d9226794eb799ea9d9abaaf97e7feb3813c00`.

The reconciled snapshot reports $1.99700237 estimated usage, $0.905351648 retained reservations, and $47.097645982 remaining under the existing $50 ceiling. Two bounded-unknown charges remain retained. These figures are local ledger accounting, not a verified provider balance. No allowance migration was repeated.

## M0: recipient identity and baseline

PARALLAXIA now has its own descriptor, immutable artifact identity, accepted component selection, recipient-specific native/browser reports, source, notices and artifact routes. The baseline reuses the existing Meta-generated adapter and labels this as reuse with zero new model calls. Its verification uses accepted component `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858` and checks mapping, component counterfactuals, inactive native movement/enemy rules and actual swept bullet collisions during a dash. The same accepted component is served in the separately verified JUJUMP package.

The new default React workbench distinguishes native collisions from shielded practice. Native play adds no dash immunity and retains swept collision handling. Practice measures position with an explicit shield; it establishes no survival claim. World units are documented: the default 60-source-pixel dash maps to six world units and the Canvas renderer uses ten pixels per world unit. Roadster routes serve their original saved frame bytes and retain their own reports and notices.

Validation: `node --test --test-concurrency=1 tests/parallaxia-recipient.test.mjs tests/parallaxia-identity.test.mjs` passed 5/5, including standalone Chromium execution, exact historical-route bytes, accepted identity/portability, mobile width and explicit practice labels. `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. A screenshot is retained at `reports/parallaxia-m0-desktop.png`. No paid inference was needed for M0.

## M1: real generation and isolated publication

The historical Roadster browser rejection did not reproduce on this Mac: all eight gates passed in the retained direct worker response. The full `npm run verify:hosting:isolation` also passed with no skips in 218.24 seconds, including coordinator publication and the no-socket image check. No publication or isolation gate was weakened. Failed attempts now retain the full rejected worker result for diagnosis.

PARALLAXIA generation uses its own Standard Meta request contract and independently checks the complete inherited intent. Generated source is compiled/executed only by the existing restricted worker. A single $0.15 reservation covers at most two candidates, including one feedback-driven repair. Raw responses, checks, failures, timing and usage are retained. Operator-configured production client wiring is implemented, while the local preview uses the reconciled shared ledger and keeps broad recovery off.

`node scripts/verify-live-parallaxia.mjs --allow-paid` passed a real Chromium flow: a new backward/fresh-press child, then a half-distance follow-up retaining those choices. Refresh reconnected during each job; restart reopened the final exact child; reconnect used no additional model response. Two provider responses cost an estimated $0.00772525 and $0.00746575, total $0.015191. These are development measurements, not the frozen task benchmark. The full evidence, including both immutable artifact identities, is in `reports/live-mechanics/live-fea43f86-9742-4f17-850f-4fcc1a22de78/development-evidence.json`.

`node --test --test-concurrency=1 tests/hosting.test.mjs tests/hosting-component.test.mjs tests/parallaxia-generation.test.mjs` passed 24/24. The repair test uses an explicitly synthetic provider/broker fixture and proves two attempts share one reservation and that restart reuses the job. The live run needed no repair; it is not evidence of a real repair benefit. Public deployment was not performed.

## M2: deterministic checkpoints and fixed goals

Checkpoints record the recipient/hooks, component and adapter identities; seed/mode/sector; logical tick; bounded run-length encoded native **and dash** inputs; and a SHA-256 digest covering native state, RNG, component timers and adapter edge state. The worker reconstructs and validates that digest before any paid request. Candidate adapters warm from reset and must reproduce the same required starting state. Transcript expansion is bounded before allocation.

The React workbench can pause native play or select a clearly labeled curated seed-7 checkpoint at tick 40. It freezes a target, a 120-tick horizon, unchanged native Shoot controls and explicit no-life-loss/no-added-invulnerability constraints. Generation proposes a supported mapping and dash trigger tick. The worker scores both branches at 60 Hz and retains actual failures; browser replay at normal speed independently matches each worker end digest. Checkpoint inputs, targets, interventions, outcomes and source identities are included in the child export. An adapter capability gate additionally rejects direct globals, clocks, dynamic capability lookup and attempts to install a hidden shield; Docker isolation is still required.

An early no-shoot development replay entered the target but lost a life, correctly failing. Its six explored native-control conditions are retained in `reports/live-mechanics/checkpoint-development-scenarios.json`. They are development curation, not benchmark trials.

The first real experiment generated a wrong-direction candidate and failed its fixed goal. Oversized replay feedback then exceeded the existing 12,000-input-token repair preflight; no second response was made. That entire failed job remains in `reports/live-mechanics/experiments-f145ad35-2e0d-47fa-bdd0-5b24a021b74d/`. Its known $0.01017725 cost and **full $0.15 bound** remain in the ledger as an audited bounded-unknown reservation. No charge was erased. Feedback is now a compact measured outcome summary, and the worker supplies actual ship facing explicitly.

The separate v2 development run passed: reachable goal job `ba3e8a5d-db48-43f0-90e0-034b65cd86f4`, artifact `beefe0afa993c9557eac2176dd111e7a25a4fe0ca7cb722a0d3c6b9486c449e4`, estimated $0.01055325; infeasible goal job `fe4bd35d-09a9-4f01-be41-49b25b5da3b9`, diagnostic artifact `2bb40b50082883f350d72c833ab900f2d6c464900a9a6b130e73cdc86285c2dd`, estimated $0.01706525 across both attempts. The out-of-bounds target remained unchanged. Both branch players reproduced the worker digests, and no page errors occurred. These are development measurements. Raw evidence and screenshots are in `reports/live-mechanics/experiments-87f61dff-d908-495b-9988-165ffcd08ea2/`.

Focused validation passed 31/31 across PARALLAXIA identity, checkpoints, generation and hosting. The added capability/browser checks passed 5/5; the explicit historical Roadster/React browser checks passed 6/6. Frontend typecheck, lint and formatting passed. Historical tests now select Roadster explicitly; the default route is the new PARALLAXIA workbench.

## M3: bounded event composition

Meta can emit one declarative rule module: `dash-end` → a single `native-shot` attempt on the next simulation tick, or `export default null;` to remove it. The host owns scheduling, native projectile creation, cooldown and cap enforcement. Ordinary shooting runs first. A suppressed extra shot is consumed, never retried. The rule cannot execute arbitrary code or modify the recovered component. This is a new host composition, not another recovered donor mechanic.

Rule identity and exact module bytes enter the playable artifact and export; pending action, event guard and counters enter the checkpoint digest. Native and browser gates check next-tick timing, no duplicate action, reset, native cooldown/cap and disabled behavior. A pending effect reconstructed from an actual browser checkpoint fires exactly once in both browser and worker.

The real add-rule job `485de0e6-97a6-42be-bd26-0d48d50082cd` passed at an estimated $0.00816175. Removal job `ad5602ae-6026-43f9-9adc-6617329e15c7` initially supplied a nonliteral module, which the worker rejected; its one repair emitted the accepted null declaration. That job cost an estimated $0.0167875 total. The mapping stayed held/facing/0.1 in both children. Actual browser measurements show zero attempts on the dash-end tick, one shot on the next tick when enabled, no extra shot when removed, and 49 unchanged component updates.

The development validation harness initially failed on a mutable snapshot reference and on iframe navigation timing, then incorrectly expected exactly two provider responses despite the legitimate repair. Those validation failures are retained alongside the original jobs. The corrected harness reused the already generated children without another paid response; the final continuation passed, including restart/reconnection. Evidence: `reports/live-mechanics/composition-125b2fdf-e686-4e16-adea-520403d6f17f/development-evidence-v2.json`. There were three provider responses total, not two. Browser game snapshots now copy rule counters so historical observations remain stable.

Focused native/browser checkpoint and composition checks, including actual restricted Docker publication gates, passed. Frontend typecheck, lint and formatting passed. No graze-token rule or other composition was added.

## M4: actual release and frozen evidence

M4 packaging is implemented: explicit PARALLAXIA collection preserves exact worker-published frames, component/rule/source/evidence, parent versions and diagnostic failures. The static React copy labels saved reuse and disables creation. ZIPs include the exact parent and candidate, and experiment exports include a React replay page. The collector also supports explicitly labeled baseline-only reuse; it never silently substitutes that for a requested generated child.

The ten-task manifest is frozen in `benchmark/live-mechanics-tasks.json` (SHA-256 `12cec5a9dc87845f67ca1585a2d95a7db842a08bf2adfc60c8be33d3ecb93a77`) before the measured run. It defines nine positive tasks and one negative, with two jobs per session and no new allowance. `--validate-only` checks the definition without inference. Source must be committed on a feature branch before the paid runner starts. Failed tasks remain in the result and block only dependent tasks.

The baseline static release passed a fresh browser, nested-base-path checks, a system-extracted exact ZIP, no external requests/POSTs and same-component JUJUMP playback. Packaging/creator/hosting checks passed 28/28, and cancellation now prevents the browser/publication stages after a native-stage cancellation. The ordinary free-play controller no longer injects an undeclared held Shoot input; curated experiments still declare their shared native Shoot controls explicitly.

The frozen run at `bf7cd14` completed with **8/9 positive tasks and 1/1 correct negative**, estimated $0.090081 across ten responses/eight jobs. The left-goal candidate reached the fixed region but lost a life; its one repair also failed. Both failures remain in the campaign. The successful right-goal child and all campaign publications are packaged in `reports/release-parallaxia/`; the original build passed exact ZIP system extraction, normal-speed paired replay, accepted JUJUMP and nested-base-path checks. See [the measured results](live-mechanics-results.md) for every task, cost, time and artifact.

`npm test` then passed **355 tests, 0 failed, 1 skipped** at `bf7cd14`; the skip is the missing pinned Muse CLI binary. Hosting isolation/publication passed again without gate changes. The full-suite ledger hash was unchanged. Details are in [local validation](local-validation.md).

### Final user-directed changes

Richard requested removal of the persistent age/privacy/model banner and a $7 whole-job cap. The banner is removed. Age confirmation now appears only on a first creation; cancel sends no request and confirm resumes PARALLAXIA creation once. Backend age/admission checks remain. New $7 jobs reserve from the existing $10 reserve allocation, since the unchanged remix allocation is $5. The $50 total, single historical migration, all 31 prior records and three bounded-unknown reservations remain unchanged. No new paid request was made for this change. The frozen v1 runner retains its explicit historical $0.15 cap.

Final release polish displays the actual frozen measurements, preserves nested links, makes baseline selection persist across reload, clears stale comparisons and keeps unsuccessful diagnostics from replacing the original. The verification CLI chooses recipient-specific checks. The first final-release navigation check exposed nested iframe history interfering with Back. Version switches now mount a fresh frame at their reset boundary; the subsequent actual-release build passed all gates, including baseline reload/back, diagnostic reopening, the measured table and exact paired ZIP replay. Both build logs remain retained. Focused hosting/cap checks passed 25/25. Final release/UI checks passed except for one stale audience-notice test assertion, which passed when corrected and rerun. Typecheck, lint, formatting and both frontend builds passed. The full suite predates these final changes and was not repeated after Richard asked to wrap up.

The shared ledger now reports $2.16501937 estimated usage, $1.045174398 retained reservations, and $46.789806232 remaining. Its SHA-256 is `1934f39c37ede0c05a4cadf1348e280926151fd5a0372d2a23c23caa21b51d3d`. These are local estimates, not provider-balance verification.

### Remaining limits

The left checkpoint goal remains unsuccessful. Native enemy body contact keeps its upstream 60 Hz position-sampled behavior; swept bullet collisions remain active. Arbitrary goals, mid-dash migration, a second live recipient and additional composition rules are outside this implementation. The missing pinned Muse CLI is the only full-suite skip. Public deployment, visibility changes, outside-network tests, video and submission were not performed. No new PR was merged. Work remains on `feat/parallaxia-live-mechanics`; main remains `a0aed8e`.
