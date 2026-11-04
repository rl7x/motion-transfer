# Recovery without state-location hints

`motion-recovery-v6` adds counterexample feedback to binary recovery and removes the human map from model-visible investigation results. No paid v6 session has run. The offline tests use a mocked model and a supplied controller fixture; they establish harness behavior, not a new recovery result. The [frozen plan](../assets/benchmark/wonder-harness-v6/plan.json) requires separate spending approval.

The default remains v5. Existing protocol bodies, frozen reports and acceptance cases are unchanged. V6 retains v5's request, token, session-time and attempt limits, with a $2.50 session ceiling. Its separately recorded deterministic gate timeout accommodates the exhaustive search within the existing session time limit.

## Investigation and disclosure

The model is never told where state lives. Recursive filtering removes `motion`, `motionNotice`, `fieldHints`, observations derived from that map, and mapped target handles. Filtering runs before experiment-program SDK results are returned, at the shared API/MCP journal boundary, and before evidence selection and compaction. The pinned runtime files remain unchanged.

An empty watch list produces an empty target list. Raw watches chosen by the model can still create checkpoint-bound targets. Static inspection, writer tracing, fresh replays, sessions, forks, memory comparisons and branch comparisons remain available. Rendering and requested raw memory remain observable; scenery can reveal movement when the camera follows the player.

Humans chose the mechanic, wrote the ABI, experiment tools and evaluators, and mapped fields for a private grader. Development feedback still shows expected positions and timers, without their locations. This does **not** establish that a model found the state layout. The state-reader stretch goal is disabled.

## Three gates

1. The candidate must pass the existing 32 development cases.
2. The [exhaustive verifier](exhaustive-verification.md) searches the product of donor and candidate state. A confirmed counterexample is replayed with 12 idle ticks and returned as a normal development failure window. It consumes the current attempt. An inconclusive result also fails development and requests revision. Only `proved` advances.
3. The host freezes the exact candidate and runs the unchanged 20 unseen acceptance cases. A disagreement after `proved` stops the session and blocks subsequent planned sessions: the state abstraction must be investigated.

Each searched attempt records the full exhaustive verdict in the session and report. Each started session gets `verification-N.json`, including development, exhaustive and acceptance outcomes, even when no candidate is accepted. Recipient integration verification is stored separately. Reaching the cost ceiling counts as failure.

A successful exhaustive verdict supports: “matches the compiled binary on every reachable dash state and button combination (275 states, 17,600 transitions).” The four state fields were chosen by humans and checked empirically. This covers default configuration and body width 8 only. Combat is out of scope. Float behavior beyond the tested positions is unverified.

## Frozen run and budget

The plan binds an implementation commit, a Git source archive SHA-256, all recovery protocol source hashes, a unique backend workspace and output directory, and a 4 PM ET start cutoff. It plans **one fresh session at $2.50**, because the read-only cloud ledger shows $1.05135725 of other Meta work since midnight ET on November 4. Conservatively counting that spending against the $5 working limit leaves $3.94864275. No category allocation is changed.

After explicit approval, `wonder-harness.mjs` uploads the matching archive into the plan's isolated `/tmp/wonder-harness-v6-*` backend workspace, uses the backend's installed dependencies, and checks the source protocol identity before starting. It does not update the live backend application or deploy the website. The local run uses the isolated worktree; `--deployment-root` reads credentials and backend connection state from the original checkout without copying them into the archive.

Both local and backend preflight re-read the authoritative cloud ledger. The existing ledger lock then atomically checks the $5 working limit, including settled costs and held reservations, before reserving the full $2.50 in the Wonder category. A started ordinal cannot be rerun. Other spending can prevent admission even if the frozen plan originally fit.

```sh
# Read-only plan validation; no model or backend request.
node scripts/verify-wonder-harness.mjs --v6 --plan-only

# Only after explicit approval, from the frozen isolated worktree.
node scripts/wonder-harness.mjs run --version v6 --trial 1 --allow-paid \
  --deployment-root /Users/richardliu/code/meta-ai-developer-hackathon
```

Every start must be collected and reported, including failure or interruption. After approved runs, finalize the results, run `node scripts/verify-wonder-harness.mjs --v6 --replay`, add that command to `verify:wonder`, extend `verify:evidence`, and publish the measured outcome in `docs/wonder-harness-results.md`. Until then, there is no v6 recovery-rate claim.

## Offline checks

`tests/recovery-v6.test.mjs` exercises the real dispatcher, SDK interpreter, compaction and all three gates through a mocked model. It also injects private address markers at the final journal boundary, preserves model-requested raw watches, confirms the 11-tick negative control, and checks inconclusive, verifier-error and acceptance-disagreement paths. `tests/wonder-harness-v6.test.mjs` checks all three success gates and the atomic working-limit reservation without changing category allocations.
