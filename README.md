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
