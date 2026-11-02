# Meta Global AI Developer Hackathon

**Event:** [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/)

**Project submission deadline:** November 4, 2026, at 9:00 p.m. ET

## Idea
My core idea is to do some component extraction and transfer between programs. I will start with some games first. I picked dashy dango cause i was thinking of a matcha parfait i had in kyoto, and dango came to mind.

## Try the extraction and transfer experience

```sh
npm install
npm run dev:transfer
```

Open `http://127.0.0.1:4173`. Play the compiled **Dashy Dango** donor and give its saved recovered dash to **RDSTR Stunts**, **PAKU PAKU**, or **JUJUMP**. The default Roadster experience adds a horizontal air dash to an existing 3D stunt game, using the exact same frozen controller as both pixel games. The page shows donor, recipient before, and recipient after side by side. **Watch the ability move** runs a short comparison using actual recorded native inputs without a model request. All players expand and support touch controls.

The frontend is React with strict TypeScript. See [the frontend guide](web/README.md) for component ownership, request reconnection and `typecheck`, `lint`, formatting, build and browser-test commands. The existing Node backend and verified game runtimes remain separate from the application UI.

**Use it in your project** opens the developer task: recover a mechanic from a compiled reference and integrate it into a platformer while keeping native physics. **Download working integration** exports a self-contained JUJUMP project with the exact frozen component, editable adapter, before/after players, source, notices, recovery failures and verification reports. Extract it, run `npm test`, then `npm start` with Node.js 22+. No dependency installation, key, donor cartridge or investigation backend is required. The standalone example can execute a matched open-air comparison and export the actual before/after traces. See [the developer handoff and its measurement limits](docs/developer-handoff.md).

**Recover for JUJUMP** starts a fresh Meta-led investigation through candidate development and separate frozen acceptance. Only a newly accepted candidate that also passes recipient checks and independent final-ZIP verification receives its own play/download links. The complete workflow passes local injected-client/runtime tests. The single new live attempt remains **incomplete**: Meta ran a real intervention and a later evidence-linked action, but did not inspect a function body or submit a candidate. Its unmodified recording is available without inference. See [the recovery task, measured spending and limitations](docs/recovery-handoff.md).

```sh
npm run export:jujump
npm run verify:integration
```

The first command writes `reports/exports/jujump-dash.zip`. The second extracts the ZIP into a fresh temporary folder, runs its Node checks and all seven existing JUJUMP browser scenarios on an independent static server. It records package identity, actual machine timings and traces in `reports/jujump-integration-verification.json`; `-- --save` refreshes the checked-in recording after a successful run. Saved verification is displayed only when its package and ZIP hashes match. Human effort and time savings have not been measured. This handoff reuses the saved recovery and makes no model request.

Use **Investigate with Meta** to let Muse Spark inspect code, continue a running cartridge, branch a replay checkpoint and compare a typed memory intervention against an unchanged control. The page shows hypotheses, branch identities, edits, actual movement/timer consequences, evidence-linked findings and selected framebuffer PNGs. The extraction workflow lets the model choose inspected functions, submit a new component, receive development divergence feedback, freeze it and run separate acceptance. See [the investigation toolset and its limits](docs/investigation-tools.md). Motion values and address hints use a disclosed human-mapped registry; this is not a claim that the model discovered its layout. New candidates do not replace the saved ability.

The [programmatic workbench](docs/programmatic-experiments.md) lets Meta submit one complete controlled experiment or a short isolated JS/TS program for sweeps and conditional follow-ups. The host restores checkpoints and creates both branches. **View local experiment program · no model** shows actual human-scripted measurements without inference. `npm run tools:experiment-smoke` reproduces it and compares the existing six-call workflow with two complete-workflow calls and one program call. Model round-trip and cost improvements are not inferred from that local comparison.

**View Meta experiment program · incomplete** preserves the single live programmatic trial: Meta chose a real position intervention and later read its evidence, but omitted function-body inspection. Completion was rejected. Its failed program's completed experiment survived the return-size limit. The run cost $0.14972375 with no unsettled reservation and was not retried; it does not claim a new recovery.

The Roadster form lets Meta generate a new adapter for distance, direction and held/fresh-press activation. Eight mapping cases and eight real-browser checks gate each playable child. Source, reports, parent lineage and local links are retained. The [Roadster integration policy](transfers/roadster/README.md) explains the 60/240 Hz bridge, meters conversion, collision behavior, attribution and finite scope.

**View local control experiment · no model** shows a human-scripted timer intervention with actual comparison traces, writer analysis and framebuffer images. **View recorded branch exploration · incomplete** preserves the new live Meta run, including its rejected completion check. Both load without inference; their origins and limitations remain visible.

New investigations and Roadster generation share a persistent **$10 estimated development ceiling**: up to $0.50 per investigation and $0.05 per adapter, no automatic retries, and no further inference when billing is uncertain. The existing PAKU remix budget stays at $0.10 separately. See [the lab API and accounting](lab/README.md). Loading or playing any saved destination makes no model request.

Choosing a destination loads a saved checked integration and makes no model call. The page distinguishes those saved results from fresh Meta remix generation. Real trace comparisons show the compiled donor, standalone component, and both recipient adapters using matching dash displacement and event timing. Recovery evidence, supported scope, human assistance, adapter authorship, sources, and policies are available in expandable sections.

Keyboard and touch controls work in each view. Donor: arrows and X. Roadster: Run stunt drives the assisted run, then X dashes in the air; native driving, rotation and lift controls remain. Pixel recipients: tap/Space to turn or jump, and D to dash after transfer. PAKU PAKU retains live child remixes, inherited edits, lineage, downloads, and local playable links. JUJUMP currently supports the saved transfer only. Historical PAKU parents and children remain usable after host re-verification when their verified adapter/component/recipient identities agree.

```sh
npm run verify:motion
npm run verify:transfer
npm run verify:jujump
npm run verify:roadster
npm run compare:transfers
npm test
```

These checks use no paid API. `verify:roadster` checks the saved Meta adapter against eight mapping cases and eight browser checks and writes `reports/roadster-verification.json`. Comparison inputs are controlled free-space fixtures; platform/ghost collisions, ordinary play, death/restart, and replay are checked separately. See [the JUJUMP integration policy](transfers/jujump/README.md) and [live remix scope](remix/README.md). Public hosting remains to be built; resolve the donor's documented redistribution status before publishing its cartridge.

## Run Dashy Dango

```sh
npm install
npm run dev
```

Open the local URL printed in the terminal (normally `http://localhost:4444`) and click the game to focus it. Press X to start, use arrow keys to move, and X to dash. The pinned cartridge and its provenance are in [targets/dashy-dango](targets/dashy-dango/README.md).

## Replay recorded inputs

```sh
npm run replay
npm test
```

The replay command runs the recorded start/move/dash sequence three times and checks that every frame matches. It saves observations to `reports/dashy-dango-replay.json`. See [runtime/README.md](runtime/README.md) for the API, trace format, and supported scope. Use Node.js 22 or newer.

## Investigate with Meta

Copy `.env.example` to `.env` and set `MODEL_API_KEY` locally. Then run:

```sh
npm run investigate
```

The model can inspect the pinned bytecode, follow direct function calls, and choose controlled replay experiments with typed memory watches. The default run has a $0.50 estimated generation budget, with token-count preflight before each request. Reports contain experiments, observations, token usage, and a conclusion for review. See [agent/README.md](agent/README.md) for details.

To check the tools locally without API calls:

```sh
npm run tools:smoke
npm run tools:session-smoke
```

This indexes the cartridge's functions, inspects the `update` export, and compares movement traces with read-only memory observations. It writes `reports/cartridge-tools-smoke.json`.

## Recover a motion component

```sh
npm run recover:motion -- --prepare-only
npm run recover:motion
```

The first command prepares binary and numeric trace evidence locally. The second asks Meta to generate a standalone controller, then checks it against independent donor rollouts. It has a $0.30 estimated budget and at most two synthesis calls. Passing candidates are exported with source, contract, evaluations, and provenance. See [component/README.md](component/README.md).

The first [recovered dash component](components/dashy-dango-dash/README.md) is saved with its source and evaluation history. Verify it locally without API calls:

```sh
npm run verify:motion
```

## Play the first transfer

```sh
npm run dev:transfer
```

Open `http://127.0.0.1:4173` to play Kenta Cho's **PAKU PAKU** beside a version using the recovered Dashy Dango dash. Tap or press Space to turn; hold D to dash in the transferred version. Both use the same normalized 60 Hz clock. The original recipient source stays pinned unchanged.

Muse Spark generated the adapter in one request for an estimated $0.014. The frozen component supplies the motion and timers; the human-built host supplies controls and collision hooks. The [saved transfer](transfers/paku-paku/README.md) includes the model submission, evidence, conformance and browser results, and a receipt binding those results to the code. The preview makes no model requests.

```sh
npm run verify:transfer
```

This rechecks the saved adapter and real browser integration without API calls. It needs Chrome, or an installed Playwright Chromium with `BROWSER_CHANNEL=chromium`.

## Remix a playable child

The preview includes a natural-language remix form. With `MODEL_API_KEY` in the server's `.env`, request a shorter/longer dash, backward dashing, or fresh-press activation. Meta writes a new adapter around the unchanged recovered component. The server compiles it, checks the complete inherited mapping, and runs the emitted game in Chrome before saving it. Unsupported or failed requests leave the parent playable.

An accepted child has a content-addressed `/play/<id>` URL, parent lineage, downloadable source/report, and an isolated player. Remix that child to keep its earlier changes. Games and cost reservations persist in ignored `reports/remixes/` across local server restarts. The first live backward/fresh-press remix cost an estimated **$0.0058745**, passed 12 mapping cases and six browser checks, and was played through the actual form and buttons.

Generation is serialized, capped at **$0.03 per request** and **$0.10 total** in the persistent local journal, and never automatically retried. Running the preview does not itself call Meta. Local playable links need this server to be available; public hosting is still to be built. See [remix/README.md](remix/README.md) for the supported scope and API.

To generate a new candidate deliberately, see [transfer/README.md](transfer/README.md). Generation is capped at an estimated $0.05; conformance alone does not publish a candidate to the preview.
