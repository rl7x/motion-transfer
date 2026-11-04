# Running it, measured results and limits

Setup, spending, measured results and remaining limits, in detail. For the design, see [architecture](architecture.md).

## Hosted site and its limits

Open [Motion Transfer on Vercel](https://motion-transfer-rl7x.vercel.app). Judges can play the saved versions and create new PARALLAXIA remixes. New adapters pass the same 13 native and 3 browser checks in credential-free Vercel Sandbox microVMs before publication. The public whole-job cap is **$0.50, including at most one repair**, with two requests per browser session and the existing overall ledger limits.

Hosting uses Vercel Hobby's included quotas; generation uses Meta API credits. Free-tier exhaustion can pause the service. Saved versions and the authoritative spending ledger survive backend restarts. When this workspace's `.vercel/remote-generation.json` marker is present, the local preview stays playback-only to avoid duplicating the cloud allowance. See [Vercel hosting](vercel-hosting.md) for the architecture and validation.

## Play without inference

Node.js 22 or newer. This builds an explicitly labeled baseline reuse copy; it makes no provider request.

```sh
npm ci
npm run build:release -- --recipient parallaxia --reuse-baseline --output reports/release-parallaxia-reuse
npm run serve:release -- --root reports/release-parallaxia-reuse --port 4174 --base-path /motion-transfer/
```

Open `http://127.0.0.1:4174/motion-transfer/`. The server binds loopback only. Arrows/WASD move, Space/Z shoots, and X dashes. Native play adds no invulnerability. The separately labeled practice challenge has a shield and measures position; it makes no survival claim. Default scaling maps the donor's 60 source pixels to six world units, rendered at ten pixels per world unit.

The measured generated release is already built in this workspace at `reports/release-parallaxia/`. It features the successful right-goal experiment and includes its exact parent, all campaign children, both unsuccessful diagnostics, same-component JUJUMP, source, rules, notices and ZIPs. Experiment ZIPs contain a self-contained React `replay.html`. See [measured results and the rebuild command](live-mechanics-results.md). Gitignored reports are not automatically present in a fresh clone; the generated release tree can be distributed on its own.

## Create a real PARALLAXIA child locally

Use the existing reconciled `reports/motion-transfer-phase/phase-budget.json`, Docker, and `MODEL_API_KEY` in the ignored `.env`. Do not create a new ledger to replace the restored history.

```sh
npm run hosting:image
npm run dev:transfer
```

Open `http://127.0.0.1:4173/`. Opening, playing, comparing and downloading saved versions makes no model request. Generate submits a real Standard Muse Spark request. The parent stays available while restricted workers verify the new source and exact Canvas frame. One reservation caps the entire job at $7, including at most one repair. Refresh reconnects with the same request key; restart preserves completed children and does not repeat interrupted inference. The local operator preview has no per-session request count limit; public hosting keeps its two-jobs-per-session quota. Both retain the spending checks and one active job at a time. The persistent age/privacy/model banner has been removed; age confirmation appears only when creating.

The **Saved generations** picker above the game keeps every published candidate available. Choose an earlier version and click **Play version**, return to the original, or play its parent. The list refreshes after publication and survives browser refresh and server restart; reopening a saved version makes no model request. Goal-unsatisfied experiments remain labeled and open their comparison while retaining the original. Each version links to its exact download and verification.

Supported mapping edits are distance scale, facing/opposite direction, and held/fresh-press activation. Follow-ups inherit unspecified properties. Pause your flight or select the labeled curated checkpoint, freeze a supplied target and constraints, then generate an alternative. Both branches reconstruct the same starting state and use the same declared future native Shoot controls; the candidate's changed dash tick is shown. A failed goal keeps the original. Checkpoints are bounded to 3,600 historical updates, and experiments to 120 future updates.

The only composition is a human-authored scheduler driven by a Meta-generated declarative rule. It attempts one native shot after dash-end, respecting native cooldown and projectile cap; suppressed attempts are consumed. It cannot mutate the recovered controller or enemy/life state. Removing the rule preserves the inherited mapping.

## Measured results

The ten-task manifest was frozen before the real campaign at `bf7cd14`. **8/9 positive tasks passed; 1/1 deliberately infeasible task was correctly unsuccessful.** Eight jobs used ten provider responses, estimated **$0.090081**. This selected tool-driven set is not a general reliability estimate, an adoption study, or a measurement of human time saved.

| Task | Actual outcome |
| --- | --- |
| New transfer and two inherited edits | All passed; 11.413–12.052 seconds from admission through verified publication. |
| Two checkpoint goals | Right passed in 18.604 seconds; left reached its target but lost a life and remained unsuccessful after repair. |
| Infeasible target | Correctly unsuccessful in 25.146 seconds, with target and collision constraints unchanged. |
| Add and remove composition | Both passed; 7.889 and 9.664 seconds. Mapping stayed fresh-press/opposite/half-distance. |
| JUJUMP export and restart/replay | Passed from exact saved bytes, without another provider request. |

Neither repair in the frozen run produced a passing goal. A separate development rule-removal job did repair a rejected nonliteral module into an accepted removal; that original failure remains recorded. The full task table, individual costs, failed development attempts, exact identities, and scope are in [the measured results](live-mechanics-results.md) and [implementation record](live-mechanics-progress.md).

The frozen campaign's $50 ledger snapshot recorded $2.16501937 in estimated usage, $1.045174398 in retained reservations, and $46.789806232 remaining, including three bounded-unknown charges. Its 31 reservations and the original allowance migration remain preserved. Current generation is accounted for in the authoritative cloud journal. Public jobs reserve $0.50 from the remix category, so a job with an unconfirmed bill stays held without stopping later visitors. Whole-job reservations of $5 or more use the existing reserve allocation. Historical $0.15 reservations retain their original bounds. These are ledger estimates, not a verified provider balance or an accounting of every historical CLI charge.

## Validation and historical evidence

Run `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`. The full suite includes browser and restricted Docker checks. `npm run verify:release -- --root reports/release-parallaxia` checks the actual PARALLAXIA release. It system-extracts the exact ZIP, blocks external requests, checks normal-speed paired replay and tests a nested base path. Actual results and limitations are recorded in [local validation](local-validation.md).

The historical worker publication rejection did not reproduce on this Mac. Direct worker gates and the full hosting-isolation check passed without weakening publication requirements. Rejected worker payloads are retained for diagnosis. The local coordinator image has no Docker socket, generated-code execution, compiler or evaluator; Standard generation runs only after explicit operator configuration. The public Vercel deployment uses separate microVM workers. See [hosting](hosting.md) and [Vercel hosting](vercel-hosting.md).

Historical evidence stays separate:

- [Wonder recovery and accepted Roadster/JUJUMP delivery](fresh-recovery.md): 13 development checks and 20 separate acceptance checks on the accepted component.
- [Contact-sheet study](fidelity-media.md): one supplied-defaults candidate scored 0/40 versus the older saved controller's 40/40. This is not a from-video recovery result.
- [Fixed Roadster remix set](remix-results.md): six supported matches and two expected negatives on saved component `1bc4250c…`; this is a different campaign and component.
- [Muse Code](muse-code.md): unpaid echo checks only; no new recovery campaign was run.

The accepted Roadster release remains available with `npm run build:release -- --accepted-roadster assets/transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c`. Historical preview views use `/?destination=roadster`, `/?destination=jujump` and `/?destination=paku-paku`. The new default workbench and `/accepted/jujump/` use the accepted component.

## Remaining scope

The left checkpoint goal failed within its bounded generation attempts. There is no arbitrary goal language, general level solver, arbitrary mid-dash state migration, second live recipient, or graze-token composition. Native enemy body contact retains its upstream position-sampled behavior; the dash does not add invulnerability, and native swept bullet checks stay active.

The public Vercel URL has passed live creation, playback, download and restart checks. No outside-user benefit is claimed. [The implementation record](live-mechanics-progress.md) has the full history.
