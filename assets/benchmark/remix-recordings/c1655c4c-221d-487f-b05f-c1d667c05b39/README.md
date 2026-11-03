# Remix recording c1655c4c-221d-487f-b05f-c1d667c05b39

This directory is the tracked copy of campaign `reports/motion-transfer-phase/remix-001`. `journal.json` is the exact campaign journal. `published/artifacts/<id>/` holds each published Roadster artifact, including `frame.html` and `notices.txt`. `checks.json` is the independent confirmation of those stored outcomes. `recording.json` maps every copied file to its original relative path, byte size, and SHA-256.

`docs/remix-results.md` states the counts, costs, latency, parent chain, and limitations. The phase ledger, credentials, runner lock, store lock, and process logs are not included. The saved base parent remains at `transfers/roadster/versions/6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38`.

A checkout can re-read each matched frame from this directory. `reports/` is not required:

```sh
node --input-type=module -e 'import { readFile } from "node:fs/promises"; import { readRoadsterArtifact } from "./roadster/artifact.mjs"; const root = "benchmark/remix-recordings/c1655c4c-221d-487f-b05f-c1d667c05b39"; const checks = JSON.parse(await readFile(root + "/checks.json", "utf8")); for (const row of checks.rows) { if (!row.childId) continue; const artifact = await readRoadsterArtifact(root + "/published/artifacts", row.childId); if (artifact.files["frame.html"] !== await readFile(root + "/" + row.framePath, "utf8")) throw Error(row.id); console.log(row.id, artifact.id, row.framePath); }'
```
