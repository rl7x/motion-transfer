# Application tooling

The React workbench and browser entrypoints live in [`../web/`](../web/). This directory contains the Node.js modules behind the workbench and CLI:

| Area | Modules |
| --- | --- |
| Recovery and model orchestration | `agent/`, `campaign/`, `mcp/` |
| Deterministic execution and verification | `runtime/`, `experiment/`, `evaluator/`, `benchmark/` |
| Recovered mechanics and game integration | `component/`, `transfer/`, `recipients/`, `roadster/`, `parallaxia/`, `integration/`, `remix/` |
| Workbench services and delivery | `lab/`, `hosting/`, `release/`, `demo/` |

Run npm commands from the repository root. [`../scripts/`](../scripts/) retains the command-line entrypoints. See the [backend architecture](../docs/backend-architecture.md) for the data flow and boundaries.

Pinned games and saved verification inputs live in [`../assets/`](../assets/). Historical evidence retains its original logical filenames. `paths.mjs` resolves those filenames to the current checkout without altering the evidence or skipping integrity checks. A source edit still changes its fingerprint, even when it only adjusts an import for the new layout.
