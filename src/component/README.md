# Motion component recovery

Prepare evidence locally without API calls:

```sh
npm run recover:motion -- --prepare-only
```

Recover and evaluate a candidate using the existing ignored `.env` key:

```sh
npm run recover:motion
```

The command has a $0.30 estimated token budget, token-count preflight, at most two synthesis requests, and a three-minute invocation deadline. It uses low reasoning effort by default. It does not retry ambiguous HTTP failures. A development failure can trigger one new synthesis from public evidence and feedback within the same budget. Incomplete responses stop. Reports retain unsettled reservations when usage is unknown.

A settled interrupted run can be resumed explicitly with `npm run recover:motion -- --resume reports/recoveries/<run-id> --reasoning-effort minimal`. Resume retains the original charges, call count, limits, target, and evidence; it cannot continue a completed run, uncertain billing, or a candidate that already reached acceptance. The next output allowance is reduced to fit remaining funds, with at least 2,048 tokens required before generation. Each generation records its actual reasoning setting and token allowance. Private reasoning is discarded; the next pass receives public evidence and any development feedback.

After a failed acceptance, `--repair reports/recoveries/<failed-run-id>` explicitly permits one focused Meta Spark patch if remaining funds cover it. This creates a new report carrying all prior charges, sources, and verdicts. The old acceptance suite becomes development regression evidence, including the separately authored neutral-after-left-dash case. Exact text patches update source and contract rules; the host does not manually repair source. A fresh 20-case seed is generated only after the patch passes development and those regressions. Combined spend still cannot exceed the original $0.30 cap. The explicit one-call extension and failed results are retained in the exported recovery history.

Evidence consists of WABT-generated pseudocode from functions 9, 23, 70, and 102 and sampled numeric observations from 12 actual donor traces. The host selected those functions, mapped state fields, chose the boundary, and authored the checks. Meta infers rules and writes TypeScript plus a contract. This is human-assisted recovery; original donor source, private model reasoning, and acceptance answers are not included.

Candidates export `init(config)` and `step(state, {buttons, sourceBodyWidth}, config)`. Config fields are `walkingSpeed`, `dashDistance`, `cooldownTicks`, and `initialCooldownTicks`; the model supplies observed defaults. The [evaluator](../evaluator/README.md) checks independent rollouts with a 0.25-pixel tolerance and exact event ticks. Passing development freezes the source before 20 separate acceptance inputs are generated. An acceptance failure stops without an automatic repair using those answers.

Each run writes a unique ignored directory under `reports/recoveries/`, with evidence and an atomically updated report. Success adds a `component/` folder containing TypeScript, standalone ES-module JavaScript, a contract, evidence, separate evaluations, and provenance. The package builder checks that source and JavaScript hashes match both evaluations. No donor cartridge, runtime, assets, or dependencies are needed to run `component.js`. Meta cannot choose output paths or mark its own output accepted.

```js
import { init, step } from './component.js';
// Load contract.json defaults using your application's JSON loading method.
let state = init(config);
const result = step(state, { buttons: 33, sourceBodyWidth: 8 }, config);
state = result.state;
// result.output: ownsMotion, displacement in source pixels/tick, dash-start/end events.
```

This gate covers default donor motion at source body width 8 on the tested inputs. Modified configuration is useful for later remixes but needs its own acceptance checks. Combat, scoring, effects, recipient collision behavior, and a playable transfer are outside this gate.
