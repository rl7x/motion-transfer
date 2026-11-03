# Add the recovered dash to a game

This component reproduces one declared movement boundary at **60 updates per second**, in **source pixels**. It is not a complete game engine. Start with `contract.json`, `component.js`, and `provenance.json`; preserve their bytes and keep the donor [ISC notice](../../targets/dashy-dango/NOTICE.txt) with new distributions. The host mapping and collision policy are your responsibility.

The component exports `init(config)` and `step(state, input, config)`. Pass the exact contract defaults to both. `input` is `{buttons, sourceBodyWidth: 8}`: dash is bit 1, left 16, right 32, up 64, down 128. A step returns `{state, output: {displacement: {x, y}, ownsMotion, events}}`. Retain its next state. Events are `dash-start` and `dash-end`.

When `ownsMotion` is true, apply the component's horizontal displacement multiplied by your explicit unit scale. Otherwise preserve your game's ordinary motion. Keep gravity, jumping, spin, fuel and collisions under the game engine's control. Never copy the dash distance formula into your adapter or substitute a timer of your own.

For the supplied horizontal adapter probe, export:

```ts
init(motion, config) // returns JSON state; call motion.init(config.motion) exactly once
step(state, frame, motion, config) // returns {state, output}
```

`config` contains only `motion` (frozen component defaults) and `unitScale`. `frame` contains `tick`, `position`, `facing` (-1 or 1), `dash` (raw held button), `airborne`, and `normalDisplacement`. Call `motion.step` exactly once per adapter update, including inactive/grounded updates. Preserve `sourceBodyWidth: 8`. Encode activation/direction policy in the adapter, including previous raw button state for fresh-press activation. A press during cooldown is consumed; do not buffer it. The `airborne` gate blocks activation on the ground, not a dash that is already active.

The adapter output is `{displacement, ownsMotion, events, sweep}`. Use a scalar horizontal displacement, forward the component ownership/events unchanged, and provide monotonic intermediate collision-sweep offsets at gaps no larger than one recipient unit during owned movement. An inactive output has an empty sweep. Apply your engine's collision response to this proposed movement; the probe does not decide whether your character should stop or slide.

Use a fixed-step accumulator outside the adapter: accumulate elapsed time, run one adapter update for each 1/60 second, carry the remainder, and render separately. If the engine runs four native substeps per controller update, distribute that update's displacement across those four substeps; do not call the component four times. Clear input on blur and restart with a new initialized state.

```sh
npm run probe:integration -- path/to/adapter.ts --scale 0.1 --activation held --direction facing --gate airborne
```

Use `--gate always` when activation does not require airborne state; `--activation press` and `--direction opposite` select the other supported policies. The CLI probes the saved component. The programmatic `probeIntegration` API also accepts a verified accepted `componentRef` from `loadAcceptedComponent`.

The probe checks delegation, scaling, output/event timing, inactive motion, and counterfactual component outputs. A pass does **not** verify your game-loop scheduling, collisions, rendering or feel. Test those in the actual game, including landing during a dash, restart, a held button across landing, and different render frame rates. No independent developer adoption or productivity result is implied by the probe itself.
