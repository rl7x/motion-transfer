# Auto-port results

**Muse Spark connected the recovered dash to 7 of 8 eligible games it had never seen.** Two more games were excluded before any request, and every game is reported below. The campaign used 10 Muse Spark responses and an estimated $0.33.

The campaign was frozen at commit `d82bf6b` before the first request. That commit fixes the games, the exclusions, the model settings, the verification limits and the hash of every measuring file, and the runner refuses to start if any of them change. Each game could use two attempts, the second with the verifier's feedback.

## Results

| Game | Outcome | Attempts | Dash measured (game units) | Estimated cost | Notes |
| --- | --- | ---: | --- | ---: | --- |
| SKYHAUL | Passed | 1 | 30.00 of 30 | $0.0359 | First attempt |
| UNDERTOW | Passed | 1 | 60.00 of 60 | $0.0327 | First attempt |
| WRECKFALL | Passed | 1 | 30.00 of 30 | $0.0304 | First attempt |
| HEAD RUSH | Passed | 2 | 60.00 of 60 | $0.0739 | Passed on its one repair |
| PILEUP | Passed | 1 | 480.00 of 480 | $0.0365 | First attempt |
| ZIG SABER | Passed | 1 | 30.00 of 30 | $0.0342 | First attempt |
| BLINK SCOPE | Passed | 1 | 60.00 of 60 | $0.0228 | First attempt |
| DRAFT LINE | Failed | 2 | — | $0.0623 | Rejected by dash-fidelity |
| OVERTURN | Excluded before any request | — | — | — | Flipperless pinball: the only control rotates the table, so there is no steerable avatar to dash. |
| TWIN VECTOR | Excluded before any request | — | — | — | The avatar moves between discrete lanes, so a measured pixel burst has no defined meaning. |

## What was checked

Spark received one game's simulation source, the dash's interface, one worked example and the list of checks. It returned literal anchored patches in one strict tool call. An isolated worker, with no network and no credentials, then ran seven checks. All seven had to pass:

1. Every anchor matches exactly once.
2. The patched game loads.
3. The game's own bot plays three seeds for 1,200 ticks, and the state matches the original on every tick.
4. The game's own tests still pass.
5. One dash moves the avatar the claimed distance, compared with an identical run without it.
6. Holding the dash cannot start a second one before the recovered recharge ends.
7. The game runs in a real browser, and the dash fires from its key.

The drivers that measure each game are hand-written and Spark never sees them, so it cannot change how it is graded. Before the freeze, a hand-written port of each eligible game had to pass all seven checks, which found and fixed several harness bugs. Deliberately broken ports fail the check built to catch them. The hand-written ports live in [the test fixtures](../tests/fixtures/auto-port-references.mjs).

## Failures and repairs

- **HEAD RUSH passed on repair.** Spark's first patch projected the dash onto the direction of the track, and one dash measured 37.5 of 60 units. The verifier reported the shortfall, and Spark's second patch added the burst's full size along the track, which measured 60 of 60.
- **DRAFT LINE failed.** Spark aimed the dash forward along the road. Its first scale gave a 300-unit burst, far outside the 3.8-unit road width. Its repair fixed the scale, but the frozen driver applies no steering and reads only sideways position, so a forward dash measured 0. A forward dash is a reasonable design for a racer, so this failure is partly a limit of the driver. It stays a failure, because changing a frozen driver after seeing a result would invalidate the campaign.

## The port command on an outside game

`npm run port` runs Spark on a game with no hand-written driver. To test it, we used [Tiny Platformer](https://github.com/jakesgordon/javascript-tiny-platformer), an MIT game by Jake Gordon from outside the campaign collection. This is one small trial on one game. It is separate from the frozen campaign, and the guidance changed between runs.

Without a driver, the command can only check that the patches apply, the page runs and the dash fires. So this game was measured separately: 2,007 dashes from all 223 standing spots in 9 situations, including reversing, jumping and mid-air dashes. The sweep follows the player along each tick's whole path. The same moves with no dash raise no alarms.

| Run | Playtest note | Dashes into walls | Left the map | Estimated cost |
| --- | --- | ---: | ---: | ---: |
| First port, before any guidance | No | 632 | 265 | $0.0246 |
| Revised with a playtest note | Yes | 74 | 0 | $0.0280 |
| Fresh port with early guidance | No | 83 | 0 | $0.0316 |
| Revised with a second playtest note | Yes | 0 | 0 | $0.0183 |
| Fresh port with final guidance, stopped at the output limit | No | No port | — | $0.0436 |
| Fresh port with final guidance | No | 0 | 0 | $0.0485 |

Every saved port played identically to the original over 3,600 ticks with no dash, and every dash fired. The six runs cost an estimated $0.19.

- **The first port passed every automatic check and was still broken.** It moved the player directly, so the game's collision code never saw the dash.
- **Playtest notes fixed it in two rounds.** The first note stopped the player leaving the map. The second made collision follow the direction of the dash when it disagreed with the player's velocity.
- **That lesson now goes out with every request.** With it, a fresh port reached 0 on its first attempt. That is one clean run, and the fresh run before it spent its whole output limit and submitted nothing.
- **The incomplete run stays held at its ceiling.** The ledger keeps its full $0.25 reservation, because it cannot prove the final bill.

`tests/port-command.test.mjs` reproduces every number in this table from the saved patches, with no model request. The measurement itself is in [the test fixture](../tests/fixtures/port-example-sweep.mjs).

## Limits

- All ten games come from one author and collection, and they share a clean structure: deterministic simulation, seeded randomness and a separate core file. This is not a success rate for arbitrary games.
- This is one run with one model. It is not a reliability estimate.
- The seven checks measure a dash in open space. They do not test whether walls stop it, so a campaign port could still pass through one. Tiny Platformer exposed this blind spot after the campaign was frozen.
- The check for a game measures what its driver reads. Passing means the dash works and native behavior is unchanged when unused, not that the dash is well balanced.
- BLINK SCOPE steps its simulation at 120 Hz in the browser, so the dash and its recharge run at double speed in that page. The tick-based checks don't show this.
- OVERTURN has no avatar, and TWIN VECTOR moves between discrete lanes, so a measured pixel burst has no meaning there.
- Cost is estimated from returned usage at published prices.

Run `npm run verify:evidence` to recompute these numbers from committed files. It makes no model request.
