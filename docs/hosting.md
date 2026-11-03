# Hosting

This is local release packaging for bounded public remixes. It does not deploy the service, change repository visibility, or spend the shared public reserve.

Playback and creation are separate. The coordinator admits requests, talks to the model provider, accounts for them, and publishes artifacts. Generated adapter code is compiled and executed only inside a short-lived verifier container. If that container cannot be started, hosted mode stops. It does not fall back to the local `vm` worker.

## Processes

| Process | Where it runs | What it can do |
| --- | --- | --- |
| Coordinator (`hosting/serve.mjs`) | Public HTTP process. The Compose service has no Docker socket. | Host, origin, and proxy checks; invite and session quotas; Standard Muse Spark requests; artifact publication. |
| Broker (`hosting/broker-main.mjs`) | Host only. | Accepts one typed job over a Unix socket and starts one locked-down container. |
| Worker (`hosting/worker.mjs`) | Verifier container. | Runs the existing Roadster native and browser verifiers, or a fixed isolation probe. |

The worker image is `motion-transfer-verifier:local`, built from `Dockerfile` on `node:22-bookworm` with Playwright `1.64.1` from `package-lock.json`. The coordinator image is `motion-transfer-coordinator:local` from `Dockerfile.coordinator`. It does not contain the broker, worker, or evaluator.

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

The job cannot choose an image, command, mount, or environment. The broker passes `PATH`, `HOME`, `TMPDIR`, and Playwright cache settings. It does not copy the host environment. `MODEL_API_KEY` and `HOSTING_SECRET_MARKER` are refused if they appear in the container.

Chrome is started through `/opt/google/chrome/chrome` because the existing browser verifier launches Playwright with `channel: 'chrome'`. The wrapper adds `--no-sandbox` and `--disable-dev-shm-usage`. Dropping every capability removes the privileges Chrome's setuid sandbox needs; the container boundary is the isolation. The wrapper is not a command channel.

Stdout is capped at 64 KB. A verified frame written to `/output` is capped at 8 MB and must match the hash the browser verifier returned. The native worker also returns the compiled adapter JavaScript, at most 32 KB, so a later lab publish can store `adapter.js` without compiling on the coordinator. Anything else in the output directory fails the job.

## Public API

`createHostingServer` is the production admission surface. `checkPublicEdge` is the host and proxy check without the route allowlist, so a preview server can keep playback routes. The unapplied patch for `web/server.mjs`, `lab/service.mjs`, and `agent/transfer-roadster.mjs` is `/tmp/motion-transfer-cursor/hosting-integration.patch`. This tree does not edit those files.

- `Host` must match the configured public host exactly. `X-Forwarded-Host` and `X-Forwarded-Proto` are honored only from an allowlisted proxy address, and the forwarded host must still be on that list. `https` is required when a proxy is used.
- `Origin` on `POST /api/remixes` must match the configured origin exactly.
- Localhost is rejected as a public host, origin, or artifact redirect. Artifact responses never send `Location`.
- `POST /api/investigations`, `POST /api/roadster/transfers`, and `/recovery-projects/` are rejected. Broad recovery stays off.
- Remix creation requires an invite (`x-invite-code`), `adultConfirmed: true`, a session id, and an idempotency key. A session gets two jobs. One job runs at a time.
- The model is Standard `muse-spark-1.3`. Contributor mode is not a public-traffic model. A remix request is capped at $0.15 before a provider call.
- `GET /privacy` is the short retention note. Playback does not call a model.

The shared phase ledger is `reports/motion-transfer-phase`. `reservePublicGeneration` throws while `releasePublished` is false, and charging that shared directory also requires the confirmation string `charge-shared-public-reserve`. This release never passes either. The $15 public category stays unused. Tests that exercise the helper use a temporary ledger.

## Scripts the root package should gain

Do not add these in this change. The root `package.json` is owned elsewhere.

```sh
node --test --test-concurrency=1 tests/hosting.test.mjs
node --test --test-concurrency=1 tests/hosting-isolation.test.mjs
node hosting/broker-main.mjs
docker build -f Dockerfile -t motion-transfer-verifier:local .
docker build -f Dockerfile.coordinator -t motion-transfer-coordinator:local .
```

Suggested names, when a package script is allowed: `verify:hosting`, `verify:hosting:isolation`, `hosting:broker`, `hosting:image`, and `hosting:coordinator-image`. No new npm dependency is required. Docker and the pinned Node 22 image are external.

`HOSTING_BROKER_SOCKET` must be set for the coordinator to reach the host broker. `HOSTING_INVITE_CODES` is required before any remix is admitted. Neither value belongs in the repository.
