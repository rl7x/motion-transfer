# Wonder recovery harness

The original Wonder repeats exposed two different problems. One session alternated between an early level-triggered dash and a missing edge-triggered dash. The other passed all 13 development cases with an incorrect rule that a neutral dash uses the last walking direction, then failed unseen acceptance. Both also encountered a writer-trace callback limit while trying to locate the relevant binary code.

The v3 harness adds the following changes. The model still chooses code to inspect, experiments, candidate source and revisions. The harness supplies measurements and checks:

- Writer tracing filters the selected address range inside the instrumented WASM. Unrelated rendering writes no longer exhaust the callback allowance. Replay happens before recording; original and instrumented execution are still compared on every measured frame.
- Development failures include two preceding and two following frames, per-frame displacement, initial observed timers and the tick convention. An early activation now shows the frame when the donor actually activates.
- Context compaction retains a bounded history of earlier candidate failures alongside the current source. This lets the model compare a revision with rules it already disproved.
- Development expands from 13 to 32 cases. All direction-bit combinations are followed by neutral or opposing-input activations, and additional rollouts vary hold/release durations. Expected values come from executing the pinned donor. No saved controller or regression-fixture source is given to the model.
- Feedback groups similar failures and returns at most six representative windows. The durable report retains every case. This keeps the expanded suite within the tool response and context limits.

Acceptance remains 20 separately generated cases, seeded only after the candidate is frozen. Acceptance failure ends the session. The old v2 protocol still validates and retains its 13-case development suite. Historical results and their frozen manifests are unchanged.

New sessions default to `motion-recovery-v4`, which retains the v3 checks and gives the host responsibility for freezing, acceptance and a factual verification summary. These use the same journal executor and evaluator; the calls are explicitly recorded with `actor: host-verifier`. Model evidence selection and candidate generation still precede these gates. Acceptance failure is terminal. This avoids paying for model requests to perform deterministic verification after development has passed. Model interpretations remain unverified (`conclusionVerified: false`).

The user authorized an $8 maximum per Wonder session. That ceiling applies to v4; the v2/v3 ceilings retain their original values so historical protocols remain valid. Source hashes still distinguish every executable change. Recovery evaluation lives in separate files so the earlier fidelity study keeps its pinned evaluator bytes.

## Running a new development session

```sh
npm run recover:campaign -- --development \
  --model muse-wonder-1.0 \
  --max-cost-usd 8 \
  --out reports/wonder-v4-development-001 \
  --phase-ledger <existing-authoritative-ledger-directory>
```

This makes paid model requests. The protocol, ceiling and executable inputs are frozen before the first request. Use the authoritative ledger where it lives; do not spend from a copied ledger. Run from an isolated copy when other code changes are ongoing. Check that the sandbox has at least 16 minutes remaining before starting each session. A resumed campaign cannot change its model, protocol or supplied cost ceiling and never repeats a started trial.

Use `--protocol motion-recovery-v2` only when deliberately selecting the earlier development suite. A source change still changes the protocol hash, so selecting the old name does not reproduce a historical frozen protocol by itself.

## Local verification

`tests/fixtures/wonder-recovery-failures.json` contains three unchanged historical Wonder candidates with their original source hashes. These are offline regression inputs, never synthesis context. Tests replay them against the real donor, verify that v3 catches the wrong direction-history rule, and check the early/missing activation windows. A saved accepted controller is a positive control for the new suite, not evidence of a new recovery.

`node --test --test-concurrency=1 tests/recovery-harness.test.mjs tests/write-instrumentation.test.mjs tests/component-workbench.test.mjs tests/recovery-protocol.test.mjs tests/recovery-context.test.mjs tests/recovery-progress.test.mjs tests/recovery-investigation.test.mjs tests/recovery-campaign.test.mjs` runs the focused checks without model requests.

Fresh model sessions are necessary to measure recovery reliability. Passing regression tests establishes that the harness exposes the known failures; it does not establish that Wonder will consistently repair them.
