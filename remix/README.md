# Live adapter remixes

Run `npm run dev:transfer`, open `http://127.0.0.1:4173`, and describe a supported change. The server loads `MODEL_API_KEY` from `.env`. Opening or playing the page never generates a model request; submitting the form does.

The supported mapping is explicit: distance scale 0.125–1.5 (7.5–90 recipient pixels), held or fresh-press activation, and forward or backward direction relative to facing. Muse Spark receives the exact parent source and complete inherited intent, then submits complete adapter source and the new intent. Its interpretation is displayed to the user. The tests verify that interpretation; they do not prove that arbitrary natural language was understood correctly. Unsupported requests return an explanation. No-op mappings are rejected.

The recovered component, source width 8, donor defaults, and recipient rules stay fixed. A fresh press means a false-to-true edge of the raw dash button. A press during cooldown is consumed rather than buffered. Mapping a dash backward does not reverse normal walking. All timers and active movement still come from the supplied component. The model does not receive expected trace outputs or verifier source.

A job moves through `queued → generating → building → testing → publishing → ready`, or `failed`. The model's tool submission cannot mark it ready. Twelve independent conformance cases check input mapping, displacement/events, normal speed, restart, and counterfactual delegation. Six real-browser checks cover ordinary play, core-state agreement, swept ghost contact/restart, wraparound, raw-input replay, and frame isolation. Collision checks use a declared high-speed fixture. The results cover these finite inputs, not every possible program execution. Failed jobs publish no playable child and keep their parent intact.

The emitted game is a standalone HTML bundle using pinned local runtime/audio, recipient source, component, adapter, and notices. It runs in an iframe with `sandbox="allow-scripts"`, without same-origin permission, with HTTP sandbox enforcement and a CSP that blocks network connections. Its pinned sound synthesizer uses dynamic oscillator functions, so script eval is allowed inside that isolated frame. Controls and HUD messages check the source window and a per-player channel; HUD messages are never verification evidence. Adapter conformance runs separately in a bounded process with no API credentials.

One job runs at a time. Each request has token-count preflight, one model call, a $0.03 estimated maximum, and no automatic retry. The entire local journal is capped at $0.10, including prior costs and unsettled reservations. A reservation is atomically saved before inference. Unknown billing stops further inference; restart cannot clear it. The journal directory has a single-process ownership lock. Do not delete `reports/remixes/` to reset spending: it contains the accounting history and saved games.

Accepted games use content-addressed manifests, with hashes of adapter TypeScript/JavaScript, standalone HTML, evaluation, model report, and notices. Files are written before a manifest becomes readable, verified again on read, and linked to one parent and the frozen component. A run becomes ready only after the artifact can be read back. New requests include the current child's full intent and source, so follow-up changes retain prior edits. Requests with the same idempotency key reconnect to the same run; reusing the key for different input fails.

The first real form submission requested backward dashing on a fresh press, preserving the 30-pixel distance. It passed all 18 checks and the preview's controls, with zero browser errors, for an estimated **$0.0058745**. Its request, accounting, progress, source, bundle, and report are retained locally under `reports/remixes/`. Automated tests use labeled fixtures and no paid API calls. Public hosting, multi-user sessions, cancellation, and an open-ended editing space remain future work.

| Route | Behavior |
| --- | --- |
| `GET /api/remixes/status` | Availability, active run, persistent budget, base ID |
| `POST /api/remixes` | Same-origin JSON `{parentArtifactId, prompt, idempotencyKey}` → run |
| `GET /api/runs/<id>` | Actual sequenced progress and terminal result |
| `GET /api/artifacts/<id>` | Intent, lineage, summary, evaluation counts |
| `GET /api/artifacts/<id>/source` | Download source, report and notices |
| `GET /artifacts/<id>/play.html` | Isolated standalone game |
| `GET /play/<id>` | Play and remix this child |

Links survive local server restarts and work while that server is available. This server binds to loopback; these are local links, not a public deployment.
