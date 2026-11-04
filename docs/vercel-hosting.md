# Vercel Hobby deployment

Public URL: https://motion-transfer-rl7x.vercel.app

The deployment supports actual Standard Muse Spark generation, the native PARALLAXIA game, saved history, checkpoint experiments and exact downloads. It is not a static playback copy.

## Runtime

The Vercel Function in `src/hosting/vercel-function.mjs` proxies the application to a named persistent Sandbox. It validates the public host and same-origin JSON writes, rejects broad recovery requests, and adds a private credential that browsers never receive. The Sandbox ingress rejects direct unauthenticated traffic before reaching the loopback application.

The application Sandbox owns the provider client, job journal, saved artifacts and the existing phase spending ledger. `scripts/serve-vercel-backend.mjs` starts the same workbench and coordinator used by the local application, with public session quotas and a confirmed public origin.

Verification runs in a separate, short-lived microVM for each typed operation. The Function creates these from a prepared snapshot with no provider key, proxy credential, ledger or private job history. Network egress is denied. Generated code runs as uid `10001`, without sudo access, against source owned by root and not writable by that user. Only `/tmp` and the bounded result directory are used for output. The existing worker, named checks, source/component/frame identity checks and safe result-file reader remain in use. Native operations receive one vCPU; browser operations receive two. Vercel applies the VM memory and CPU bounds, and both the worker controller and VM enforce timeouts.

Nested Docker starts on Vercel but its memory cgroup controls were incompatible with this Sandbox environment. The cloud path therefore uses Vercel microVM isolation directly. It does not bypass the native or browser verifiers. The existing Docker transport remains available for local verification.

Persistent Sandbox snapshots retain the application filesystem across stops and resumes. Only the latest application snapshot is retained. A restart marks interrupted jobs failed without repeating inference; completed publications and request keys remain available. The Function retrieves the existing named backend rather than creating a replacement allowance if its data is unavailable.

## When the backend is asleep or paused

The page, its CSS and its JavaScript are static files, so they load without running the Function or waking the Sandbox. Saved versions and playable games are stored beside the Function, so they don't wake it either.

Only the live catalog, generation status and new generations need the Sandbox. If it takes more than 4 seconds to wake, the visitor gets the saved catalog while the wake finishes in the background. If it can't start at all, for example once a Hobby quota is used up, the saved site keeps working and generation shows as unavailable.

A remix that ends without a confirmed bill keeps its whole ceiling held, and the next visitor can still generate. An uncertain charge from anything other than a remix job still stops inference until it's reconciled.

## Costs and limits

- The project uses the Hobby plan, with no Pro upgrade or paid add-on. Vercel's included quotas apply; exceeding them pauses usage rather than charging Hobby overages. See [Sandbox pricing](https://vercel.com/docs/sandbox/pricing).
- The public cap is **$0.50 for the complete job**, including at most one repair. The coordinator reserves the full amount before contacting Meta and settles measured usage afterward. Uncertain charges remain reserved.
- Each browser session receives two requests; only one job runs at a time. The existing overall $50 definition, allocation limits and historical reservations are retained. Older five-dollar envelopes used the reserve category so historical remix charges do not make the full reservation impossible.
- Meta calls consume API credits. Deployment-time billing showed free credits active and a $0 billed balance. The application ledger is an additional usage bound, not an authoritative provider credit balance.
- Hobby Sandbox sessions have a maximum duration of 45 minutes. The persistent backend wakes on demand and may have a cold start. Quota exhaustion can make the app unavailable until the quota resets.

## Ledger ownership

The deployment migrated 132 existing data files from the measured campaign and local preview. Every file matched its source hash. The spending ledger's SHA-256 at migration was `e613a20648029ee93131002c7b4096ec6773780c95c8d5219174ceca58d491bd`; it was copied without resetting the allowance or rewriting reservations.

The cloud copy is now authoritative. The ignored `.vercel/remote-generation.json` marker disables the local preview's model client, preserving local saved playback without creating an independent spendable copy of the same allowance. Do not remove that marker or start another spending coordinator against the old local journal. Download and reconcile the authoritative journal before transferring ownership back.

## Build and configuration

The deployment SDK is pinned in `src/hosting/vercel/package.json` with its own lockfile. The root dependency lock remains unchanged because it is an input to frozen historical studies.

```sh
npm ci
npm run build:vercel
npm run snapshot:site
npx vercel@65.11.0 deploy --prebuilt --prod
```

The linked Vercel project requires `MOTION_PUBLIC_HOST`, `MOTION_SANDBOX_NAME`, `MOTION_PROXY_KEY` and `MOTION_WORKER_SNAPSHOT_ID` in its production environment. The application Sandbox holds `MODEL_API_KEY`; verifier sandboxes receive none of these credentials. Vercel manages the Function's project-scoped OIDC authentication. Values, local CLI metadata and operational state are ignored by Git and excluded from Docker build contexts.

The backend and verifier snapshot must be provisioned before deploying the gateway. A fresh checkout does not contain the cloud job store or spending ledger and must not manufacture replacements. Updating the gateway does not replace the persistent backend filesystem; upload and validate backend source changes separately.

## Validation

- `npm run build:vercel` — builds a loadable Node.js gateway using the Build Output API.
- `node --test --test-concurrency=1 tests/vercel-hosting.test.mjs tests/repository-layout.test.mjs tests/hosting.test.mjs` — 32 passed. Covers origin/host checks, private ingress, request size, exact downloads, typed worker transport, the $5 reservation and local ledger ownership.
- `npm run typecheck`, `npm run lint`, `npm run format:check` — passed.
- The broader `npm test` run initially had 367 passes, one failure and one skip. Its failure correctly detected that adding a deployment SDK changed the frozen root lockfile. The SDK was moved into its own package and the root lock restored; all three repository-layout checks subsequently passed. The skip remains the unavailable pinned Muse echo executable.
- Real Vercel workers passed credential, egress and write probes, plus all 13 native and 3 browser checks. The generated-code account also failed an attempted sudo command, as required.
- A real public API request generated artifact `f14d28e4f4ad5ea3770dc4a25064fd7968728d9e757de4186526a08c2c9ab68e`, with estimated credit usage `$0.00772525`. All 16 checks passed. Repeating its request key returned the same job without another inference call.
- The generated ZIP passed integrity checks for all 11 entries. Its stored generation record confirms the $5 cap and reserve category. The saved job and publication remained available after stopping, snapshotting and resuming the backend.

Operational logs and migration hashes remain in ignored `reports/vercel-deployment/`.
