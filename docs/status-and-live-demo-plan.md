# Implementation status and PARALLAXIA demo plan

> **Historical.** This records the project as it stood earlier in the hackathon, and some of it is out of date. For the current state, see the [README](../README.md).

Updated November 3, 2026 after implementing M0–M4 on `feat/parallaxia-live-mechanics`, based on merged main `a0aed8e`. The active plan remains in the extracted Downloads handoff. Its old Mac paths, branch names and references to uncommitted work are historical. Main has not been changed by this implementation.

| Area | Current result |
| --- | --- |
| Recipient and component identity | Independent PARALLAXIA artifacts, reports and notices use accepted component `54465741…`; historical Roadster URLs retain original bytes. Same accepted component runs in JUJUMP. |
| Live generation | Real Standard Meta requests produce restricted-worker-verified, playable children; follow-ups preserve inherited intent. Refresh/restart reconnect without another provider request. |
| Pause and compare | Browser and worker reconstruct the same checkpoint, freeze target and native/no-life-loss constraints, and reproduce both end digests at normal speed. |
| Composition | Dash-end schedules one next-tick native-shot attempt. Native cooldown/cap apply; removing it preserves the mapping. |
| Frozen tasks | 8/9 positive tasks passed; 1/1 infeasible task correctly unsuccessful. Left goal reached its region but lost a life after both candidates. Estimated campaign inference $0.090081, ten responses. |
| Release | Actual generated PARALLAXIA release in `reports/release-parallaxia/`, with exact ZIPs, parent, paired replay, component, rule, notices and all diagnostics. Clean-start and nested-base-path browser checks passed. |
| Isolation and tests | The historical publication rejection did not reproduce here; direct gates and hosting-isolation passed without relaxed requirements. See [current local validation](local-validation.md) for the full-suite checkpoint. |
| Public availability | No deployment, visibility change, outside-network verification or submission was performed. Richard owns video. |

Use [the measured results](live-mechanics-results.md) for individual times, costs, immutable versions, reproduction commands and limits, and [the implementation record](live-mechanics-progress.md) for reconciliation and retained development failures. Saved playback remains labeled reuse; practice is shielded and makes no survival claim. A finite unshielded success is not general beatability. The older contact-sheet and recovery results remain separate.

## Historical assessment before live mechanics

The assessment and presentation guidance below are retained to explain the original findings. Their branch, component, route, hosting and test descriptions predate M0–M4 and are superseded by the current results above. They are not another implementation or video task list.

Assessment on November 3, 2026. Code checkpoint: `c90eaa9`, plus the local, uncommitted PARALLAXIA showcase changes inspected below. The feature branch is `codex/playable-motion-remixes`; [PR #7](https://github.com/rl7x/meta-ai-developer-hackathon/pull/7) contains the committed checkpoint. The PARALLAXIA changes were not committed or modified during this assessment.

PARALLAXIA is the featured challenge. Roadster remains historical and accepted-delivery evidence. The current local PARALLAXIA preview works, but the public release and its recipient-specific evidence have not caught up with that change.

## Implementation against the plan

| Plan objective | Status | Evidence or remaining work |
| --- | --- | --- |
| Play, borrow, and see a gameplay difference | Working locally | PARALLAXIA's assisted pilot finishes outside the target without the dash and inside it with the dash. Three new recipient tests pass. The challenge currently shields both runs from losing lives. |
| Fresh Meta recovery and exact-component delivery | Achieved for Roadster and JUJUMP | Wonder improved through 0/13, 11/13, and 13/13 development checks, then passed 20 separate acceptance checks. The original campaign's export failure remains recorded; later publication delivered that exact component. |
| Fresh accepted component in the featured recipient | Pending for PARALLAXIA | The new preview uses saved component `1bc4250c…`. The newer accepted component is `54465741…`, currently evidenced in the Roadster/JUJUMP pins. |
| Meaningful remixes and inheritance | Implemented and measured on the older Roadster pipeline | Six supported requests matched; two negative cases behaved correctly. The new PARALLAXIA preview reuses those adapters, but the existing generation and verification records are Roadster records. |
| Fidelity comparison | Partial | One contact-sheet attempt with supplied defaults scored 0/40; the saved component scored 40/40. Video localization failed, so this is an image-input comparison. The planned human by-feel condition is missing. |
| MCP and Muse Code | Tooling present; recovery unproven | Server, gates, integration guidance/probe, and 13 unpaid echo checks exist. No paid clean-room recovery or j/3 result. |
| Recovery reliability | Not measured | No frozen ten-trial result. Contributor development has not produced an accepted delivery. One accepted Wonder component is not a reliability estimate. |
| Public play/create/share | Partial implementation, no public service | Static packaging exists for Roadster; local PARALLAXIA preview exists. The creator UI and budget controls exist, but hosted generation remains disabled and isolation publication has a failing test. |
| Independent impact | Not established | No external creator sessions, external developer integrations, or public-use counts are recorded. |
| Submission readiness, excluding video | Incomplete | GitHub still reports PRIVATE. The supplied guide requires a public repository. No public play URL or platform submission is recorded. |

Sources: [implementation checklist](motion-transfer-implementation.md), [fresh recovery](fresh-recovery.md), [remix results](remix-results.md), [fidelity study](fidelity-media.md), [submission readiness](submission-readiness.md), and the supplied plan and participant guide in Downloads. Their suggested study sizes are plan targets, not official rubric requirements.

## Rubric estimate, excluding Demo

These are provisional judgments, not judge scores. The three included categories total 75 points; Demo is neither scored nor assigned zero.

| Category | Estimate / 10 | Weighted points | Reason |
| --- | ---: | ---: | --- |
| Impact, 30% | 6 | 18 / 30 | A concrete developer use case and playable results, but no independent use or demonstrated benefit outside author testing. |
| Meta AI tooling, 25% | 8 | 20 / 25 | Substantial model investigation, synthesis, repair, acceptance, adapter generation, and bounded remixes. Missing repeatability measurements and a real Muse Code recovery limit the strongest claims. |
| Technical depth and execution, 20% | 8 | 16 / 20 | Strong finite behavioral checks, exact accepted-component delivery, portable artifacts, and budget controls. Hosting remains unfinished, and the new recipient needs its own consistent release identity and evidence. |
| Total assessed | | **54 / 75** | **72% of the available non-demo points.** Expect reasonable judges to differ; this is roughly a 7/10 case, not yet the plan's 9–10 case. |

The highest-return work is to finish PARALLAXIA's evidence/release binding, publish a working static build and the required repository, and observe independent use. Finishing hosted creation would complete the creator promise. A properly gated reliability campaign and a real Muse Code run would strengthen the Meta score. Extra destinations alone do not establish these missing outcomes.

## PARALLAXIA findings that affect the claims

1. **The verified challenge outcome is position.** `web/parallaxia-challenge-entry.js` enables `parallaxiaChallengeShield`; `src/parallaxia/sim.mjs` then records hits without applying the ordinary loss-of-life behavior. Both comparison runs are shielded. The pass/fail condition checks final horizontal position. Describe this as an assisted movement challenge; a claim that the dash is necessary to survive needs a separate unshielded check.
2. **Phasing is a host policy.** The integration also suppresses `missShip` while dashing. The recovered component supplies movement timing and displacement. Bullet immunity is not recovered donor combat behavior.
3. **Some displayed evidence still belongs to Roadster.** `web/experience-assets.mjs` serves new PARALLAXIA frames while exposing the saved Roadster artifact ID, report, presentation evidence, and notices on several existing routes. `web/server.mjs` likewise rebuilds a PARALLAXIA frame behind a Roadster artifact URL. Preserve the old pins and give the new delivery its own identity, matching verification and notices.
4. **Static release selection remains Roadster-specific.** `src/release/collect.mjs`, `src/release/accepted.mjs`, and `src/release/materialize.mjs` still collect and describe Roadster. The existing accepted build at port 4174 is a Roadster build. Rebuilding the shared frontend alone would not complete a PARALLAXIA release.

None of these findings requires rewriting the historical artifacts or ledger. The current PARALLAXIA tests verify upstream file hashes, movement comparison, component execution, and a standalone browser frame; they do not establish unshielded survival or a complete recipient-specific public release.

## Validation observed

- `node --test --test-concurrency=1 tests/parallaxia-recipient.test.mjs tests/roadster-experience.test.mjs`: **6/6 passed**, no skips.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed on the current working tree.
- A fresh local preview constructed without a model client displayed PARALLAXIA, completed `Watch borrowed dash` with `Reached the safe zone!`, and reported saved component `1bc4250c…` and `shield: true`.
- The existing accepted Roadster bundle still played both outcomes. Its JUJUMP comparison passed and reported 8 to 30 horizontal pixels over eight updates, with maximum vertical difference about `7.1e-15` pixels. This is evidence for that accepted bundle, not for PARALLAXIA.
- The last **full** suite checkpoint remains **339/340 passing**, with the Docker worker publication test failing. It predates the PARALLAXIA changes. The full suite was not repeated for this assessment. See [local validation](local-validation.md).
- No new model call, agent session, deployment, or video render was started for this assessment. Temporary inspection servers were closed.

## Demo structure borrowed from Moa

The [Moa demo](https://www.youtube.com/watch?v=K_pESfSqoDQ), embedded at [trymoa.work](https://trymoa.work/), follows one simulated billing problem through visible agent work, source evidence, human guidance, and resolution. Its transcript and sampled video frames were inspected. Use that single-case progression here: show a goal, borrow the move, inspect one real model decision, let the user act, and keep the result.

The strongest current story is **Dashy Dango's move becomes a playable PARALLAXIA ability, then runs in another game using the same saved component**. Keep the ship, bullet curtain, dash afterimages, green target, and result text large enough to see. The full-width player has substantial empty space around its portrait canvas; frame the portrait playfield together with the relevant controls and result. In a live presentation, use `Expand` and rehearse the display size beforehand.

## Three-minute live walkthrough

This script uses existing saved playback and recorded model evidence. The model did its work before the presentation. It requires no paid request during the walkthrough.

| Time | On-screen action | Suggested narration |
| --- | --- | --- |
| 0:00–0:10 | Pre-open `/donor/play`. Start Dashy Dango with X and show one dash. | “This move lives inside a compiled game. I want to use its behavior in a completely different game.” |
| 0:10–0:26 | Switch to the PARALLAXIA challenge, expand it, and click **Watch original**. Keep the final result visible. | “Here is PARALLAXIA. Our recorded pilot finishes outside this target. This is an assisted movement challenge, with a practice shield.” |
| 0:26–0:43 | Click **Watch borrowed dash**. Let the full run finish; hold on **Reached the safe zone!** | “Same pilot inputs. Add the recovered burst, and the ship reaches the target. The eight-update dash and recharge come from Dashy Dango; we authored the shooter integration.” |
| 0:43–1:15 | Close the large view. Open **Explore the recovery, source and verification** and **View recorded investigation · no model call ↗**. Preselect one readable recorded experiment. Keep the component history available in a second tab. | “Meta received compiled instructions and measured behavior. Muse Wonder generated the saved controller, and Muse Spark repaired it. We supplied the boundary and tests. The component history retains failures; the final saved version passed 20 fresh acceptance traces. This is recorded model work.” |
| 1:15–1:40 | In another preview tab, open `/?destination=jujump`. Jump with Space, then dash with D on the transferred side. Show the matching saved component identity if visible. | “The same saved controller also runs here. JUJUMP keeps its own jumping and gravity. Each game supplies an adapter around the reusable movement component.” |
| 1:40–2:05 | Return to PARALLAXIA. Click **Borrow dash**, then **Launch ship**, and perform a rehearsed manual X dash. | “Now I choose the timing. This is an executable ability in a running game. Borrowing and playing do not call a model.” |
| 2:05–2:30 | Click **Download playable game** and show the downloaded challenge files. Open the component source or integration guide. Rehearse opening the exported `play.html` before presenting it live. | “The useful output is something a developer can keep: a playable challenge, the adapter, the recovered component, and the checks. The supported behavior and the human-written integration are documented.” |
| 2:30–3:00 | Return to the shooter; replay the borrowed result while closing. Finish on the target result, with upstream credits visible in a brief final card or footer. | “For indie developers and game-jam creators, the goal is to turn observed game behavior into a reusable building block. We have demonstrated one recovered dash and several integrations. Motion Transfer: borrow a move, make it playable, and keep it.” |

Each assisted run lasts approximately 12.8 seconds. The script allocates full runs; it does not require concealing generation time or speeding up the simulation. For a polished edit, a short result preview may precede the donor shot, followed by the complete comparison.

### Presenter setup

- Use the current local preview at `http://127.0.0.1:4173/` after starting `npm run dev:transfer`. Opening and playing do not start a model request; the adaptation submission controls can. This assessment used a temporary preview without a model client.
- Open separate tabs for the PARALLAXIA challenge, `/donor/play`, and `/?destination=jujump`. Keep the recorded investigation and [saved component history](../assets/components/dashy-dango-dash/README.md) ready before the timer starts.
- The local preview currently says **SAVED RECOVERY**, component `1bc4250c…`. Keep that label. The accepted Roadster/JUJUMP release on port 4174 uses a different component, `54465741…`.
- Rehearse one manual dash around the recorded demonstration's trigger, tick 636, approximately 10.6 seconds into the assisted run. A held button can retrigger after recharge; a single short press makes the intended example clearer.
- Keep the green target and result line visible. The current evidence supports reaching that target; it does not establish that the unmodified ship would die.
- Verify the exported PARALLAXIA challenge opens before including the cold-export action. The standalone frame passed its browser test; this assessment did not perform a separate end-to-end ZIP cold-start test.
- Credit Dashy Dango's authors and Kenta Cho / ABA Games. The games are upstream; recovery tooling, the component, adapters, host policies, and the challenge are the added work.

### Strong upgrade after the recipient workflow is complete

Once PARALLAXIA has its own verified remix delivery and export, replace the manual retry with: **“Make it backward, only on a fresh press”**, followed by **“Half as far.”** Show the first child, then show that the follow-up keeps direction and activation while changing distance. This is the closest equivalent to Moa's human-steering moment.

The fixed Roadster campaign already demonstrates those intent/inheritance cases. A new PARALLAXIA model request needs recipient-specific verification before the same claim can be made for this showcase. Public generation is currently disabled. A recorded successful generation can be used if clearly labeled, with its actual latency disclosed.

### Backup evidence for questions

- **Fresh recovery:** [Wonder's later accepted component](fresh-recovery.md) passed 13 development and 20 separate acceptance checks and was subsequently delivered to Roadster and JUJUMP. It is a separate artifact from the current PARALLAXIA preview.
- **Fidelity:** [one frozen contact-sheet comparison](fidelity-media.md), 0/40 versus saved controller 40/40. No broad claim about video reconstruction or developer time saved follows from it.
- **Remixes:** [six supported matches and two expected negatives](remix-results.md), with the original Roadster lineage retained.
- **Scope:** one mapped donor behavior, finite tests, human-authored boundaries and host rules. Independent adoption and recovery reliability remain unmeasured.

The earlier [demo script](demo-script.md) describes a Roadster cut. Keep it as historical recording guidance; use this PARALLAXIA plan for the new featured walkthrough.
