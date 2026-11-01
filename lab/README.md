# Investigation and transfer lab

The preview can run fresh Meta investigations of the pinned compiled donor. Each run shows actual tool requests, hypotheses, observations and public conclusions. Loading the page does not call Meta. Conclusions retain `conclusionVerified: false`; completion checks evidence presence, not the correctness of an interpretation. The saved recovered component stays frozen.

All new investigation and Roadster generation trials share the persistent **$10 estimated generation ceiling** in ignored `reports/lab/`. Each investigation is capped at $0.50 and six generation requests; Roadster generation is capped at $0.05. The existing PAKU remix journal and $0.10 cap remain separate. One lab task runs at a time. Input-token preflight, saved reservations, returned usage and no automatic retries are required. Uncertain billing blocks further lab generation across restarts. Do not delete the journal to reset spending.

`POST /api/investigations` accepts `{questionId: "held" | "neutral", idempotencyKey}`. `GET /api/investigations/<id>` returns real sequenced job progress and the public report. `GET /api/lab/status` returns availability and persistent accounting. POST requests require same-origin JSON, bounded input and a unique request key; repeating the same request reconnects to the same job.

The model receives the donor controls and its own tool observations, not original donor source, the recovered controller, saved conclusions or acceptance answers. A human supplies the registered target, tools and questions. Automated tests use explicitly injected fixtures and make no paid calls.

The host also supplies world-coordinate motion and timer observations through the existing human-mapped, hash-guarded donor registry. Meta chooses the inputs and interpretation; it did not discover the registry layout. The default neutral question deliberately tests a leftward history, which distinguishes preservation from a rightward default.

**View recorded investigation** loads `GET /api/investigations/saved/neutral-after-left` without inference. The hash-checked recording includes the actual model requests, experiments, complete donor observations and qualified conclusion. In that run Meta's preservation hypothesis was contradicted: after a left dash and full recharge, neutral moved right while left-held moved left. Why the donor chooses right remains outside that investigation's conclusion.

Both forms save the idempotency request before POST. If the response is lost, a deliberate reconnect reuses it; refreshing never starts a new paid request automatically. Jobs with known IDs resume polling. Roadster child lineage and full inherited intent are verified independently of natural-language interpretation.
