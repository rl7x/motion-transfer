# Accepted component Roadster delivery

The saved Roadster package stays untouched. This command binds one already accepted recovery component to a new adapter, publishes that artifact, and builds the landing-zone challenge from the published files.

```bash
node scripts/transfer-accepted-roadster.mjs \
  --campaign reports/motion-transfer-phase/wonder-development-001 \
  --out reports/motion-transfer-phase/fresh-roadster-001 \
  --phase-ledger reports/motion-transfer-phase \
  [--env-file <path>]
```

That command has not been run. `reports/motion-transfer-phase/fresh-roadster-001` is the output directory for a later paid run. It is not evidence of a live Roadster.

The source campaign is Wonder development `67a02792-0e21-48fa-832c-991d00085d85`. Its trial `0f594188-18ed-4e7a-9aaf-6e2843823e9a` is still `failed` / `recipient-or-export`. The report is `completed`, with accepted attempt 3 and frozen candidate `accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f`. `loadAcceptedComponent` reads session `fa8e3d4a-8578-4098-8042-f29e607c9267` and component `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858`. Report sha256 `aa6b3cf7c82f88102242356fa5aab2f3cb9e9f8a4e61f069e6251aecf598cf76`. Protocol `9c7cda7c802c7ca4ab51729266af7ca21e52b886c6e61659e21ff38d6b922c5e`.

The wrapper stores that report hash, protocol, session, candidate, and component before it reserves anything. The first generator parent is `{ id: null, componentId, component, intent: ROADSTER_INTENT, files: {} }`. There is no saved adapter input. `generateRoadsterTransfer` treats an empty parent file set as a new adapter.

## Ledger

The phase ledger must already exist. A missing `phase-budget.json` stops the command before credentials are loaded and before any reservation. The command does not create a replacement ledger, migrate the allowance, or settle an existing reservation.

One new reservation uses category `remix` and a `$0.05` ceiling. It is written before `generateRoadsterTransfer`. Each generator update rewrites `journal.json` in the output directory. A job left `running` is reconciled on the next start: the same reservation is settled, an uncertain report keeps its remaining ceiling, and the model is not called again. A failed or completed job is also single-use.

The shared ledger already accounts for other jobs. Video 001 is settled at `$0.02293425`. Contributor development 004 holds its own `$0.50` recovery reservation. An older recovery row remains `bounded-unknown`. This command adds one remix reservation and settles only that id. It does not reconcile, settle, or reset those rows. A new remix reservation is admitted only when the ledger is not `uncertain` or `overrun`.

The test file uses a temporary ledger. It does not read or hash `reports/motion-transfer-phase/phase-budget.json`. Video output and the development 004 journal are separate jobs.

## Outputs

A completed run writes:

- `journal.json`, including the input identities and the generator report
- `published/artifacts/<id>/`, a lab-store Roadster artifact
- `challenge/`, the `buildRoadsterChallenge` files (`play.html`, `challenge.json`, `manifest.json`, and the rest)
- `delivery.json`, with the same component, candidate, session, report, artifact, and challenge ids

The challenge is kept only when the ordinary trace lands outside the marked zone and the borrowed dash lands inside it, and when every component reference matches the accepted publication. A generator or challenge failure keeps the error report in the journal and does not rewrite the source campaign.

`delivery.json` has `liveMeta: true` and status `delivered` only for the CLI defaults: no supplied client, the real generator, the real browser gate, and the real challenge builder, on a non-fixture report. A supplied client, `generateTransfer`, `verifyBrowser`, or `buildChallenge` is injected and cannot be recorded as delivered. `allowLocalFixture` admits one explicit `origin: 'local-verification'` report for a local test; it is not a CLI flag, and that result is `local-fixture`.

## Check

```bash
node --test --test-concurrency=1 tests/accepted-roadster.test.mjs
```

The test file builds `acceptedRecoveryFixture` in a temporary campaign and passes `allowLocalFixture`. It does not read the shared ledger or the Wonder campaign unless that optional check finds the restored journal. It does not call Meta or write `fresh-roadster-001`.
