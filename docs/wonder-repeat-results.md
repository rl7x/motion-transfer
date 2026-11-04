# Wonder repeat trials

**Muse Wonder's recovery isn't reliable yet: both frozen repeat sessions were rejected, so 1 of 3 full sessions under these rules has produced an accepted dash.**

Later sessions on an improved harness are measured separately in [the harness experiments](wonder-harness-results.md). The dash in every game on this site comes from the first session, and that candidate passed all 13 development checks and all 20 acceptance checks. These trials measure something different: how often Wonder gets there.

| Session | Result | Best development | Unseen acceptance | Candidates | Requests and time | Estimated cost |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| First session | Accepted | 13/13 | 20/20 | 3 | 20 in 3.6 min | $1.69 |
| Repeat 1 | Rejected | 11/13 | Not reached | 5 | 29 in 7.3 min | $3.33 |
| Repeat 2 | Rejected | 13/13 | 5/20 | 2 | 19 in 5.4 min | $2.06 |
| Repeat 3 | Not run | — | — | — | — | — |

## What happened

- **Repeat 1 never reached acceptance.** Its candidates climbed to 11 of 13 development checks, then stayed there. They kept missing `startup-held` and `held-retrigger`, moving between two near-misses one tick apart.
- **Repeat 2 looked finished and wasn't.** Its second candidate passed all 13 development checks and was frozen. It then passed only 5 of 20 unseen acceptance checks, and the first of those failures diverged at tick 44. That candidate was rejected, which is the job acceptance exists to do.
- **Repeat 3 could not run.** Each trial reserves $6 before it starts, and $4.93 remained. The plan assumed each trial would cost about $1.69. The rules forbid adding or changing trials to improve the result, so it stays unrun.

## How this was run

The plan in [`src/benchmark/wonder-repeat-tasks.json`](../src/benchmark/wonder-repeat-tasks.json) was committed before the first repeat. It fixed the number of trials, the definition of success and the reporting rules. A success needs a candidate that passes every development check, is frozen, and then passes every acceptance check.

The model, task and limits match the first session, and the evaluator, check cases, agent loop and output contract are byte-identical to it. The protocol id differs because other hashed files moved or changed afterward. Each repeat ran through the authoritative cloud ledger with Muse Wonder 1.0, and no result was retried.

## Limits

- Three sessions is far too few for a rate. The 95% Wilson interval for 1 of 3 is about 6% to 79%.
- By the frozen rules the first session is a baseline, so the planned measure is 0 of 2 repeats. The 1 of 3 figure includes that first session for context.
- The first session ran on a Mac and the repeats on the cloud backend. The evidence Wonder received comes from the same pinned cartridge, and its early expected values match.
- Short Wonder calls from November 1 are not counted. They predate this protocol and were not full recovery sessions.
- The two repeats cost an estimated $5.38, more per session than the first.

Run `npm run verify:evidence` to recompute these numbers from committed files. It makes no model request.
