# PAKU PAKU recipient

PAKU PAKU is Kenta Cho / ABA Games' one-dimensional chase game. The original game, character patterns, and MIT notice are copied unchanged from `abagames/crisp-game-lib-11-games` revision `6fea4eefe2deaa42706051d96a04ec9e36104696`. [Upstream repository](https://github.com/abagames/crisp-game-lib-11-games/tree/6fea4eefe2deaa42706051d96a04ec9e36104696), [original game](https://abagames.github.io/crisp-game-lib-11-games/?pakupaku).

`recipient.lock.json` records the byte size and SHA-256 of each supplied file. The loader verifies those files and the installed `crisp-game-lib@1.1.1` and `sounds-some-sounds@3.0.0` versions before serving. Dependencies and their integrity are pinned in the root lockfile. The local player uses those packages' actual renderer, hitboxes, input, and audio; it is not a new implementation of the game.

```sh
npm install
npm run dev:transfer
```

Open `http://127.0.0.1:4173`. Click the game to start; tap or press Space to reverse direction. All runtime files are served locally, with no CDN requests. License notices are available at `/licenses`.

The host normalizes updates to 60 Hz and seeds the runtime's game/particle RNGs for reproducibility. Upstream's frame gate targets 68 Hz and its seed generator starts from `Math.random`; these host changes are explicit. The original game logic is unchanged. Baseline comparisons concern the same logical input updates under this declared clock/seed, not upstream wall-clock behavior at every display rate. A separate clock driver schedules the same updates at 30/60/144 display frames and limits catch-up after long stalls.

Browser tests use the actual game and runtime. Tests can advance the host clock and inject edge-case fixtures through a `?test=1` page; production pages do not expose the fixture setter. Natural-play comparisons and injected collision scenarios are distinct checks. Use installed Google Chrome, or install Playwright Chromium and set `BROWSER_CHANNEL=chromium`.
