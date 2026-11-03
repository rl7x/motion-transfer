import { loadTarget } from '../agent/target.mjs';
import { createReplayRuntime } from '../runtime/replay.mjs';
import { validateTrace } from '../runtime/trace.mjs';

import { DONOR_SHA256, observeDonorMotion } from '../runtime/donor-observation.mjs';
export { DONOR_SHA256, observeDonorMotion };

export async function recordDonorMotion(trace) {
  validateTrace({ schemaVersion: 1, steps: trace.steps.map((step, index) => ({ ...step, checkpoint: `step-${index}` })) });
  const total = trace.steps.reduce((sum, step) => sum + step.frames, 0);
  if (total > 600) throw new Error('Motion traces cannot exceed 600 gameplay ticks');
  const runtime = await createReplayRuntime((await loadTarget()).bytes);
  runtime.step(1); // Start request on the title screen.
  let previous = observeDonorMotion(runtime);
  const initial = previous;
  const frames = [];
  for (const step of trace.steps) {
    for (let index = 0; index < step.frames; index++) {
      runtime.step(step.buttons);
      const current = observeDonorMotion(runtime);
      const activated = previous.remaining <= 0 && current.remaining > 0;
      const ended = previous.remaining > 0 && current.remaining === 0;
      frames.push({
        tick: frames.length + 1, buttons: step.buttons, observation: current,
        output: {
          ownsMotion: activated || previous.remaining > 0,
          displacement: { x: current.position.x - previous.position.x, y: current.position.y - previous.position.y },
          events: [...(activated ? ['dash-start'] : []), ...(ended ? ['dash-end'] : [])],
        },
      });
      previous = current;
    }
  }
  return { name: trace.name, cartridgeSha256: DONOR_SHA256, initial, steps: trace.steps, frames };
}
