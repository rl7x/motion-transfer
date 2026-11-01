# The same dash in JUJUMP

This separate, human-authored adapter calls the exact [frozen Meta-recovered component](../../components/dashy-dango-dash/README.md), ID `1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2`, already used by PAKU PAKU. No donor source, cartridge, runtime, or assets are used in the recipient. No additional model call was needed for this integration. Its authorship is displayed separately from the Meta-authored recovery and PAKU adapter.

JUJUMP is a [pinned MIT game by Kenta Cho](../../recipients/jujump/README.md). Its native gravity, weaker successive air jumps, upward platform-overlap resolution, camera scrolling, death, and attract replay remain. The host constructs a modified variant through exact source anchors; upstream bytes remain untouched. Its historical source runs on our pinned crisp-game-lib 1.1.1 port, normalized to the same 60 logical Hz and seed 9 in both variants.

The adapter maps `jumpWay` to donor left/right and held D to donor X. It calls component `init` once per life and `step` exactly once per update, always with the default motion configuration and source body width 8. During inactive ticks, JUJUMP retains its own horizontal velocity. During active ticks, horizontal donor displacement is multiplied by 0.5: 60 source pixels become 30 recipient pixels. Duration stays eight ticks; cooldown stays 25 inactive ticks; initial readiness stays 10. Changing jump direction during the dash does not change its stored direction.

Vertical velocity and the native gravity update continue during a dash. After platforms are drawn at their scrolled coordinates, the host sweeps active movement through at most one-pixel increments. Each overlap uses JUJUMP's existing upward resolution and clears native velocity/restores jump strength. Horizontal dash motion can continue after landing, but collision cannot reset the controller's duration or recharge. The original all-sided upward overlap rule is retained rather than replaced by a one-way platform model. Screen edges have no new clamp. Ordinary movement retains the original endpoint collision loop unchanged.

```sh
npm run verify:jujump
```

The saved `verification.json` and a fresh local replay cover 11 adapter conformance cases and seven real-browser checks: ordinary-play agreement, native jump/landing rules, airborne dash with unchanged vertical motion, swept platform contact, held timing/frozen direction, death/restart, and raw-control replay. The high-speed platform fixture is declared. The saved airborne traces measure 30 dash pixels versus eight ordinary pixels over eight updates, with matching vertical motion within `1e-9`. Verification covers these finite cases, not full-game equivalence.

The catalog displays this destination only when saved source/build/component/environment identities and passing reports agree. `npm run verify:jujump -- --save` deliberately refreshes the report after local validation. Live edits are currently supported for PAKU PAKU only; this destination plays the checked original dash mapping. Source, notices, and report remain downloadable.
