# Creator page

A single public page for the hosting service. Playback of a catalog parent works when generation is off. Creation is a Standard Muse Spark remix and stays disabled until both the catalog and `GET /api/remixes/status` report generation as configured, the visitor checks 18+, and they enter an invite code. A failed status read leaves creation disabled.

The page does not claim a fresh recovery, invent a public hostname, or show source, adapter, report, or notices links unless the response includes those paths. A published job's `urls.adapter` path is the adapter link.

## Build

`scripts/build-creator.mjs` exports `buildCreatorPage()`. It uses esbuild on `web/app/creator/main.tsx` and returns one HTML document with the CSS and JavaScript inlined. The CSS is the shared Afterimage Arcade block from `web/style.css` followed by `creator.css`, so the coordinator image copies `web/style.css` into its build stage. A job's `events` drive the shared pipeline track, and a published version can open its saved Meta response and checks. The coordinator should send that document as `text/html`. It should not evaluate the script.

```sh
node scripts/build-creator.mjs [output-directory]
```

Without a directory, the command prints the byte size and writes nothing.

## What the page calls

| Action           | Request                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Load the catalog | `GET /api/catalog`                                                                                                                   |
| Read generation  | `GET /api/remixes/status`                                                                                                            |
| Create           | `POST /api/remixes` with `x-invite-code` and JSON keys `adultConfirmed`, `idempotencyKey`, `parentArtifactId`, `prompt`, `sessionId` |
| Reconnect        | `GET /api/remixes/:id` using the id stored for that browser session                                                                  |

Relative paths from the catalog and job are the only frame, download, and copy targets. A path must start with a single `/`.

The game iframe uses `sandbox="allow-scripts"` and never `allow-same-origin`. One iframe is mounted. Clicking it uses the frame's own keys. A parent dash control is not part of the catalog contract. If a catalog version sets `controls` to `challenge`, the page can also post the existing `challenge-command` / `original` watch message.

Session state is `sessionStorage` key `motion-creator-session` when that write succeeds: session id, invite, age checkbox, and the in-flight idempotency key plus job id. A refresh with a stored job id polls. It does not create a second remix. If storage is blocked or full, this tab keeps the invite and age confirmation in memory. A reload does not resume that remix. Leaving the page aborts the browser wait. It does not remove a job the service already accepted. A later visit sends the same idempotency key only when that key was stored. There is no account.

## Hosting hooks

Hosting serves `index.html` from this build at `GET /` when `web/dist/creator/index.html` exists or `HOSTING_CREATOR_ROOT` points at the output directory. `GET /api/catalog` is the catalog. Field details are in `/private/tmp/motion-transfer-cursor-next/hosting-contract.md`.
