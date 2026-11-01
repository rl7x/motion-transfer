export function validateAdapterOutput(output) {
  if (!output || Object.keys(output).sort().join(',') !== 'displacement,events,ownsMotion,sweep'
    || !Number.isFinite(output.displacement) || typeof output.ownsMotion !== 'boolean'
    || !Array.isArray(output.events) || output.events.length > 2
    || new Set(output.events).size !== output.events.length
    || output.events.some(event => !['dash-start', 'dash-end'].includes(event))
    || !Array.isArray(output.sweep) || output.sweep.length > 64 || !output.sweep.every(Number.isFinite)) {
    throw new Error('Invalid transfer adapter output');
  }
  if (!output.ownsMotion && output.sweep.length) throw new Error('Inactive motion must not add collision sweep points');
  if (output.ownsMotion) {
    if (output.displacement === 0 && output.sweep.length) throw new Error('Zero displacement must not add sweep points');
    const points = [0, ...output.sweep, output.displacement];
    const direction = Math.sign(output.displacement);
    for (let index = 1; index < points.length; index++) {
      const gap = points[index] - points[index - 1];
      if (Math.abs(gap) > 1 + 1e-9 || (direction !== 0 && Math.sign(gap) !== direction)) throw new Error('Dash sweep must be monotonic with gaps of at most one recipient pixel');
    }
  }
}
