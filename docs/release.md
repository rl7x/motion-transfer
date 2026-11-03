# Static playback release

`reports/release` is a generated static site. It plays the saved Roadster challenge, the saved transfer it was built from, and one intact saved remix chain from `reports/lab/artifacts`. Creation is not included. The directory is gitignored and replaced only after its manifest, files, and browser check agree.

The React shell reads `window.__MOTION_TRANSFER__` from `web/app/data-source.ts`. `generation` is `playback-only` and `recovery` is `saved`. `resources` is a GET catalog keyed by logical pathname. `fetchJson` uses that catalog before the network, then prefixes a real request with `basePath`. `release/boot.js` only injects that data, including `basePath` taken from the page URL. It does not patch `history`, `fetch`, or DOM prototypes. `appPath`, `logicalPathname`, and `linkHref` prefix root-absolute routes when a nested prefix is set. With no prefix, or a prefix of `/`, those helpers return the original path.

Version pages keep static metadata. A challenge page mounts `web/app/release-player.tsx` from `assets/release-player.js`. That entry uses React state and removes its window listeners on cleanup. Its frame and script URLs are relative, so `versions/<id>/index.html` works on a project subpath. Non-challenge version pages keep a static frame.

## Build and check

These scripts are not in `package.json` yet. Run them directly, or add:

```json
"build:release": "node scripts/build-release.mjs",
"verify:release": "node scripts/verify-release.mjs",
"smoke:hosted": "node scripts/smoke-hosted.mjs"
```

```bash
node scripts/build-release.mjs
node scripts/verify-release.mjs
node scripts/smoke-hosted.mjs
node scripts/serve-release.mjs --root reports/release-accepted --port 4173 --base-path /motion-transfer/
node --test --test-concurrency=1 tests/release.test.mjs
```

`build-release` writes a sibling staging directory, audits it, serves it at `/motion-transfer/` on `127.0.0.1`, and renames it onto `reports/release` only after that check passes. `verify-release` repeats the audit and browser check on the published directory. `smoke-hosted` is read-only: it checks the index, the injected catalog, a version page, a parent link, and that the download bytes match the manifest. `POST` is rejected. It does not open `reports/motion-transfer-phase/phase-budget.json`.

Optional directories do not run unless named. They do not turn the frontpage into a fresh recovery:

```bash
node scripts/build-release.mjs --extra-artifacts /path/to/artifacts --challenge /path/to/challenge
```

`--extra-artifacts` reads another intact Roadster parent chain when that directory exists. `--challenge` replaces the built featured challenge with files from that directory. The directory must name the saved Roadster parent, match its manifest hashes, and record the saved landing result. The injected catalog stays `recovery: saved`. A missing raw Wonder artifact is not read, and the page keeps the saved-recovery label. Omit both flags for the saved parent, the built challenge, and the lab remix chain.

An accepted Roadster delivery is a separate build. It does not replace `reports/release`. The tracked pin is enough on its own:

```bash
node scripts/build-release.mjs --accepted-roadster transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c
```

That directory must contain `delivery.json`, `journal.json`, `published/artifacts/<id>/`, and `challenge/`. The loader checks the receipt hash, requires `status: delivered` with `liveMeta: true`, `fixture: false`, and `injected: false`, reads the artifact with `readRoadsterArtifact`, and resolves `artifact.component` with `resolveComponentRef`. That package includes its publication, file, and acceptance hashes. Receipt, journal, generation, and challenge ids must match, and the challenge source must equal the resolved source. A report in a directory beside the delivery is an additional cross-check when it is present. A missing report does not stop the build. The saved component is not a fallback. A fixture, an injected run, or a malformed component package stops the build. The page says `ACCEPTED RECOVERY`. Destinations whose component id differs are left out. `--challenge` and `--extra-artifacts` cannot be combined with this flag.

The accepted bundle also copies the pinned JUJUMP publication `f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57` under `jujump/`. Its component id must match the accepted Roadster. The page links to `/jujump/index.html`, the standalone comparison. That link is not a destination in the three-frame player.

Review the accepted bundle locally:

```bash
node scripts/serve-release.mjs --root reports/release-accepted --port 4173 --base-path /motion-transfer/
```

`serve-release` audits the directory, then serves it on `127.0.0.1` only. Open `http://127.0.0.1:4173/motion-transfer/`. This is local review, not deployment.

A public origin is optional and must already be known:

```bash
RELEASE_PUBLIC_ORIGIN=https://example.com/repo/ node scripts/build-release.mjs
```

The value must be `https`, with no user, password, query, or hash. The path is the site prefix and is stored with a trailing slash. An empty value leaves every page with “A public link is not configured.” and no share URL. Do not invent an origin in order to build.

## What each version contains

`manifest.json` lists every file except itself and `manifest.sha256`. Its `id` is the SHA-256 of the manifest body. `manifest.sha256` is the SHA-256 of the exact manifest bytes. For each version:

- `index.html` is the playback page
- `frame.html` is the isolated game
- `download.zip` is the exact stored artifact
- `source.json` is the artifact identity
- `notices.txt` and `adapter.ts` are the same bytes named by that identity
- evidence is `challenge.json` or `verification.json`

`generation.json` stays inside a Roadster download. It is not a loose file. The tree does not contain `.env`, `phase-budget.json`, or a spending journal.

## Host it

Upload the directory as the site root, or as a project subpath, without rewriting links. `.nojekyll` is included for GitHub Pages. Serve `GET` and `HEAD` only. Do not point the directory at the Node API, and do not add creation endpoints. A container can do the same thing: static files on port 80. Set `RELEASE_PUBLIC_ORIGIN` to the real `https` origin, including the subpath, and rebuild before publishing share links.

`node scripts/smoke-hosted.mjs --generate` is the opt-in generation gate. Without `RELEASE_GENERATION_HOOK` or `--hook`, it exits 2 and does not open the shared ledger. A hook is an orchestration entry point, not part of this playback tree. This task does not call it.

## Nested routes and share

`MotionDataSource` carries `generation`, `publicOrigin`, `basePath`, `recovery`, and `resources`. `recovery` is `saved` unless the build was given `--accepted-roadster`, in which case boot keeps `accepted`. Route matching strips `basePath` before the `/roadster/play/:id` and `/play/:id` tests. `history.pushState` and root-absolute links go through `appPath` / `linkHref`. `share()` uses `publicOrigin` when that string is set. When it is unset and the hostname is not `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, or `[::1]`, the share message is “A public link is not configured.” with an empty URL. On a local host, the copied URL includes `basePath`. An unset base path leaves local routes unchanged.

## Limits

Playback does not start a model request. The 18+ confirmation applies to creation, which this tree does not offer. The saved release includes the Roadster destination and one lab remix chain. The accepted release includes the delivered Roadster parent, its challenge, and a link to the standalone JUJUMP comparison. Other destinations are left out of the injected catalog when their component id differs, so the shell does not offer a player this tree cannot serve. In playback, the evidence drawer links the bundled component source, version report, adapter, and notices. Developer-task, benchmark, and investigation controls stay on the local preview and are not mounted in playback. `browserCheck` opens those drawer controls and requests every supported source and evidence link. On an accepted copy it also opens the JUJUMP comparison with WebGL2 unavailable and runs that comparison. A 4xx response fails the check. Favicon requests are the exception. Rebuild after the frontend changes, then rerun `verify-release`.
