# Static playback release

`reports/release` is a generated static site. It plays the saved Roadster challenge, the saved transfer it was built from, and one intact saved remix chain from `reports/lab/artifacts`. Creation is not included. The directory is gitignored and replaced only after its manifest, files, and browser check agree.

The React shell reads `window.__MOTION_TRANSFER__` from `web/app/data-source.ts`. `generation` is `playback-only`. `resources` is a GET catalog keyed by URL pathname, which is what `fetchJson` consults before using the network. `release/boot.js` sets `basePath` from the page URL and rewrites root-absolute asset URLs on the index document. Version pages do not load that boot script. Their links are relative, so a cold URL such as `versions/<id>/index.html` works on a project subpath.

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
node --test --test-concurrency=1 tests/release.test.mjs
```

`build-release` writes a sibling staging directory, audits it, serves it at `/preview/` on `127.0.0.1`, and renames it onto `reports/release` only after that check passes. `verify-release` repeats the audit and browser check on the published directory. `smoke-hosted` is read-only: it checks the index, the injected catalog, a version page, a parent link, and that the download bytes match the manifest. `POST` is rejected. It does not open `reports/motion-transfer-phase/phase-budget.json`.

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

## React patch for nested routes and share

Index assets and anchors are prefixed by `release/boot.js`. Two React behaviors still need a patch in `web/app` before a nested public host is correct. Do not apply this from the release build.

`MotionDataSource` needs the runtime fields the boot script already writes:

```ts
export interface MotionDataSource {
  generation?: GenerationMode;
  publicOrigin?: string | null;
  basePath?: string;
  resources?: Record<string, unknown>;
}
```

Route matching in `web/app/transfer-context.tsx` should strip `basePath` before the existing `/roadster/play/:id` and `/play/:id` tests. `history.pushState` already goes through the boot prefixer on the index page. `share()` does not. It should use `publicOrigin` when that string is set. When it is unset and the hostname is not `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, or `[::1]`, it should set the share message to “A public link is not configured.” with an empty URL and must not call `describeShare` with `location.origin`. On a local host, the copied URL should include `basePath`.

Version pages already follow those rules without the patch. The patch is for the React shell’s own share control and for opening a React route below a subpath.

## Limits

Playback does not start a model request. The 18+ confirmation applies to creation, which this tree does not offer. The release includes the Roadster destination and one lab remix chain. Other destinations are left out of the injected catalog so the shell does not offer a player this tree cannot serve. Drawer requests that are not part of playback can still 404; they are not generation. Rebuild after the frontend changes, then rerun `verify-release`.
