# Predefined developer tasks

The benchmark measures three self-run developer tasks. It records completion,
behavioral failures, lineage, machine execution time, model usage, estimated cost,
provider reservations and interventions. It does not measure independent adoption
or time saved against a manual baseline.

The immutable campaign definition is written before inference:

1. Recover a component from the compiled donor, inspect actual function bodies,
   run a controlled intervention, choose a later action from the result, develop
   a candidate, freeze it and pass separate acceptance. Deliver the newly recovered
   component in a JUJUMP ZIP checked independently of the app.
2. Edit the existing Roadster adapter to dash backward for 3 meters on a fresh
   press. Preserve the previously accepted component and native physics.
3. Edit the existing PAKU adapter to dash backward on a fresh press while keeping
   its 30-pixel distance. Then shorten that child to 15 pixels, retaining both
   earlier changes. The second generation must use the first child's actual ID.

Only the first task claims fresh binary recovery. The other two deliberately
measure bounded adapter editing with the existing accepted component. Delivered
intent is checked against the frozen request, separately from the model's own
interpretation. A partially completed edit chain is reported as partial.

## Execution

Start the local server with `npm run dev:transfer`. Run `npm run benchmark:verify`
after committing protocol changes, then `npm run benchmark:developer`.
The validation receipt binds passing local checks to the exact tracked protocol.
The CLI uses the server's existing services; it does not receive API credentials.

The additional campaign ceiling is $2. Existing per-run and durable lab/remix
ceilings remain unchanged. Recovery allows at most three deliberate trials of
$0.50 each; Roadster runs once under $0.05 and PAKU twice under $0.03 each.
The maximum planned commitment is $1.61. Unused headroom remains unused.

There are no automatic provider retries or failed-task resampling. A subsequent
recovery trial requires a documented local fix, a changed protocol hash and new
passing local validation:

```sh
npm run benchmark:developer -- --campaign <id> --fix-note 'describe the local repair' --validation reports/developer-benchmark/validation.json
```

Acceptance is held out: once acceptance begins, its failures cannot be used for a
repair or another trial. Existing recovered source is never supplied as a new
investigation's answer. An accepted candidate still needs recipient and final ZIP
checks before it is downloadable as a completed task.

## Evidence and interruption

`reports/developer-benchmark/current.json` points to the current campaign. Repeated
invocation resumes it rather than silently opening a new spending allowance.
The runner reserves each task's maximum before submission and saves its exact
request and idempotency key. Lost admission responses are resolved through
read-only journal lookup; the runner does not send another POST. Unknown billing
blocks all further tasks, including across runner restarts.

Each campaign has a hash-bound definition, journal and content-addressed evidence.
Terminal service reports and delivered artifacts are retained. Publish selected
campaign directories under `assets/benchmark/recordings/` without changing their bytes.
The read-only `/api/developer-benchmarks` endpoints and React panel expose recorded
outcomes, source, verification and verified playable artifacts without inference.

Historical setup time is unknown. The optional setup observation records only a
wall-clock window, including idle time, and does not imply human working time.
Human-mapped fields, the supplied ABI, evaluators, adapters and host hooks remain
explicit assistance. Between-trial implementation-agent repairs are separate
from closed model execution. Zero in-run source edits is not zero setup effort.
All checks describe finite scenarios, not universal equivalence.
