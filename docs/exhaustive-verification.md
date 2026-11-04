# Exhaustive dash verification

The four accepted recovery controllers and the older Spark controller each **match the compiled binary on every reachable dash state and button combination (275 states, 17,600 transitions)**.

The four state fields were chosen by humans and checked empirically. This covers default configuration and body width 8 only. Combat is out of scope. Float behavior beyond the tested positions is unverified.

All 12 known-bad candidates have a replay-confirmed counterexample of 1, 10 or 11 gameplay ticks. One additional candidate is inconclusive because its emitted displacement depends on position. No model request was made, and the live controller is unchanged.

The measurements are in [`assets/evidence/exhaustive.json`](../assets/evidence/exhaustive.json). They are recomputed from the pinned cartridge and original candidate sources by:

```sh
npm run verify:exhaustive
node --test tests/exhaustive.test.mjs
```

`npm run verify:evidence` also recomputes the record. CI runs both verification commands. `node scripts/verify-exhaustive.mjs --write` creates a new evidence file and refuses to overwrite an existing one. Historical reports, plans and candidate fixtures are inputs, never rewritten.

## What is enumerated

After the title-screen Start input, the verifier performs a breadth-first search of `(remaining, cooldown, direction.x, direction.y)`. Each state is expanded with all 64 subsets of the WASM-4 buttons `1, 2, 16, 32, 64, 128`. Every edge records its next state, displacement, motion ownership, events and timers. The state reader walks the donor registry on every frame, so moving heap allocations do not invalidate observations.

The default donor has walking speed 2, dash distance 60, cooldown 25 and initial cooldown 10. Candidate configurations are the candidates' original declared defaults, including incorrect values in negative controls. Only the donor's default configuration and body width 8 are enumerated.

A snapshot contains all 65,536 linear-memory bytes, the host disk, disk size and frame number. The verifier inspects the cartridge globals and refuses anything except the pinned binary with its sole mutable global, the balanced `$g0` stack pointer. A disturbed execution is restored and compared with an ordinary replay from reset: all 200 subsequent snapshots are byte-identical, including the disk. The optimized path still executes rendering into the framebuffer; it skips diagnostic draw records and per-frame hashes. No pinned runtime file is changed.

The four-field abstraction is challenged with 548 alternate concrete states and six seeded gameplay contexts:

| Seed | Gameplay frames | Reachable states in context | Conflicts |
| --- | ---: | ---: | ---: |
| 11 | 120 | 264 | 0 |
| 23 | 300 | 264 | 0 |
| 37 | 600 | 264 | 0 |
| 41 | 1,200 | 264 | 0 |
| 53 | 2,400 | 264 | 0 |
| 67 | 4,800 | 264 | 0 |

Together with the initial enumeration, these expansions execute 154,048 transitions without a conflict. Context setup and snapshot-replay steps are additional to that count. The most distant seed reaches about 7,227 source pixels on the x axis. Cross-checks compare displacement within 0.001 pixels per axis and require the next key, events, ownership and timers to agree exactly. The largest observed displacement difference across concrete contexts is 0.000152587890625 pixels. A conflict or loss of gameplay stops verification.

## Candidate search and verdicts

The second breadth-first search pairs each donor state with the candidate's JSON state. Candidate displacement must be within Euclidean distance 0.001 pixels per tick; `ownsMotion`, ordered events and the two fields named by `timerFields` must match exactly.

Candidates run in a credential-free child process with memory and wall-time limits. The VM disables generated code, WebAssembly, Date and randomness; freezes config and inputs; and rejects non-finite JSON, oversized state and malformed output. Each expansion has a VM timeout. Module initializers are restricted to functions, literal constants and frozen Math aliases. Module constants, helpers and intrinsics are frozen, and unresolved bindings are refused, so mutable controller state belongs in the JSON ABI.

Top-level `x` and `y` are omitted from visited-state keys. At every expanded transition that contains them, the verifier adds 1,000 to those fields and requires identical output and identical remaining state. This is an empirical check of the projection, not a guarantee at arbitrary positions.

| Verdict | Meaning |
| --- | --- |
| `proved` | The reachable product search completed with no mismatch and every omitted-field check passed. |
| `counterexample` | Breadth-first search found a failing trace, and `evaluateRecoveryMotion` rejected the original candidate on that trace with 12 idle ticks appended. |
| `inconclusive` | A projection failed, a limit was reached, execution was invalid, the abstraction failed, or the normal evaluator could not confirm the counterexample. It is never a pass. |

The cap is 12,000,000 transition checks. Search stops at its first mismatch rather than counting every later mismatch; negative-control pair counts therefore differ from the exploratory prototype's full searches. The counterexample length is the shortest found in the searched product. Independent replay establishes that it is a real failure even when the candidate's position projection is unsound.

## Recorded candidates

| Candidate | Verdict | State pairs or shortest counterexample |
| --- | --- | ---: |
| First session, used on the site | `proved` | 275 pairs |
| v3 session 1, attempt 2 | `proved` | 275 pairs |
| v5 session 1, attempt 3 | `proved` | 275 pairs |
| v5 session 3, attempt 3 | `proved` | 275 pairs |
| Older Spark component `1bc4250c` | `proved` | 275 pairs |
| v3 session 3, attempt 3 | `inconclusive` | 17,057 pairs |
| v3 session 3, attempt 2 | `counterexample` | 10 ticks |
| Fixtures `premature-activation`, `edge-trigger-oscillation` | `counterexample` | 10 ticks each |
| Fixture `walking-facing-assumption` | `counterexample` | 11 ticks |
| v3 session 1 attempt 1; v3 session 3 attempt 1; v4 session 1 attempts 1–2; v5 session 1 attempts 1–2; v5 session 3 attempts 1–2 | `counterexample` | 1 tick each |

The accepted controllers' maximum per-tick displacement error is below 0.000003 pixels. The v5 session 3 accepted controller passes all 17,600 position-projection checks. The inconclusive v3 controller fails 721,840 of 1,091,648 projection checks: for example, walking diagonally emits −1.4142135381698608 at position 0, but −1.4141845703125 after the position shift. It computes displacement by subtracting the old position from a float32-rounded new position. The checker preserves the inconclusive verdict despite this small numerical difference.

## What the sampled checks reached

| Checks | Distinct transitions | Share of 17,600 |
| --- | ---: | ---: |
| 32 development cases | 550 | 3.1% |
| 20 acceptance cases, seed 1348471918 | 1,605 | 9.1% |
| Combined | 1,878 | 10.7% |

None of those cases presses Z. Excluding Z combinations, coverage is 1,878 of 8,800 transitions, or 21.3%. Coverage is measured by replaying the case inputs through the enumerated transition table; it does not change the sampled evaluators or their historical outcomes.

The 11-tick example is nine idle ticks, one left-walking tick, then X with no direction. The binary dashes right, while the historical candidate dashes left because it incorrectly reuses walking direction. The independent evaluator confirms the divergence at tick 11.

## Baseline

Work began in a separate worktree from `origin/main` at `7879e6b` on November 4, 2026. Before edits, `npm ci`, `npm run verify:evidence` and `npm run verify:wonder` all exited successfully. The Wonder output explicitly named v3, v4 and v5 and replayed the accepted v3/v5 sources. The throwaway prototype was rerun against this checkout and reproduced the supplied state counts, coverage and candidate verdicts.

This work adds no new recovery session or claim that a model located state. The original recoveries used human-supplied state observations. A later no-location-hints protocol requires its own recorded results.
