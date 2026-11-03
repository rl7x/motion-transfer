# Pinned games and saved evidence

These files support reproducible playback, builds, and verification. Upstream notices, frozen source, artifact manifests, and historical recordings are retained with their original bytes.

| Directory | Contents |
| --- | --- |
| `targets/` | Donor cartridge and its pinned manifest |
| `recipients/` | Licensed upstream recipient games and lock files; loaders live in `../src/recipients/` |
| `components/` | Recovered controller source, builds, provenance and acceptance evidence |
| `transfers/` | Saved adapters, standalone players and verification receipts |
| `experiments/` | Saved deterministic replay inputs |
| `benchmark/` | Recorded benchmark, fidelity-study and remix-campaign evidence |
| `integration/` | Saved integration verification and accepted publications |
| `lab/` | Recorded investigations and experiments |

Paths embedded in historical recordings and their accompanying READMEs describe the original checkout. Their old root folders now live under `assets/`; executable modules now live under `src/`. The application resolves historical logical paths at the filesystem boundary. Original records are not rewritten to update those labels.

Generated standalone HTML players are marked `linguist-generated`, and upstream sources are marked `linguist-vendored` in the root `.gitattributes`. Controller and adapter source remains visible in GitHub's language statistics and diffs.

The repository reorganization reverified the existing PAKU adapter against the relocated tooling, without inference, and published a new version under `transfers/paku-paku/versions/`. The current pointer selects that version; prior versions and their evidence remain available.
