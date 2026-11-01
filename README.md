# Meta Global AI Developer Hackathon

**Event:** [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/)

**Project submission deadline:** November 4, 2026, at 9:00 p.m. ET

## Idea
My core idea is to do some component extraction and transfer between programs. I will start with some games first. I picked dashy dango cause i was thinking of a matcha parfait i had in kyoto, and dango came to mind.

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

This rechecks the saved adapter and real browser integration without API calls. It needs Chrome, or an installed Playwright Chromium with `BROWSER_CHANNEL=chromium`. Live remix generation and sharing remain to be built.

To generate a new candidate deliberately, see [transfer/README.md](transfer/README.md). Generation is capped at an estimated $0.05; conformance alone does not publish a candidate to the preview.
