# Compare candidate fidelity

`score:candidate` is a free, local comparison against the compiled donor. It does not call Meta or grant recovery acceptance. It scores closed-loop position (0.25 source-pixel tolerance), motion ownership and exact event timing equally for every condition. Internal timer fields are not scored, because not every condition exposes them.

Prepare every candidate before scoring. Write a JSON file with a `candidates` array:

```json
{
  "candidates": [
    {
      "id": "saved",
      "condition": "saved-recovery",
      "sourcePath": "../components/dashy-dango-dash/component.ts",
      "configPath": "../components/dashy-dango-dash/contract.json"
    }
  ]
}
```

Paths are relative to that JSON file. `configPath` accepts either a configuration object or a contract containing `defaults`. Conditions are `saved-recovery`, `fresh-recovery`, `video`, `contact-sheet`, `by-feel`, and `author-baseline`. Labels describe how the source was obtained; the scorer does not certify those claims. Retain the corresponding model messages, clip/contact sheet, attempt history, or participant records separately. Never label author testing as an independent participant.

```sh
npm run score:candidate -- --freeze reports/candidates.json --out reports/fidelity-study
npm run score:candidate -- --score reports/fidelity-study
```

The output directory must not exist. Freezing snapshots all sources and configurations, binds evaluator files and donor bytes, then generates a new 32-bit seed for 40 traces. Scoring verifies those snapshots and evaluates all candidates on that same suite in two bounded batches. It retains compilation/execution failures as failures; it does not silently omit them. Results include pass counts, maximum position error, and per-trace first divergence.

An existing `results.json` cannot be overwritten or rescored. A process interrupted during scoring leaves a `running` marker; preserve it as an interrupted attempt rather than deleting it to retry. Frozen content or evaluator changes are rejected before scoring. These local integrity checks prevent accidental substitution, not deliberate rewriting by someone who controls the filesystem.

Do not repair a candidate after observing this suite and present it as held-out. If further development is necessary, retain the original study, disclose that its cases are now development evidence, and freeze all conditions for a genuinely new study. The comparison measures finite behavioral fidelity, not developer time saved, general equivalence, or adoption. External by-feel and developer studies remain unmeasured until actual sessions occur.
