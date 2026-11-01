# Meta cartridge experiments

This CLI gives a Meta model tools for investigating the registered compiled cartridge through static analysis, persistent execution and controlled replay branches. It records chosen experiments and observations. The component workbench can develop standalone candidates with real divergence feedback and separate acceptance after freezing; new candidates remain separate from the saved playable transfers. See [the full investigation workflow](../docs/investigation-tools.md).

## Run

Use Node.js 22 or newer. Install dependencies and create an ignored local environment file:

```sh
npm install
cp .env.example .env
```

Set `MODEL_API_KEY` in `.env` using a Meta Model API key. Existing shell environment variables take precedence. `META_MODEL` defaults to `muse-wonder-1.0`; `muse-spark-1.3` is also supported. Credentials are sent only to `https://api.meta.ai`, are not passed to the cartridge process, and are not written to reports.

```sh
npm run investigate
```

The default question asks whether holding the dash button differs from pressing and releasing it. For another question or a named report:

```sh
npm run investigate -- "Investigate how direction affects the dash." --out reports/direction.json
```

To finish an interrupted run whose previous generation requests all have settled usage:

```sh
npm run investigate -- --resume reports/direction.json
```

Resume carries forward the original model-call count, tool-call count, and spend. It rejects reports with unknown billing or a completed conclusion. A saved session reconstructs its cartridge branches through hash-verified replay before inference. The model context restarts from a compact ledger of saved observations, rather than claiming to restore private model reasoning.

For a local smoke check with no model calls or API cost:

```sh
npm run tools:smoke
```

This local check indexes all cartridge functions, inspects the `update` export, and compares two movement traces while watching the documented gamepad register. It saves the function index, a disassembly window, and observed readings to `reports/cartridge-tools-smoke.json`, explicitly labeled `metaCalled: false`. It checks the investigation tools, not a recovered component or an identified gameplay variable. The automated tests use mocked Meta HTTP responses while dispatching real cartridge tools. Neither is a substitute for the live command.

## Tools and observations

- `inspect_wasm` returns the pinned cartridge's imports/exports or a numbered WAT slice of up to 100 lines. WABT generates names with debug names disabled. Long lines are explicitly abbreviated.
- `list_functions` pages through function indices, generated names, signatures, exports, WAT locations, and counts of calls and memory instructions. Start with `{ "startIndex": 0, "limit": 50 }`, then follow `nextIndex`. Function indices include imported functions; other imports do not consume an index.
- `inspect_function` takes a `functionIndex`, a function-relative `startLine` starting at 1, and a `lineCount` of up to 100. It returns that WAT window, direct callers/callees, and call sites and load/store offsets within the window. Follow `nextLine` to continue. Direct caller/callee lists are capped at 50 with omitted counts. Indirect calls remain unresolved; a static memory offset is added to a runtime base address and does not identify an absolute address by itself. These are instruction relationships, not recovered source or proof that a function implements a mechanic.
- `run_original` takes a hypothesis, a `watches` array (use `[]` when unused), and up to 12 input steps. Each step specifies a button mask, frame count, and checkpoint name. The tool resets the game and empty storage before every experiment, advances fixed simulation updates, and returns checkpoint hashes, visible text, grouped sprite coordinates, and requested memory readings. Each step is capped at 600 updates; the whole experiment at 1,800.

Persistent `session_advance` / `session_observe` / `session_reset`, checkpoint/fork tools, typed experimental writes, memory diffs and identical-input branch comparisons are also available. `decompile_function`, `call_graph`, evidence-linked annotations and scalar writer tracing extend static investigation. Selective framebuffer PNGs can become model image input. Component evidence selection, development submission, freezing and acceptance reuse the existing evaluator/package pipeline. [Tool contracts and finite scope](../docs/investigation-tools.md) describe the limits and human assistance.

Memory watches have the form `{ "name": "candidateState", "address": 8192, "type": "f32", "count": 2 }`. This is an illustrative address, not an identified donor variable. Watches read absolute byte addresses in the cartridge's 64 KB linear memory at reset and named checkpoints. Supported types are `u8`, `i8`, `u16`, `i16`, `u32`, `i32`, `f32`, and `f64`, all little-endian. Results retain exact bytes and interpreted values. At most eight watches, 16 values per watch, and 64 values total are accepted. They are read-only and cannot patch state. They do not expose private WASM globals. Watch names express a hypothesis; correlation with input or sprite motion needs further investigation before identifying a mechanic. See the [runtime API](../runtime/README.md) for numeric serialization details.

Sprite groups include pointers, pixel-data hashes, dimensions, and colors. Up to four positions per group and eight groups per checkpoint are returned, with omitted counts. These limits keep observations small; they are not guarantees that every object is shown. Use fewer checkpoints or targeted experiments if the 32 KB tool-output limit is reached. `run_original` retains full replay evidence, including per-frame hashes and original checkpoint draw calls. Persistent sessions retain reconstruction journals, checkpoint observations and bounded comparison samples.

The model has no filesystem, shell, arbitrary URL, or original source tool. All tools accept only their declared fields and read the registered target after checking its hash. One isolated process per investigation preserves cartridge state; commands retain a 10-second deadline and an explicit environment that excludes inference credentials. Only experimental branch memory can be changed; the original artifact remains immutable. This is a restricted local harness for one fixed cartridge, not a public upload sandbox.

## Limits and cost accounting

The CLI uses these defaults from `agent/investigate.mjs`:

| Limit | Default |
| --- | ---: |
| Estimated generation budget | $0.50 |
| Model generation requests | 6 |
| Tool calls | 12 |
| Maximum generated tokens per request, including reasoning | 3,000 |
| Maximum rendered input tokens per request | 20,000 |
| Each invocation, including a resume | 180 seconds |
| Individual HTTP request | 45 seconds |

Before every generation, the client calls Meta's input-token-count endpoint with the same model, instructions, history, and tools. It reserves the uncached input cost plus the maximum output cost before sending the generation request. Returned token usage settles the reservation and accounts for cached input. Reasoning tokens are already part of the output total and are not charged twice in the estimate.

The local guard uses the documented standard token prices embedded in `PRICES`, not an account billing API. Update those rates if Meta changes pricing. It counts generation requests separately from token-count preflight requests. If history exceeds the input-token limit, it replaces completed turns with a deterministic evidence ledger, including watch definitions and observed values/bytes, and recounts before generating. It does not summarize encrypted reasoning. The last allowed request uses the recorded evidence and disables tools so the model can give a final answer within the existing budget.

The run stops if counting fails, the next reservation would exceed the budget, usage is missing, or a limit is reached. HTTP failures, incomplete responses, and ambiguous transport failures are not automatically retried. An unsettled reservation remains in the report when actual usage is unknown.

## Reports and completion

Reports default to a unique file under `reports/investigations/`. The CLI prints its path and updates it atomically during the run. Reports include the target hash, model, question, limits, request accounting, public model messages, tool arguments/results, replay evidence, and final conclusion or failure. They exclude API keys and encrypted reasoning. Encrypted reasoning is replayed intact in memory between ordinary requests, with the required `summary` field and message phases preserved. Context compaction and resume instead discard completed private turns and supply the saved public observations; these events are recorded explicitly.

Successful input experiments receive IDs such as `exp-001`; branch comparisons also have `cmp-001` IDs. Completion requires inspection and either two distinct cited input sequences or a cited controlled perturbation comparison. The UI memory workflow additionally requires code inspection and a branch comparison; extraction requires a new candidate to pass separate acceptance. These checks establish evidence presence and finite evaluator outcomes, not universal correctness. `conclusionVerified` remains `false`; review observations before treating an interpretation as a recovered rule.

The model only receives the question, fixed host/control instructions, its own outputs, and tool results. It is not given the repo's design notes, donor source, or prewritten explanations of the mechanic.

Sources: [Meta model availability](https://dev.meta.ai/docs/models), [Responses continuation](https://dev.meta.ai/docs/protocols/responses), [tool calling](https://dev.meta.ai/docs/tool-calling), [token counting](https://dev.meta.ai/docs/token-counting), [standard pricing](https://dev.meta.ai/docs/pricing-rate-limits).
