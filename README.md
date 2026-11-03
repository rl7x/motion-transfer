# Motion Transfer

Borrow Dashy Dango's recovered dash, make it playable in PARALLAXIA, and compare alternatives from a paused moment.

The React workbench supports real Standard Meta generation, inherited mapping edits, deterministic checkpoint experiments, and one composition: dash-end → a native shot attempt on the next tick. Saved play is labeled reuse. JUJUMP demonstrates the same accepted component in a second game. Roadster remains accessible with its original artifact bytes.

The accepted component is `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858`. It supplies eight active updates and 25 inactive recharge ticks. Human-written hooks connect its outputs to each licensed upstream game. PARALLAXIA itself was not reverse engineered here. Meta generates adapters and the bounded host rule; the native shooter supplies its own enemies, shots, movement and collision rules.

## Play and create online

Open [Motion Transfer on Vercel](https://motion-transfer-rl7x.vercel.app). Judges can play the saved versions and create new PARALLAXIA remixes. New adapters pass the same 13 native and 3 browser checks in credential-free Vercel Sandbox microVMs before publication. The public whole-job cap is **$5, including at most one repair**, with two requests per browser session and the existing overall ledger limits.

Hosting uses Vercel Hobby's included quotas; generation uses Meta API credits. Free-tier exhaustion can pause the service. Saved versions and the authoritative spending ledger survive backend restarts. When this workspace's `.vercel/remote-generation.json` marker is present, the local preview stays playback-only to avoid duplicating the cloud allowance. See [Vercel hosting](docs/vercel-hosting.md) for the architecture and validation.

## Repository guide

| Folder | Contents |
| --- | --- |
| [`web/`](web/) | TypeScript and React workbench, browser entrypoints and local preview server |
| [`src/`](src/) | Agent orchestration, deterministic runtimes, evaluators, recipient integration and hosting |
| [`assets/`](assets/) | Pinned upstream games, recovered components, saved transfers and verification evidence |
| [`scripts/`](scripts/) | Command-line entrypoints used by the npm commands |
| [`tests/`](tests/) | Unit, browser, artifact-integrity and container-isolation checks |
| [`docs/`](docs/) | Architecture, measured results, setup and limitations |
| [`skills/`](skills/) | Repository-local motion-transfer skill |
| [`.github/`](.github/) | GitHub workflows |

Start with the [backend architecture](docs/backend-architecture.md) and [measured results](docs/live-mechanics-results.md). Saved game players bundle their engines into standalone HTML; `.gitattributes` identifies these build artifacts and upstream sources so GitHub's language statistics describe the application code.

## Play without inference

Node.js 22 or newer. This builds an explicitly labeled baseline reuse copy; it makes no provider request.

```sh
npm ci
npm run build:release -- --recipient parallaxia --reuse-baseline --output reports/release-parallaxia-reuse
npm run serve:release -- --root reports/release-parallaxia-reuse --port 4174 --base-path /motion-transfer/
```

Open `http://127.0.0.1:4174/motion-transfer/`. The server binds loopback only. Arrows/WASD move, Space/Z shoots, and X dashes. Native play adds no invulnerability. The separately labeled practice challenge has a shield and measures position; it makes no survival claim. Default scaling maps the donor's 60 source pixels to six world units, rendered at ten pixels per world unit.

The measured generated release is already built in this workspace at `reports/release-parallaxia/`. It features the successful right-goal experiment and includes its exact parent, all campaign children, both unsuccessful diagnostics, same-component JUJUMP, source, rules, notices and ZIPs. Experiment ZIPs contain a self-contained React `replay.html`. See [measured results and the rebuild command](docs/live-mechanics-results.md). Gitignored reports are not automatically present in a fresh clone; the generated release tree can be distributed on its own.

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

Neither repair in the frozen run produced a passing goal. A separate development rule-removal job did repair a rejected nonliteral module into an accepted removal; that original failure remains recorded. The full task table, individual costs, failed development attempts, exact identities, and scope are in [the measured results](docs/live-mechanics-results.md) and [implementation record](docs/live-mechanics-progress.md).

The frozen campaign's $50 ledger snapshot recorded $2.16501937 in estimated usage, $1.045174398 in retained reservations, and $46.789806232 remaining, including three bounded-unknown charges. Its 31 reservations and the original allowance migration remain preserved. Current generation is accounted for in the authoritative cloud journal. Whole-job reservations of $5 or more use the existing reserve allocation, since prior remix charges remain in the unchanged $5 remix category. Historical $0.15 reservations retain their original bounds. These are ledger estimates, not a verified provider balance or an accounting of every historical CLI charge.

## Validation and historical evidence

Run `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`. The full suite includes browser and restricted Docker checks. `npm run verify:release -- --root reports/release-parallaxia` checks the actual PARALLAXIA release. It system-extracts the exact ZIP, blocks external requests, checks normal-speed paired replay and tests a nested base path. Actual results and limitations are recorded in [local validation](docs/local-validation.md).

The historical worker publication rejection did not reproduce on this Mac. Direct worker gates and the full hosting-isolation check passed without weakening publication requirements. Rejected worker payloads are retained for diagnosis. The local coordinator image has no Docker socket, generated-code execution, compiler or evaluator; Standard generation runs only after explicit operator configuration. The public Vercel deployment uses separate microVM workers. See [hosting](docs/hosting.md) and [Vercel hosting](docs/vercel-hosting.md).

Historical evidence stays separate:

- [Wonder recovery and accepted Roadster/JUJUMP delivery](docs/fresh-recovery.md): 13 development checks and 20 separate acceptance checks on the accepted component.
- [Contact-sheet study](docs/fidelity-media.md): one supplied-defaults candidate scored 0/40 versus the older saved controller's 40/40. This is not a from-video recovery result.
- [Fixed Roadster remix set](docs/remix-results.md): six supported matches and two expected negatives on saved component `1bc4250c…`; this is a different campaign and component.
- [Muse Code](docs/muse-code.md): unpaid echo checks only; no new recovery campaign was run.

The accepted Roadster release remains available with `npm run build:release -- --accepted-roadster assets/transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c`. Historical preview views use `/?destination=roadster`, `/?destination=jujump` and `/?destination=paku-paku`. The new default workbench and `/accepted/jujump/` use the accepted component.

## Remaining scope

The left checkpoint goal failed within its bounded generation attempts. There is no arbitrary goal language, general level solver, arbitrary mid-dash state migration, second live recipient, or graze-token composition. Native enemy body contact retains its upstream position-sampled behavior; the dash does not add invulnerability, and native swept bullet checks stay active.

The public Vercel URL has passed live creation, playback, download and restart checks. Repository visibility changes, outreach, adoption studies, video and submission remain separate; no outside-user benefit is claimed. Richard handles video. The supplied active plan remains in the extracted Downloads handoff; [the implementation record](docs/live-mechanics-progress.md) resolves its historical paths against this checkout.

## Sources and licenses

Every outside source below allows this use, and each copy keeps its upstream notice. This project's own code is under the [MIT License](LICENSE), which does not cover the third-party work listed here. Licenses were checked on November 3, 2026.

Dashy Dango is upstream work by samX500 and willGuimont. PARALLAXIA, JUJUMP and PAKU PAKU are upstream work by Kenta Cho / ABA Games. The RDSTR Stunts car, renderer, track, stunt physics and audio are upstream work by sebayaki. Recovery tooling, recovered controllers, adapters, host hooks, deterministic experiments, composition and verification are the added project work. Each export retains its upstream notices.

### Games

| Source | Used for | Author | License | Notice in this repository |
| --- | --- | --- | --- | --- |
| [Dashy Dango](https://github.com/willGuimont/dashy-dango) at `9b899e8` | Compiled cartridge the dash was recovered from | samX500, willGuimont | ISC | [NOTICE.txt](assets/targets/dashy-dango/NOTICE.txt) |
| [PARALLAXIA](https://github.com/abagames/agentic-gamedev-games) at `f30b52a` | Live remix game | Kenta Cho / ABA Games | MIT | [LICENSE](assets/recipients/parallaxia/upstream/LICENSE) |
| [JUJUMP](https://github.com/abagames/crisp-game-lib-games) | Saved transfer | Kenta Cho / ABA Games | MIT | [LICENSE.txt](assets/recipients/jujump/upstream/LICENSE.txt) |
| [PAKU PAKU](https://github.com/abagames/crisp-game-lib-11-games) | Saved transfer | Kenta Cho / ABA Games | MIT | [LICENSE.txt](assets/recipients/paku-paku/upstream/LICENSE.txt) |
| [RDSTR Stunts](https://github.com/sebayaki/roadster) at `8486687` | Saved transfer | sebayaki | MIT | [LICENSE](assets/recipients/roadster/upstream/LICENSE) |
| [BLINK SCOPE, DRAFT LINE, HEAD RUSH, OVERTURN, PILEUP, SKYHAUL, TWIN VECTOR, UNDERTOW, WRECKFALL and ZIG SABER](https://github.com/abagames/agentic-gamedev-games) at `f30b52a` | Unseen games for the auto-port campaign | Kenta Cho / ABA Games | MIT | [LICENSE](assets/auto-port/LICENSE) |

The Dashy Dango repository has no `LICENSE` file, so GitHub shows no license for it. The authors declare ISC in the `wapm.toml` at the pinned revision and in the [Wasmer package](https://wasmer.io/willguimont/dashy-dango), and that package's cartridge is byte-identical to the one used here.

### Libraries shipped to players

| Library | Used for | License |
| --- | --- | --- |
| [WASM-4](https://github.com/aduros/wasm4) 2.7.1 | Runs the Dashy Dango cartridge | ISC |
| [crisp-game-lib](https://github.com/abagames/crisp-game-lib) 1.1.1 | JUJUMP and PAKU PAKU runtime | MIT |
| [sounds-some-sounds](https://github.com/abagames/sounds-some-sounds) 3.0.0 | JUJUMP and PAKU PAKU audio | MIT |
| [three.js](https://github.com/mrdoob/three.js) 0.186.1 | RDSTR Stunts rendering | MIT |
| [React and React DOM](https://github.com/facebook/react) 19.3.1 | Web interface | MIT |

### Tools used to build, test and host

These are not shipped to players.

| Tool | Used for | License |
| --- | --- | --- |
| [WABT](https://github.com/WebAssembly/wabt) 1.0.39 | Decompiling the cartridge for recovery evidence | Apache-2.0 |
| [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) 0.32.0 | Running generated code in the evaluator | MIT |
| [Playwright](https://github.com/microsoft/playwright) 1.64.1 | Browser verification | Apache-2.0 |
| [TypeScript](https://github.com/microsoft/TypeScript) 6.0.3 | Type checking and adapter compilation | Apache-2.0 |
| [esbuild](https://github.com/evanw/esbuild) 0.28.2 | Bundling | MIT |
| [ESLint](https://github.com/eslint/eslint) 10.14.0, [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) 8.72.1, [Prettier](https://github.com/prettier/prettier) 3.9.10 | Linting and formatting | MIT |
| [@vercel/sandbox](https://www.npmjs.com/package/@vercel/sandbox) 3.9.1 | Hosted backend and verifier microVMs | Apache-2.0 |

Every other installed npm package is MIT, ISC, Apache-2.0, BSD or BlueOak-1.0.0, except `caniuse-lite` (CC-BY-4.0). That one comes in through the lint tooling and is not shipped.

### Hosted services

Muse Wonder 1.0 and Muse Spark 1.3 are used through the [Meta Model API](https://dev.meta.ai/products/meta-model-api), and the site runs on [Vercel](https://vercel.com). Both are used under their service terms. They are not open-source components of this repository.

### Design inspiration

The pixel-arcade look was inspired by [moa](https://trymoa.work). Its [repository](https://github.com/petersenmatthew/moa) has no license, so none of its code or assets are used here.
