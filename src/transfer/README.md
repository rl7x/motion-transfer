# PAKU PAKU motion adapter

The recipient is one-dimensional. Its original movement is automatic, and tapping reverses facing. A transfer adapter must map facing and a separate held dash control into the recovered controller, project the controller's horizontal displacement into recipient units, and preserve recipient movement while `ownsMotion` is false.

The host supplies two narrow hooks: a movement request at the original movement line, and a draw hook before the original player sprite. It preserves the game's own wraparound, dot processing, ghost movement, score, power-cookie rules, and death/restart logic. The original source remains pinned unchanged; the hooked variant is constructed from two checked replacements.

The adapter exports:

```ts
init(motion, config): State
step(state, frame, motion, config): {
  state: State;
  output: {displacement: number; ownsMotion: boolean; events: string[]; sweep: number[]};
}
```

`motion` supplies the frozen component's `init` and `step`. `config` contains `motion` defaults and `unitScale` (0.5 for the demo). `frame` contains `tick`, `position`, `facing`, `normalDisplacement`, and `dash`. Source geometry remains 8 even though recipient sprites differ. Normal movement is passed through exactly. Active movement uses source pixels per 60 Hz tick multiplied by `unitScale`; scaling must not change duration or cooldown.

`sweep` contains intermediate offsets from the start position, excluding the endpoints, with monotonic gaps no larger than one recipient pixel. The host draws those player hitboxes before the ordinary sprite. That feeds the existing engine's dot/ghost collision checks, including paths that would otherwise skip a collision. Original wraparound applies to the final position; there is no collision segment drawn across the wrap teleport. Contacts follow the recipient's existing per-update order (dots, then ghost), not a new continuous-time physics claim.

The added D key is captured separately from the original turn input. Dash inputs are recorded alongside the game's own input replay; the component resets on each new live/replay life. Browser tests exercise real game logic and hitboxes. Test fixtures for inactive or deliberately high-speed adapters are labeled and cannot pass the conformance gate.

Candidate adapters run in a separate bounded process with no credentials, imports, randomness, or donor runtime. Checks require exactly one component initialization and one component step per logical update, independent motion/event agreement, recipient speed preservation, fixed source geometry, and bounded collision sweeps. Counterfactual component outputs check that the adapter uses the supplied implementation rather than duplicating its numbers.

`npm run transfer:paku -- --prepare-only` saves the integration evidence without reading credentials or calling Meta. `npm run transfer:paku` uses Muse Spark 1.3 with minimal reasoning, at most two requests, token-count preflight, a $0.05 estimated generation cap, and retained reservations on unknown billing. A failed conformance check can drive one repair from public feedback. Incomplete or ambiguous responses stop without automatic retry. Candidate reports say `conformant` and `browserVerified: false`; passing this stage alone cannot claim a verified playable transfer.

The first [saved transfer](../../assets/transfers/paku-paku/README.md) is now playable with `npm run dev:transfer`. `npm run verify:transfer` replays its conformance and browser checks with no model calls. Source, compiled JavaScript, generation evidence, and both evaluations are checked against a receipt before the server loads it. Runtime/host changes make that receipt stale rather than silently retaining a verification claim.

For an unsaved candidate, run `npm run verify:transfer -- --candidate reports/transfers/<run-id>`. It records browser and conformance results in the run directory. Adding `--save` writes a new immutable `transfers/paku-paku/versions/<id>/` package after both gates pass, then atomically updates `current.json`. Earlier packages remain intact. The generator never automatically promotes a candidate. Candidate execution is a local development tool, not a sandbox for accepting public uploads.
