# Problem statement

The paragraph below is the one in the root README. It was placed there in the November 2, 2026 docs pass on `codex/playable-motion-remixes` at `f6cc282`. Links in the paragraph are relative to the repository root. The README states the one-behavior recovery and does not say that a whole-program decompilation was replaced. Recheck the paragraph if a later release changes the saved controller or the playable default.

## README paragraph

A July 2023 study for the Video Game History Foundation and the Software Preservation Network found that 87% of classic games released in the United States from 1960 through 2009 were not in release (n = 1,500, ±2.5% at 95% confidence; [87% Missing](https://gamehistory.org/87percent/)). Ars Technica, on May 6, 2020, reported that the volunteer whole-program decompilation of Super Mario 64 took about two years ([Beyond emulation](https://arstechnica.com/gaming/2020/05/beyond-emulation-the-massive-effort-to-reverse-engineer-n64-source-code/)). Motion Transfer recovers one behavior, the dash from the compiled [Dashy Dango](../assets/targets/dashy-dango/README.md) cartridge, and checks that [saved controller](../assets/components/dashy-dango-dash/README.md) on finite traces before replaying it in other games.

## Beneficiaries, in the order the repository can support

1. A developer who wants one specific feel inside a game they already have. The local evidence is author-built transfers of the saved dash into [PAKU PAKU](../assets/transfers/paku-paku/README.md), [JUJUMP](../assets/transfers/jujump/README.md), and [RDSTR Stunts](../assets/transfers/roadster/README.md). No outside developer session is recorded here.
2. A player who wants to change that dash without editing code. The local preview has a remix form, and this checkout has saved Roadster children under ignored `reports/lab/`. There is no public creation page and no counted creator session.
3. People working on old software that survives only as a binary. The availability study motivates that direction. This repository has not measured a preservation outcome.

## Boundary

The saved dash is one controller checked on finite traces. The [component record](../assets/components/dashy-dango-dash/README.md) reports 12 development traces, 21 regression traces, and 20 acceptance traces, 6,744 ticks, and zero measured position error at a 0.25 source-pixel tolerance, for the default configuration and source body width 8. Those checks leave full-game equivalence and whole-program decompilation as separate claims.

## Sources checked on November 2, 2026

| Claim | Source checked | What it supports |
| --- | --- | --- |
| 87% of classic US games from 1960–2009 were not in release; n = 1,500; ±2.5%; 95% CI | [87% Missing](https://gamehistory.org/87percent/), Kelsey Lewin, July 10, 2023. The page attributes the survey to Phil Salvador for the Video Game History Foundation and the Software Preservation Network, published July 2023. | The headline, the year span in the figure caption, and the sample line. The methodology PDF was not fetched. |
| Full Super Mario 64 decompilation that rebuilds ROM hashes | [n64decomp/sm64 README](https://raw.githubusercontent.com/n64decomp/sm64/master/README.md), fetched the same day. GitHub API `created_at` for that repository is `2019-06-08T04:30:49Z`. | The project calls itself a full decompilation of several regional releases, requires a prior ROM for assets, and can compare output hashes. The README does not say how long the match took. |
| “About two years,” with a public matching source the previous September | [Ars Technica, May 6, 2020](https://arstechnica.com/gaming/2020/05/beyond-emulation-the-massive-effort-to-reverse-engineer-n64-source-code/), Kyle Orland. | The duration in the README paragraph. The [n64decomp/sm64 README](https://raw.githubusercontent.com/n64decomp/sm64/master/README.md) states no duration. GitHub API `created_at` for that repository is `2019-06-08T04:30:49Z`; that timestamp is provenance only and is omitted from the README paragraph. |
| Dashy Dango cartridge, authors, and ISC notice | [assets/targets/dashy-dango/README.md](../assets/targets/dashy-dango/README.md), [NOTICE.txt](../assets/targets/dashy-dango/NOTICE.txt) | Upstream game and redistribution notice already in the repo. |
| Saved controller scope and cost | [assets/components/dashy-dango-dash/README.md](../assets/components/dashy-dango-dash/README.md) | Finite-trace acceptance and the historical generation cost of $0.28511425. |

Repo pages used as local context, not as the study or the decompilation timeline: root [README.md](../README.md), [assets/benchmark/recordings/README.md](../assets/benchmark/recordings/README.md), and [motion-transfer-implementation.md](motion-transfer-implementation.md).
