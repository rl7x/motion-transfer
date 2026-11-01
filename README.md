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

This indexes the cartridge's functions, inspects the `update` export, and compares movement traces with read-only memory observations. It writes `reports/cartridge-tools-smoke.json`. Component extraction and transfer are still to be implemented.
