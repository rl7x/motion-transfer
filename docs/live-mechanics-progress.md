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

## Remaining

M2: deterministic checkpoints and fixed-goal comparison. M3: bounded composition if the core flow works. M4: actual recipient release, exact clean-start exports, frozen task evidence and final full-suite results.
