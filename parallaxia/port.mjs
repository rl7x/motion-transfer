import { createRoadsterPort } from '../roadster/port.mjs';

// Reuse the verified adapter boundary, supplying the ship's actual facing.
// Four host substeps still correspond to exactly one component update at 60 Hz.
export function createParallaxiaPort({ adapter, ...options } = {}) {
  let facing = 1;
  const port = createRoadsterPort({ ...options, adapter: adapter && {
    init: adapter.init,
    step(state, input, motion, config) {
      return adapter.step(state, Object.freeze({ ...input, facing }), motion, config);
    },
  } });
  return { ...port, substep(physics, active) {
    facing = physics.facing === -1 ? -1 : 1;
    port.substep(physics, active);
  } };
}
