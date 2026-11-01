# Donor motion observations

`dashy-dango.mjs` reads the live motion entity from the pinned cartridge's linear memory. It follows the component registry on every observation because component allocations move between ticks. It never calls private donor functions, modifies the binary, or writes to memory. The original cartridge remains the source of reference positions and state.

The mapping is specific to SHA-256 `152d44c6e9ef48a254125cd5ebe266998a9bc74ea104692f5d2280fca6e9b42f`. Human-assisted inspection of WABT disassembly/decompilation identified the world registry at 18376, the type identifiers in functions 61/66/67/69/73, the 40-byte outer and 12-byte inner hash-map buckets in functions 54/55, and motion fields in function 9. These are observations about this compiled binary, not a stable Rust ABI or a model-discovered mapping. No original donor source is used by this module.

The observer checks the cartridge hash, gameplay state, registry occupancy, unique dash entity, input-register dependency, and relevant vtables. Unknown layouts fail. It reads position, dash direction/distance/timers, walking speed, and source body width. Watch addresses are resolved again on every tick.

`recordDonorMotion({name, steps: [{buttons, frames}]})` sends the title-screen start request, observes the freshly initialized motion state, then records up to 600 gameplay ticks. The initial ten-tick cooldown is retained. It records world coordinates rather than screen coordinates: the game's camera keeps its player near screen center. `dash-start` and `dash-end` label transitions into/out of the observed remaining-ticks state; they are evaluator events, not intercepted donor event messages. `ownsMotion` covers activation and subsequent active ticks.

These observations support a motion-controller comparison. They do not establish equivalence for combat, scoring, effects, enemy behavior, or the full game. A candidate must still run independently and be compared against donor rollouts on separate inputs.
