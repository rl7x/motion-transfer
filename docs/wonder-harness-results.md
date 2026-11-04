# Wonder harness experiments

These experiments are separate from the original [Wonder repeat trials](wonder-repeat-results.md). They change the harness and retain every started session, including failures. They do not change the controller used by the public site.

## v3: transition feedback and expanded development

The first plan declared two sessions capped at $2.40 each. After the second was interrupted, a separate follow-up plan declared one additional session with the same frozen protocol.

| Session | Development | Acceptance | Result | Requests | Estimated cost |
| --- | --- | --- | --- | ---: | ---: |
| 1 | 9/32 → 32/32 | 20/20 | Accepted and published to JUJUMP | 20 | $1.984772 |
| 2 | No candidate | Not run | Sandbox session expired | 1 | $0.025358 |
| 3, separately declared follow-up | 0/32 → 27/32 → 32/32 | Not run | The next request could not fit the $2.40 ceiling | 19 | $2.182208 |

Total estimated spending: $4.192338. Session 1's writer trace succeeded and led Wonder to inspect a motion function. Its accepted source also passed an additional offline audit of 100 generated traces, without revision. Session 3's development-passed source is not counted as accepted: it was never frozen or tested on unseen acceptance cases in that session.

The sandbox interruption was an orchestration error: its remaining lifetime was not checked before the original batch. The journal retained one completed provider request and no unsettled request. Reconciliation marked that session interrupted and settled its actual recorded cost; it did not resume inference. The separately declared third session checked the sandbox lifetime first.

The exact reports, source hashes and both plans are in [the v3 evidence directory](../assets/benchmark/wonder-harness-v3/). `node scripts/verify-wonder-harness.mjs --replay` checks their identities and spending, then replays the accepted source against the donor on development and its original acceptance seed. It makes no model request. The frozen trial source was committed as `cf8d1fb`; a later file split preserves the earlier fidelity study's evaluator bytes and changes the current protocol hash.

## v4: host verification and an $8 session ceiling

The user authorized a maximum of $8 per Wonder session. Three fresh sessions are declared in [the v4 plan](../assets/benchmark/wonder-harness-v4/plan.json), using the same frozen protocol. The host freezes and runs acceptance immediately after development passes, through the existing journaled tools. It does not request another model response to perform those mechanical checks.

Twelve dollars of unused public-demo allocation was moved to Wonder through an audited ledger transfer. The overall phase ceiling remains $50 and prior spending/reservations remain intact. A session starts only when the ledger can reserve its full $8 ceiling and the sandbox has at least 16 minutes remaining. The results will report any planned session that cannot start.
