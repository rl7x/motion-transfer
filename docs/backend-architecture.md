# Backend architecture

The application has a browser experience, a trusted Node coordinator and a credential-free investigation worker. The worker owns a persistent cartridge session. Agent experiment programs run inside the existing isolated QuickJS interpreter, with bounded JSON capabilities; the child process alone is not their security boundary.

```mermaid
flowchart TD
    Browser[Players and investigation UI] --> Server[HTTP routes]
    Server --> Jobs[Job admission and durable journals]
    Jobs --> Loop[Investigation lifecycle]
    Loop --> Request[Token preflight and provider request]
    Request --> Meta[Configured Meta model]
    Loop --> Calls[Tool responses and private continuation]
    Calls --> Worker[Bounded worker message protocol]
    Worker --> Dispatch[Per-investigation tool dispatcher]
    Dispatch --> Runtime[Persistent WASM session and replay]
    Dispatch --> Experiments[Controlled experiments and isolated programs]
    Dispatch --> Recovery[Candidate development and freezing]
    Recovery --> Evaluation[Development and separate acceptance]
    Worker -->|checkpoint journal| Loop
    Loop -->|durable acknowledgement| Worker
    Loop --> Jobs
```

## Investigation coordination

`src/agent/investigate.mjs` owns the public investigation entry point, validates initial/resumed reports, creates one worker, runs bounded turns and closes the worker on completion or failure. Its default exports, report shape and caller callbacks are preserved.

- `investigation-request.mjs` owns request construction, token preflight, context compaction, durable reservations, usage settlement and stateless response continuation. The existing instructions and provider request bytes are preserved. A reservation is recorded before generation; missing usage or interrupted transport retains unknown billing and stops without retry.
- `investigation-tools.mjs` owns tool call identity, namespace routing, experiment numbering, model-visible outputs, image delivery and error feedback. Failed forks return occupied branch and checkpoint identities so the next model action can respond to the actual failure. Private reasoning remains in continuation history; the public report does not record its encrypted payload.
- `investigation-completion.mjs` applies the existing evidence requirements. It distinguishes orientation, function-body inspection, cited controlled trials, subsequent model decisions and separately accepted components. Listing functions cannot satisfy code inspection. Freezing cannot satisfy acceptance.

The HTTP endpoints and schemas remain unchanged. `src/lab/service.mjs` validates and serializes jobs, retains idempotency, holds admission during asynchronous parent lookup and journal writes, redacts credentials and accounts for settled and reserved spending across restarts. The existing PAKU remix service and its separate journal remain in place.

## Worker ownership and durability

`src/agent/tools.mjs` starts one persistent child with a restricted environment, bounded input/output, per-command cancellation and deadlines, and clean shutdown. API credentials remain in the parent coordinator.

`src/agent/tool-worker.mjs` handles line-delimited JSON, sequential commands and checkpoint acknowledgements. Acknowledgements bypass the ordinary command queue because the current command may be waiting for the parent to persist its checkpoint. Both response and checkpoint message formats are unchanged.

`src/agent/tool-dispatcher.mjs` owns one investigation's lazy session, static-analysis cache, experiment workbench and component workbench. Static orientation can run before a live session exists. Multiple dispatcher instances have separate state. The dispatcher delegates runtime execution, WABT analysis, writer tracing, images and component evaluation to the existing modules, retaining their validation and limits.

Runtime checkpoint identities bind the cartridge and host source. Experiment journals additionally bind the experiment engine source. Those identity-bound files were left byte-for-byte unchanged in this refactor, allowing prior journals and evidence to remain usable. A future engine change needs an explicit compatibility decision; changing recorded hashes does not establish compatibility.

## Source and playable artifacts

The repository retains 12 immutable, self-contained Roadster players in `assets/transfers/roadster/` and `assets/benchmark/remix-recordings/`. Together they contain 10,547,692 HTML-file bytes, including bundled JavaScript, styles and assets. These players account for more than 99.8% of tracked HTML bytes; the authored web pages and integration template total 4,439 bytes, with the remainder in upstream recipient pages.

`.gitattributes` marks the bundled players as `linguist-generated` and pinned `assets/recipients/*/upstream/**` trees as `linguist-vendored`. Recovered component and adapter source remains visible. Existing upstream line-ending attributes are retained. This follows [GitHub's generated/vendor classification](https://github.com/github-linguist/linguist/blob/main/docs/overrides.md). GitHub refreshes its cached statistics after changes reach the default branch.

## Repository layout and historical inputs

The root separates application tooling (`src/`), the React workbench (`web/`), and pinned inputs (`assets/`). CLI entrypoints remain in `scripts/`. See the [repository guide](../README.md#repository-guide) for the complete layout.

Historical source names inside manifests are logical identifiers. `src/paths.mjs` maps them to their new filesystem locations without editing recorded hashes. Runtime and experiment-engine inputs that did not need import changes retain their exact bytes. New builds fingerprint the current tooling; existing saved artifacts retain their original evidence.

PAKU's evaluator imports changed during relocation. Its existing adapter was reverified locally and saved as a new version; all historical versions remain intact. JUJUMP's exported package and ZIP retain their original identities. No model request is needed for this migration.

## Verification

```sh
node --test tests/investigation-contract.test.mjs tests/investigation-completion.test.mjs tests/tool-dispatcher.test.mjs tests/lab-service.test.mjs
npm test
```

The injected-client contract was captured from implementation `1dbbab6` before the refactor. It compares request hashes, private continuation handling, dispatch arguments, update order, public reports and accounting for successful native discovery, uncertain transport and missing usage. Timestamps are excluded from comparison. No provider is called.

Actual runtime tests cover persistent state, checkpoint replay, branch isolation, interrupted evidence persistence, the occupied-branch failure, selected images and sandbox limits. Browser tests cover players, mobile controls, existing remixes and the independent JUJUMP download. Saved failed investigations retain their original outcome; this refactor adds no recovery claim or paid inference.
