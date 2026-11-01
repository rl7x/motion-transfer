# Programmatic experiment workbench

Meta chooses a hypothesis, typed interventions and input sequences. The host restores a checkpoint twice, verifies identical starting conditions, preserves an unedited control, applies the intervention to its own experimental instance, and records the actual consequences. Branch handles are opaque and host-generated. The model no longer needs to spend separate calls creating and naming both branches.

The existing persistent worker, WASM runtime, WABT analysis, scalar writer instrumentation, PNG encoder, component evaluator, artifact storage and spending journal remain in use. The saved recovered component and playable transfers are unchanged. Neither the program interpreter nor the investigation tools can read that implementation as an answer to a new recovery.

## Complete experiments

`prepare_checkpoint` advances model-selected inputs on `main`, records a replay checkpoint, and returns structured observations and typed target handles. `read_checkpoint` does the same observation/target binding for an existing checkpoint without advancing it. These handles include the checkpoint identity, memory hash, frame, absolute address, type and previous bytes.

`run_experiment` accepts a hypothesis, checkpoint, typed target interventions, identical input segments, observation channels, selective capture stages, and a request identity. It reconstructs two clean instances through the existing replay journal; this reconstructs private mutable globals and host storage as well as memory. Restoration checks the cartridge/runtime identity and recorded endpoint hashes. It does not claim that copying linear memory is a full snapshot.

Every intervention records its checkpoint-bound address/type, before/after value and bytes, frame and hypothesis. Stale targets, overlapping edits and invalid typed values are rejected. The donor reallocates motion state between updates: a valid address at the checkpoint is not a promise that the field remains there. Human-mapped motion/timer hints are explicitly assistance; agent-requested raw watch names remain hypotheses. Static instruction offsets remain distinct from runtime addresses.

Results separate the initial edit-induced memory difference from the first subsequent behavioral/rendering divergence, first timer difference and first rendering difference. Normalized motion, timer counters, ownership/events, memory hashes, palette-aware rendering hashes, host storage and selected framebuffer images come from execution. Event normalization uses the disclosed human-authored start/end convention. The host supplies no expected conclusion and does not require an intervention to have an effect.

The concise result refers to a content-addressed artifact containing exact replay actions, edits, inputs, per-update observations, differences and captures. `read_experiment` returns at most four requested updates. `capture_experiment` reconstructs and verifies one complete endpoint before capturing it. Images retain session, experiment, branch, frame and PNG identities.

## Bounded experiment programs

`run_experiment_program` accepts a JavaScript or TypeScript **async function body**, plus a hypothesis and request ID. Reasoning stays with the configured Meta model. Experiment code executes locally in a fresh **QuickJS 0.32.0 interpreter compiled to WebAssembly**. This interpreter and its JSON-only capability bridge form the guest-code boundary; a Node child process or `vm` is not the boundary.

The guest has no Node objects, filesystem, shell, network, environment, credentials, arbitrary imports, or recovered implementation. Module loading is disabled. Constructor tricks stay inside the guest. Randomness and `Date` are disabled for reproducibility. TypeScript is transpiled with the existing esbuild dependency before interpretation; it is not evaluated by Node.

Available capabilities:

| SDK method | Purpose |
| --- | --- |
| `prepareCheckpoint`, `readCheckpoint` | Create/read replay checkpoints and bound targets. |
| `runExperiment`, `sweep` | Complete controlled trials; sweep at most four values sequentially. |
| `readExperiment` | Read a bounded page from actual stored evidence. |
| `capture` | Select an actual verified endpoint image. |
| `emitFinding` | Record a supported/rejected/unresolved interpretation with existing evidence IDs. |
| `static.inspectWasm`, `listFunctions`, `inspectFunction`, `decompileFunction`, `callGraph`, `traceWriters` | Existing bounded analysis of the registered cartridge. |

The SDK does not provide arbitrary dispatch or component-source loading. Static writer tracing still uses a separate instrumented copy and finite comparison against the original. Its scalar-store coverage and unresolved indirect calls retain the [existing limitations](investigation-tools.md).

For example, a program can prepare a checkpoint, run a few candidate values and conditionally request a narrower trial **based on returned measurements**. The [local verification source](../scripts/experiment-smoke.mjs) demonstrates that behavior, with all choices clearly identified as human-scripted. It is not supplied to a fresh model as a required experiment or answer.

### Limits

| Resource | Ceiling |
| --- | ---: |
| Source | 8,192 UTF-8 bytes |
| Guest memory / stack | 8 MiB / 256 KiB |
| Guest deadline | 5 seconds, checked during interpretation and between host operations |
| Outer worker command deadline / V8 heap | Existing 10 seconds / 128 MB |
| Interrupt callbacks / pending jobs | 1,024 / 2,048 |
| SDK operations per program / programs per investigation | 16 / 2 |
| Workbench host operations / paired experiments | 24 / 4 |
| Preparation or trial | Four segments, 120 updates total |
| Charged workbench updates, including reconstruction and both trial/analysis instances | 7,200 |
| Live legacy branches plus a temporary experiment pair | Six |
| Captures, shared with low-level tools | Four |
| Full workbench evidence / guest return JSON | 1 MiB / 4 KiB |
| Capability arguments/results / model-facing tool result | 32 KiB |

All operations must be awaited sequentially. Unawaited/concurrent calls, imports, invalid source, guest traps, excessive allocation, cancellation and resource exhaustion stop execution. Host operations retain their existing validation and limits. The outer worker deadline terminates a stalled operation; it is not reset by progress messages. Frame charges reserve the requested work even if it fails early.

## Persistence and recovery

The worker sends a snapshot after each completed SDK host operation and waits for the parent to durably persist it before proceeding. The parent owns credentials and spending. Completed experiment artifacts and PNGs live under `reports/lab/sessions/<session-id>/`; full traces do not enter ordinary model context.

Request IDs are bound to canonical arguments. Repeating a completed request returns its saved output without rerunning it. SDK calls may omit their own request ID or use a short local label; the host scopes it to the program identity. Reusing an identity with different input is rejected. Failed/interrupted requests are not automatically retried.

Program records retain exact source/hash, compiled hash when available, operations/arguments/results, errors and artifact IDs. Restoring a report verifies artifact and source identity. Completed inner experiments survive interruption and can be read independently. **The interpreter execution stack is not checkpointed or resumed.** An interrupted program is marked interrupted, and a new model decision is required to continue with retained evidence. Runtime/engine changes reject execution resumption while old evidence remains readable.

## Meta-native discovery and accounting

The lab's `memory` and `extraction` workflows use the documented Muse Spark 1.3 **client-executed `tool_search`** protocol. Essential orientation, complete experiment/program and finding tools are available initially. Specialized tools are deferred into `static`, `execution`, `memory` and `recovery` namespaces. Function calls route by their separate namespace; only registered definitions actually loaded for this investigation are allowed.

Client search returns matching native search-output items with deferred namespace definitions. Stateless continuation replays the required response/search items and available encrypted reasoning during ordinary turns. Explicit context compaction discards private reasoning, keeps the public evidence ledger and loaded search exchanges, and retains one selected actual image. Finalization disables tools. Unknown namespaces, unloaded calls, unsupported configured models and unsolicited provider definitions are rejected; models/providers are never silently switched.

**Hosted tool search is disabled.** Official token-counting documentation says hosted tools can cause multiple internal model iterations, with cumulative input usage exceeding a single preflight. The existing single-request reservation cannot bound that behavior. Client execution stops for the local catalog lookup; the next generation receives its own exact preflight and durable reservation. Lookup itself calls no second reasoning model.

The existing $0.50 per-run ceiling, $10 persistent lab ceiling, token ceilings, durable reservations, unknown-billing blocks and no automatic retries remain unchanged. No journal is reset. See [official tool calling](https://dev.meta.ai/docs/tool-calling), [tool search](https://dev.meta.ai/docs/tool-search), [token counting](https://dev.meta.ai/docs/token-counting) and [pricing](https://dev.meta.ai/docs/pricing-rate-limits).

## Component development

New experiment IDs can be selected alongside actually inspected functions for `select_component_evidence`. Submission still runs the real development evaluator and exposes first divergence. A candidate may be revised before freezing. Freezing binds exact source/build/contract/timer identities; separate held-out acceptance follows freezing, and its failures cannot be used for repair. Acceptance does not insert a candidate into a recipient. Recipient-specific integration checks remain required.

## Measured local comparison

Run `npm run tools:experiment-smoke` without an API key. It executes all three workflows on two identical scenarios: enter gameplay for one update, release for ten, intervene on the checkpoint's human-mapped timer with value 40 or 5, then hold right+dash for eight updates. All three workflows reach matching normalized motion, timer, ownership and event endpoints for each scenario.

| Workflow | Measured tool invocations | Returned result JSON, value 40 / 5 |
| --- | ---: | ---: |
| Existing low-level workflow | 6 | 23,775 / 23,832 bytes |
| Preparation + complete experiment | 2 | 4,567 / 4,565 bytes |
| One experiment program | 1 | 2,659 / 2,658 bytes |

The program makes two SDK capability calls internally for each matched scenario. Complete-tool artifacts retain roughly 23 KB per trial; program plus trial artifacts retain roughly 31 KB. Persisted session sizes are also recorded in [the complete benchmark](../lab/recordings/experiment-benchmark.json). These evidence formats contain different detail. The comparison measures tool invocations and serialized results, **not model round trips, cost savings or reliability improvements**. No model was called.

The separate **View local experiment program · no model** recording runs a two-value sweep, chooses a third value based on actual displacement, selects a PNG and emits an evidence-linked finite finding. The UI distinguishes this human-scripted verification from saved Meta recordings and fresh model activity. It exposes source, managed branches, actual edits, comparisons, expandable traces/images, exports, findings and candidate feedback. The donor/before/after players and remix flows remain separate.
