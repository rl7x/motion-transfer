# JUJUMP

[JUJUMP](https://github.com/abagames/crisp-game-lib-games/tree/cfb39d2f988feb5918eb83697145b5a35adabf58/docs/jujump) is an MIT-licensed platform game by Kenta Cho / ABA Games, pinned in `recipient.lock.json`. Upstream bytes and notices are preserved. Both local variants run in the already pinned crisp-game-lib 1.1.1 runtime, with the same explicit 60 Hz clock and seed 9. This is a normalized browser port, not a claim about every historical runtime version or display rate.

Press Space or tap to jump and alternate horizontal direction. Holding the jump button reduces gravity; successive airborne jumps weaken, and landing restores jump strength and clears velocity. The camera scrolls platforms down, and falling below the view ends the game. These make a materially different transfer target from PAKU PAKU's single horizontal lane.

Investigated alternatives included JUMP ON and UP 1 WAY, whose vertical movement is largely scripted state transitions rather than a gravity/landing interaction, and GROWTH/THUNDER, whose players stay on one floor. JUJUMP was selected for its actual gravity, platform contact, small MIT source, and feasible local verification. Its unusual original overlap rule resolves contact upward, including side contact; that rule is retained and explicitly documented by the transfer policy.
