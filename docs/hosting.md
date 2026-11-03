# Hosting

This is local release packaging for bounded public remixes. It does not deploy the service, change repository visibility, or spend the shared public reserve.

Playback and creation are separate. The coordinator admits requests, talks to the model provider, accounts for them, and publishes artifacts. Generated adapter code is compiled and executed only inside a short-lived verifier container. If that container cannot be started, hosted mode stops. It does not fall back to the local `vm` worker.

## Processes

| Process | Where it runs | What it can do |
| --- | --- | --- |
| Coordinator (`hosting/serve.mjs`) | Public HTTP process. The Compose service has no Docker socket. | Host, origin, and proxy checks; invite and session quotas; Standard Muse Spark requests; artifact publication. |
| Broker (`hosting/broker-main.mjs`) | Host only. | Accepts one typed job over a Unix socket and starts one locked-down container. |
| Worker (`hosting/worker.mjs`) | Verifier container. | Runs the allowlisted Roadster or PARALLAXIA native and browser verifiers, or a fixed isolation probe. |

The worker image is `motion-transfer-verifier:local`, built from `Dockerfile` on `node:22-bookworm` with Playwright `1.64.1` from `package-lock.json`. The coordinator image is `motion-transfer-coordinator:local` from `Dockerfile.coordinator`. A build stage runs `node scripts/build-creator.mjs` and the final image copies only that HTML. The final image does not install npm dependencies and does not contain the broker, worker, evaluator, or compiler.

`compose.yaml` publishes the coordinator on `127.0.0.1:8080` only. The verifier service is behind the `image-only` profile so `docker compose up` does not start it. Do not point Compose at a production host from this tree.

## Worker limits

Every container is started with a fixed argument list:

- `--network none`
- `--read-only`
- `--cap-drop ALL` and `no-new-privileges`
- numeric user `10001:10001`
- explicit `--memory`, `--memory-swap` (same value, so no extra swap), `--cpus`, and `--pids-limit`
- a deadline enforced by the broker
- writable `tmpfs` on `/tmp` and, for probes, `/output`, both mode `1777`. Probe output is `noexec`. Docker otherwise mounts an optioned tmpfs as mode `755`, which the numeric user cannot write.
- verification jobs bind-mount a fresh directory under the broker temp dir at `/output`

The job cannot choose an image, command, mount, or environment. The broker passes `PATH`, `HOME`, `TMPDIR`, and Playwright cache settings. It does not copy the host environment. `MODEL_API_KEY` and `HOSTING_SECRET_MARKER` are refused if they appear in the container. After the container exits, `result.json` and `frame.html` are opened with `O_NOFOLLOW` and `O_NONBLOCK`. `fstat` must show a regular file within the size cap before any byte is read. Symlinks, FIFOs, devices, and extra names are rejected.

Chrome is started through `/opt/google/chrome/chrome` because the existing browser verifier launches Playwright with `channel: 'chrome'`. The wrapper adds `--no-sandbox`, `--disable-dev-shm-usage`, and software WebGL (`--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`) after Playwright's own arguments. It does not pass `--disable-gpu`, which kept the Roadster canvas from becoming ready. Dropping every capability removes the privileges Chrome's setuid sandbox needs; the container boundary is the isolation. The wrapper is not a command channel.

Stdout is capped at 64 KB. A verified frame written to `/output` is capped at 8 MB and must match the hash the browser verifier returned. The native worker returns the compiled adapter JavaScript, at most 32 KB. The coordinator stores that `adapter.js` and does not compile or run it. Anything else in the output directory fails the job. Publication requires `executedIn: "worker"`, uid `10001`, a source hash that matches the submission, and a component id that matches the parent. Verify jobs carry that parent component id and no filesystem path. The worker loads only two committed packages: the saved dash `1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2` and the accepted Roadster pin `544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858`. Any other id is rejected. The coordinator does not compile either package.

## Public API

`node hosting/serve.mjs` is the shipped production process. It binds the coordinator, the exact host/origin policy, and a Unix-socket broker client when `HOSTING_BROKER_SOCKET` is set. Without explicit operator configuration, this process passes no model client and admission fails closed. With valid operator configuration and `MODEL_API_KEY`, it constructs the real Standard Meta client. `releasePublished` remains false: this implementation does not deploy, and generation uses the existing remix allocation rather than the public reserve. Playback does not need a provider client or a running broker. The dev preview server remains a separate localhost tool.

The coordinator uses `agent/recipient-request.mjs` to select the actual recipient contract. Roadster keeps its original request builder. PARALLAXIA uses world units, native 60 Hz simulation, actual facing and unshielded collision policies. The coordinator does not import the evaluator or compile generated code. A supplied generation client also requires an existing phase ledger. The coordinator reserves the whole $0.15 remix cap on that ledger before counting tokens or calling the provider, then settles known usage. An unknown, timed-out, or aborted call stays reserved and blocks later calls. A restarted process does not retry the job. Tests that exercise this path pass `localVerification: true`, an explicit temporary ledger, and the in-process fake client. That flag is not a free provider. `serve.mjs` never sets the local-verification flag; production enablement requires its separate operator confirmations.

A later operator enablement requires `HOSTING_GENERATION_CONFIRMATION=enable-hosted-standard-generation`, `HOSTING_STANDARD_CLIENT=operator`, a confirmed public origin, `HOSTING_PHASE_LEDGER` set to the existing shared ledger `reports/motion-transfer-phase`, and `HOSTING_SHARED_LEDGER_CONFIRMATION=charge-shared-public-reserve`. The model is Standard `muse-spark-1.3`. Only after all operator checks pass is the real Standard client constructed. A missing ledger is not created. The shared ledger additionally requires the explicit confirmation token. The local PARALLAXIA operator flow supplies that confirmation for the reconciled ledger; ordinary unit tests use temporary ledgers.

`HOSTING_PARENT_ARTIFACT` optionally seeds one verified parent. The directory name must be an allowlisted artifact id, and the directory must be a real Roadster artifact: `manifest.json` plus `adapter.js`, `adapter.ts`, `frame.html`, `generation.json`, `notices.txt`, and `verification.json`. Seeding checks the manifest id and those file hashes, then checks the adapter source, frame, component, and recipient revision against that pin. The saved pin is `transfers/roadster/versions/6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38`. The accepted pin is `transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c/published/artifacts/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c`. A mismatch is not stored. Public POST bodies cannot include source. `HOSTING_CREATOR_ROOT`, or `web/dist/creator` when that directory exists, serves its `index.html` at `GET /` and under `/creator/`. The coordinator does not execute that page. `GET /api/catalog` is the catalog JSON. When no page is configured, `GET /` stays the catalog JSON.

`checkPublicEdge` is the host and proxy check without the route allowlist, exported for a caller that already has its own playback routes.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Trusted creator `index.html` when that file is configured. Otherwise the catalog JSON. The page is not sandboxed. |
| GET | `/api/catalog` | Catalog of seeded parents and published artifacts, including stored intent and summary. |
| GET | `/creator/...` | The same trusted bundle, for an explicit file path. |
| GET | `/health`, `/privacy`, `/api/remixes/status` | Liveness, retention note, and reserve status. |
| POST | `/api/remixes` | Invite, 18+ confirmation, session quota, and idempotency key. |
| GET | `/api/remixes/:id` | Reconnect to the same job after a dropped response or process restart. |
| GET | `/parents/:id`, `/parents/:id/download` | Immutable seeded parent and its download. |
| GET | `/artifacts/:id`, `/play.html`, `/adapter.js`, `/download` | Receipt, sandboxed frame, worker JavaScript download, and frame download. |

A follow-up uses the published artifact id as its parent. The receipt stores the ancestor ids, and every ancestor stays readable after a restart. The same idempotency key returns the original job and does not start a second provider call. In-progress jobs fail on restart with the parent unchanged. Ready artifacts stay published.

- `Host` must match the configured public host exactly. `X-Forwarded-Host` and `X-Forwarded-Proto` are honored only from an allowlisted proxy address, and the forwarded host must still be on that list. `https` is required when a proxy is used.
- `Origin` on `POST /api/remixes` must match the configured origin exactly.
- Localhost is rejected as a public host, origin, or artifact redirect. Artifact responses never send `Location`.
- `POST /api/investigations`, `POST /api/roadster/transfers`, and `/recovery-projects/` are rejected. Broad recovery stays off.
- Remix creation requires an invite (`x-invite-code`), `adultConfirmed: true`, a session id, and an idempotency key. A session gets two jobs. One job runs at a time.
- The model is Standard `muse-spark-1.3`. Contributor mode is not a public-traffic model. Any generation client reserves the whole $0.15 remix cap on an explicit existing ledger before the provider call. The public category stays unused.
- `GET /privacy` is the short retention note. Playback does not call a model.

The shared phase ledger is `reports/motion-transfer-phase`. `reservePublicGeneration` requires that explicit directory. It throws while `releasePublished` is false, and charging the shared directory also requires the confirmation string `charge-shared-public-reserve`. A missing shared ledger is not created. The separate public-reserve helper is not used by the PARALLAXIA flow. The $15 public category stays unused. Tests that exercise the helper use a temporary ledger.

## Local commands

The root package provides the corresponding hosting script aliases.

```sh
node --test --test-concurrency=1 tests/hosting.test.mjs
node --test --test-concurrency=1 tests/hosting-isolation.test.mjs
node hosting/broker-main.mjs
docker build -f Dockerfile -t motion-transfer-verifier:local .
docker build -f Dockerfile.coordinator -t motion-transfer-coordinator:local .
```

Available aliases: `verify:hosting`, `verify:hosting:isolation`, `hosting:broker`, `hosting:image`, and `hosting:coordinator-image`. No new npm dependency is required. Docker and the pinned Node 22 image are external.

`HOSTING_BROKER_SOCKET` must be set for the coordinator to reach the host broker. `HOSTING_INVITE_CODES` is required before any remix is admitted. Neither value belongs in the repository.

## PARALLAXIA local workflow

After reconciling `reports/motion-transfer-phase/phase-budget.json`, build the verifier with `npm run hosting:image` and run `npm run dev:transfer`. Configure `MODEL_API_KEY` in the ignored `.env`. Playback and accepted JUJUMP reuse are free of model requests. Clicking Generate sends a real Standard request with the exact parent mapping/source. Native and Canvas checks run inside Docker before a child can publish.

One $0.15 reservation covers the first candidate and at most one feedback-driven repair. Raw requests, responses, failed checks and returned usage are retained under the local live store; uncertain calls retain their bound and are never silently retried. A browser refresh uses the same durable job/key, and a server restart preserves terminal results and fails incomplete jobs without issuing another request. Parents remain available.

PARALLAXIA roots may be seeded from their independently verified artifact directory. The seed checks artifact/file hashes, the accepted component pin, source/frame evidence and the pinned recipient revision. Public request bodies cannot supply a root, source, component or recipient. Generated child downloads additionally include source, notices, generation history and receipts as `download.zip`; the existing HTML download remains compatible.

Validation on this Mac: the formerly failing `npm run verify:hosting:isolation` passed with no skips (218.24 seconds). The direct Roadster worker response also passed all eight browser gates; the historical other-Mac failure could not be reproduced. Rejected payloads are now retained with failed attempts rather than discarded behind the generic publication error. No isolation check was weakened.
