# Architecture

Motion Transfer recovers one behavior from a compiled game, then lets Meta's models connect it to other games. Nothing a model writes is trusted until an isolated worker has measured it.

```mermaid
flowchart TD
  subgraph recover["Recover (once)"]
    donor["Dashy Dango cartridge<br/>compiled WASM-4, no source"]
    traces["Trace recorder<br/>frame-by-frame ground truth"]
    wonder["Muse Wonder<br/>writes a standalone controller"]
    gates["Development gate, then unseen acceptance gate<br/>0.25 px tolerance, exact timing"]
    component["Frozen component<br/>content-addressed, no donor needed"]
    donor --> traces --> wonder --> gates
    gates -- "failure with the first divergent frame" --> wonder
    gates --> component
  end

  subgraph adapt["Adapt (every request)"]
    request["A sentence, or an unseen game's source"]
    spark["Muse Spark<br/>one strict tool call"]
    request --> spark
  end

  subgraph trusted["Coordinator: holds the API key and spending ledger"]
    ledger[("Spending ledger<br/>reserve before, settle after")]
    publish["Content-addressed publication<br/>parents never change"]
    library["Library<br/>replay needs no model"]
    publish --> library
  end

  subgraph isolated["Isolated worker: no credentials, no network, read-only"]
    native["Native checks<br/>game's own bot, tests and rules"]
    fidelity["Dash fidelity and recharge<br/>measured against the component"]
    browser["Real browser<br/>the dash fires in the running game"]
    native --> fidelity --> browser
  end

  component --> spark
  spark -. "reserves spend" .-> ledger
  spark -- "untrusted source" --> native
  browser -- "pass" --> publish
  browser -- "fail, with verifier feedback, once" --> spark
```

## Trust boundaries

- **Model output is untrusted.** Generated adapters and patches run only inside the worker, with no credentials, no network and a read-only filesystem. A capability gate rejects forbidden calls first, but the worker is the real boundary.
- **The measuring code is not generated.** Drivers, the host runtime and the verifier are written by hand and frozen by hash before a campaign starts, so a model cannot change how it is graded.
- **The worker never holds the key.** It refuses to run if credentials appear in its environment.
- **Publication is content-addressed.** A version's identity is the hash of its bytes, and a parent never changes when a child is published.

## Spending

Every Meta call reserves its full ceiling on the shared ledger first, then settles measured usage. If a call fails in a way that may still have billed, its whole ceiling stays held. The ledger has one owner at a time. It lives with the hosted backend, so campaigns send their model calls there rather than spending from a second copy.

## Where things live

| Folder | Status | Contents |
| --- | --- | --- |
| `web/app/` | Current | React interface |
| `src/auto-port/` | Current | Porting unseen games: drivers, host runtime, verifier, Spark request |
| `src/parallaxia/`, `src/hosting/`, `src/evaluator/` | Current | PARALLAXIA integration, coordinator, isolated worker and gates |
| `src/agent/`, `src/campaign/` | Current | Recovery agent, Meta client, spending ledger |
| `assets/evidence/` | Current | Small derived results that `npm run verify:evidence` checks |
| `assets/auto-port/` | Current | Pinned games and published ports |
| `src/roadster/`, `assets/transfers/paku-paku/`, `assets/benchmark/` | Historical | Earlier transfers and the fidelity study, kept as evidence |
