import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Loads a move saved by `npm run recover`, in the shape the port runtime expects. */
export async function loadRecoveredMove(directory) {
  const read = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
  const [javascript, contract, provenance, report] = await Promise.all([
    readFile(join(directory, 'component.js'), 'utf8'), read('contract.json'), read('provenance.json'), read('report.json'),
  ]);
  const [burst] = report.measurements.practiceBursts;
  const ticks = burst.frames, distance = contract.defaults.dashDistance;
  return {
    component: { javascript, contract, provenance },
    guidance: `This port uses a different recovered move from the one described above, and these numbers replace the 8 ticks, 60 source pixels and 25 tick recharge given there. The move lasts ${ticks} ticks, moves ${distance} source pixels in total, or about ${(distance / ticks).toFixed(1)} per tick, and recharges for ${contract.defaults.cooldownTicks} ticks. Use ${distance} wherever the rules say 60.`,
    credit: provenance.rights.source,
  };
}
