// Shared by the browser and restricted verifier. Never trust serialized positions.
export const MAX_CHECKPOINT_TICKS = 3600;
export const MAX_HORIZON_TICKS = 120;
export const NATIVE_INPUT_MASK = 31;
export const DASH_INPUT = 32;

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export async function replayDigest(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function encodeInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length > MAX_CHECKPOINT_TICKS) throw Error('Checkpoint exceeds 3600 ticks');
  const frames = [];
  for (const bits of inputs) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 63) throw Error('Invalid native/dash input');
    const last = frames.at(-1);
    if (last?.[0] === bits) last[1]++; else frames.push([bits, 1]);
  }
  return frames;
}
export function expandInputs(frames, limit = MAX_CHECKPOINT_TICKS) {
  if (!Array.isArray(frames) || frames.length > limit) throw Error('Invalid replay transcript');
  let count = 0;
  for (const entry of frames) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] > 63
      || !Number.isInteger(entry[1]) || entry[1] <= 0 || (count += entry[1]) > limit) throw Error('Invalid or oversized replay transcript');
  }
  return frames.flatMap(([bits, length]) => Array(length).fill(bits));
}
export function validateCheckpoint(value, identity) {
  if (!value || value.version !== 1 || value.collisionPolicy !== 'native' || value.boundaryDash !== false
    || value.ruleId !== null || value.seed !== 7 || value.mode !== 'normal' || value.startSector !== 1
    || !Number.isInteger(value.tick) || value.tick < 0 || value.tick > MAX_CHECKPOINT_TICKS || !/^[a-f0-9]{64}$/.test(value.stateDigest)) throw Error('Unsupported checkpoint');
  for (const key of ['componentId', 'recipientRevision', 'hooksSha256', 'adapterSha256']) {
    if (value[key] !== identity[key]) throw Error('Checkpoint identity differs: ' + key);
  }
  const inputs = expandInputs(value.frames);
  if (inputs.length !== value.tick) throw Error('Checkpoint tick differs from transcript');
  return inputs;
}
export function checkpointState(sim, port) {
  return JSON.parse(JSON.stringify({ native: sim, motion: port.snapshot(sim), rule: null }));
}
export async function captureCheckpoint({ sim, port, inputs, identity }) {
  port.setDash(false);
  const checkpoint = { version: 1, ...identity, ruleId: null, seed: 7, mode: 'normal', startSector: 1,
    tick: inputs.length, frames: encodeInputs(inputs), boundaryDash: false, collisionPolicy: 'native',
    stateDigest: await replayDigest(checkpointState(sim, port)) };
  validateCheckpoint(checkpoint, identity);
  return checkpoint;
}
export function validateScenario(value) {
  if (!value || value.collisionPolicy !== 'native' || value.noAddedInvulnerability !== true || value.preserveEnemyRules !== true
    || value.preserveNativeMovement !== true || !Number.isInteger(value.horizonTicks) || value.horizonTicks < 1 || value.horizonTicks > MAX_HORIZON_TICKS) throw Error('Invalid experiment constraints');
  const { target } = value;
  if (!target || !['minX', 'maxX', 'minY', 'maxY'].every(key => Number.isFinite(target[key]) && Math.abs(target[key]) <= 1000)
    || target.minX > target.maxX || target.minY > target.maxY) throw Error('Invalid fixed target');
  const controls = expandInputs(value.nativeControls, MAX_HORIZON_TICKS);
  if (controls.length !== value.horizonTicks || controls.some(bits => bits > NATIVE_INPUT_MASK)) throw Error('Future native controls must match the fixed horizon');
  if (!Array.isArray(value.allowedChanges) || value.allowedChanges.join(',') !== 'unitScale,activation,direction,dashTick') throw Error('Unsupported allowed changes');
  return controls;
}
