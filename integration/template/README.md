# JUJUMP + recovered dash

A runnable developer handoff: a standalone movement component recovered from a compiled Dashy Dango build, integrated into JUJUMP while preserving its native gravity and landing behavior.

## Run the downloaded project

With Node.js 22 or newer, open a terminal in this folder:

```sh
npm test
npm start
```

Open http://127.0.0.1:4174. No install, credentials, network connection, donor cartridge, or investigation backend is needed. A different port can be supplied with `npm start -- 4175`. Use a local HTTP server, rather than opening HTML through `file://`, for JavaScript modules.

Space or tap starts/jumps and alternates direction. Holding jump reduces gravity. In the after view, hold D to dash. Touch buttons work below both players. **Run matched 8-tick comparison** starts fresh players with identical declared open-air fixtures, runs actual recipient code, compares positions/vertical velocity/timers, and offers the resulting trace as a download. Reset both to resume free play.

## Integrate into your own game

Copy `component/` and import `component.js`. The default configuration is in `component/contract.json`. No engine or dependency is required by the component itself.

```js
import * as dash from './component/component.js';
const config = { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 };
let state = dash.init(config); // Once per player life.
function updatePlayer(player, dashHeld, facing) { // Exactly once per 60 Hz tick.
  const result = dash.step(state, {
    buttons: (facing < 0 ? 16 : 32) | (dashHeld ? 1 : 0), sourceBodyWidth: 8,
  }, config);
  state = result.state;
  const dx = result.output.ownsMotion ? result.output.displacement.x * 0.5 : player.vx;
  // Feed dx to your collision system; continue native vertical physics.
  return { dx, events: result.output.events };
}
```

This interface example leaves collision handling to your engine. The working JUJUMP integration implements it in `recipient/game-after.js`.

- `component/component.js` and `.ts`: exact frozen Meta-generated controller/build; identity in `provenance.json`.
- `adapter/adapter.js` and `.ts`: human-authored mapping; edit `.js` to change the running example. TypeScript is provided for inspection; this dependency-free package has no TypeScript build step.
- `adapter/host-hooks.mjs`: the exact source transformation, with its import relocated into this package. `recipient/game-after.js` is its emitted playable result plus observation hooks. Edits to the hook source alone do not rebuild the game; edit the emitted game or apply the exported transformation in your own build.
- `recipient/original.js`: pinned upstream source, unchanged. `game-before.js` adds observation hooks.
- `assets/`: bundled runtime, audio, fixed clock and controller bridge.
- `evidence/`: recovery history, code/experiment evidence, failed candidate, development/regression/acceptance reports, and the recipient's browser traces.

## Mapping and collision policy

The component runs at 60 Hz with the original defaults and body width 8. JUJUMP facing maps to donor left/right, and D maps to donor X. The adapter multiplies horizontal displacement by 0.5: 60 donor pixels become 30 JUJUMP pixels over eight active ticks. Initial readiness is 10 ticks; recharge is 25 inactive ticks. Holding D reactivates when ready. The direction chosen at activation stays fixed until that dash ends. No component timers are reset by landing.

JUJUMP retains its horizontal movement when the component is inactive. Gravity, weaker successive air jumps, vertical motion, camera scrolling and game-over rules remain native. During active motion the host sweeps in at most one-pixel increments and retains JUJUMP's upward overlap resolution and velocity reset. This includes its unusual side-contact rule; it is not a new one-way platform system. No edge clamp is added. Visual trails, combat and scoring are outside the recovered component.

## Evidence and measurements

`npm test` checks every exported file hash, component identity, 100 recorded timing observations through the exported adapter, and ordinary horizontal movement. It is a saved-evidence regression check, not fresh donor acceptance. After editing a file, the integrity check should fail: existing verification does not apply to your edits. The browser's comparison is a separate local execution with an explicit open-air fixture; saved browser verification also covers landing, ordinary play, death/restart and input replay.

`case-study.json` records measured trace coverage, position error, adapter size, saved model costs and supported scope. Human setup, mapped fields, evaluator construction, adapter work and failed recovery attempts are disclosed. Human time and time saved were not measured and are null; no productivity improvement is claimed. `manifest.json` binds the files to exact hashes. The manifest is a consistency record, not a digital signature or an authenticity guarantee against malicious replacement.

## Origin and limits

This is the saved Meta recovery, not a new model run. Meta generated and repaired the controller; a human selected the boundary, mapped state, selected code and development evidence, and authored evaluators and recipient integration. An earlier acceptance failure became development evidence; the repaired candidate then passed a fresh acceptance seed after freezing. The history retains the failure. Later workbench investigations are separate and did not produce a new accepted component.

Dashy Dango's source was withheld from recovery; it was not actually lost. This example supports a narrow WASM-4 case and finite tests, not arbitrary compiled software or complete game equivalence. JUJUMP is by Kenta Cho / ABA Games. See `NOTICES.txt` for bundled notices. No donor cartridge or donor game assets are redistributed here.
