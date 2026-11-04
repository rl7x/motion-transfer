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

Session 1 failed at the input-token limit after 20 requests and two candidates (0/32, then 9/32), costing $2.042514. Its compacted evidence was still about 93 KB. Sessions 2 and 3 were cancelled before starting to fix this reproducible harness failure. They remain recorded as not run, with no spending. The frozen v4 protocol was not modified or resumed. `node scripts/verify-wonder-harness.mjs --v4` verifies the retained report and all planned outcomes.

## v5: bounded evidence context

V5 retains v4's host verification and $8 ceiling, and bounds the evidence ledger after compaction. The real v4 failure is a regression fixture: the new context retains current source, development failures, recent measurements and trace IDs while archiving older repeated detail. The full journal remains intact.

[The frozen v5 plan](../assets/benchmark/wonder-harness-v5/plan.json) declared three fresh sessions before the first one ran, and all three ran. **2 of 3 were accepted**, for an estimated $4.77.

| Session | Development | Acceptance | Result | Requests | Estimated cost |
| --- | --- | --- | --- | ---: | ---: |
| 1 | 0/32 → 19/32 → 32/32 | 20/20 | Accepted and published to JUJUMP | 21 | $1.722197 |
| 2 | No candidate | Not run | Wonder stopped before the required inspection and experiments | 13 | $1.331024 |
| 3 | 0/32 → 12/32 → 32/32 | 20/20 | Accepted and published to JUJUMP | 17 | $1.717993 |

Sessions 1 and 3 reached 32 of 32 development checks on their third candidate, then passed all 20 unseen acceptance checks. Both also published through the JUJUMP integration. Session 2 produced no candidate, so the evidence-gathering gate remains a real way for a session to fail.

This is a small exploratory sample. It is not merged with the earlier protocols' outcomes, and the public site's controller still comes from the original accepted session. `node scripts/verify-wonder-harness.mjs --v5 --replay` checks the exact reports and replays both accepted sources against the donor, with no model request.
