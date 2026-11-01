# Dashy Dango → PAKU PAKU

The first playable transfer adds the [recovered Dashy Dango dash](../../components/dashy-dango-dash/README.md) to [Kenta Cho's PAKU PAKU](../../recipients/paku-paku/README.md). The recipient is MIT licensed and pinned without changing its upstream source.

`adapter.ts` is the unedited submission from **Muse Spark 1.3**. Its compiled `adapter.js` calls the frozen component on every game update. The first generation cost an estimated **$0.01361375**, within a $0.05 cap, and required one API request. Token usage, selected source, and the model's own mapping/limitations are preserved in `generation.json`; the original generation report correctly stops at conformance and does not claim later browser verification.

`receipt.json` records the accepted source, component, recipient, runtime, host/evaluator hashes, and evaluation file hashes. The preview checks this receipt before serving the adapter. `conformance.json` covers 11 cases / 602 updates, including counterfactual component outputs; `browser.json` covers eight checks in real Chrome: ordinary play, dash timing/direction, held activation, swept collisions/restart, power cookies, wraparound, attract replay, and display-rate independence. These checks establish the declared finite scope, not equivalence for every possible game state.

```sh
npm run dev:transfer
npm run verify:transfer
```

The verification command uses no Meta API. It recompiles the saved source and replays the frozen regression checks. Chrome is used by default; set `BROWSER_CHANNEL=chromium` if you have installed Playwright's Chromium instead.

Play the original beside the transfer at `http://127.0.0.1:4173`. Tap or press Space to turn. Hold D, or the preview's dash button, to dash. Both versions use the same explicit 60 Hz logical clock and seed 9. The default scale is 0.5: donor distance 60 becomes recipient distance 30, with the eight active ticks and cooldown retained. Separate dash input is preserved in the recipient's attract replay.

Human work includes selecting and instrumenting the recipient, supplying movement/draw ports, choosing the mapping policy, and writing the checks. Meta authored the adapter, not the entire integration harness. During recovery, the donor evidence was also selected by a human. This is a saved transfer; live remix generation and sharing are not implemented yet.

The model's third limitation in `generation.json` calls the sweep a visualization. The actual host draws those visible intermediate player glyphs into the engine's collision hitboxes. This is tested with an endpoint that clears the ghost but a path that crosses it. Collisions follow the original per-update order of dots then ghost; this does not introduce continuous chronological contact physics. The larger collision fixture uses scale 2 only in test mode, while the playable demo remains at 0.5.
