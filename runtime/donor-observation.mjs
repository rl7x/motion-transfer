export const DONOR_SHA256 = '152d44c6e9ef48a254125cd5ebe266998a9bc74ea104692f5d2280fca6e9b42f';
const WORLD = 18_376;
const TYPES = {
  position: -594740851893402806n,
  dash: 4846766668026693394n,
  input: 2856662750449918298n,
  body: -4574111331284382493n,
  walking: -466671608286388881n,
};

// These layouts were mapped from this binary's functions 9, 54, 55, 61,
// 66, 67, 69, and 73. They are not a general Rust/HashMap ABI.
function buckets(data, base, stride) {
  const mask = data.getUint32(base + 16, true);
  const control = data.getUint32(base + 20, true);
  const count = data.getUint32(base + 28, true);
  const capacity = mask + 1;
  if (capacity < 1 || capacity > 4096 || (capacity & mask)
    || control < capacity * stride || control + capacity > data.byteLength || count > capacity) {
    throw new Error('Donor registry layout is outside the supported mapping');
  }
  const entries = [];
  for (let index = 0; index < capacity; index++) {
    if (!(data.getUint8(control + index) & 0x80)) entries.push(control - (index + 1) * stride);
  }
  if (entries.length !== count) throw new Error('Donor registry occupancy does not match its count');
  return entries;
}

function components(data, registry, type) {
  const bucket = registry.find(address => data.getBigInt64(address, true) === type);
  if (bucket === undefined) throw new Error('Required donor component registry is absent');
  return buckets(data, bucket + 8, 12).map(address => ({
    entity: data.getUint16(address, true), pointer: data.getUint32(address + 4, true),
    vtable: data.getUint32(address + 8, true),
  }));
}

export function observeDonorMotion(runtime) {
  if (runtime.provenance.cartridgeSha256 !== DONOR_SHA256) throw new Error('Motion mapping requires the pinned donor');
  const data = runtime.data;
  if (data.getUint8(18_480) !== 1) throw new Error('Motion observations require active gameplay');
  const registry = buckets(data, WORLD + 32, 40);
  const dashEntries = components(data, registry, TYPES.dash);
  if (dashEntries.length !== 1) throw new Error('Expected exactly one donor dash controller');
  const dash = dashEntries[0];
  const get = type => {
    const entry = components(data, registry, type).find(entry => entry.entity === dash.entity);
    if (!entry) throw new Error('Dash entity is missing a required motion dependency');
    return entry;
  };
  const position = get(TYPES.position), body = get(TYPES.body), input = get(TYPES.input), walking = get(TYPES.walking);
  if (data.getUint32(input.pointer, true) !== 0x16 || position.vtable !== 14_800 || dash.vtable !== 14_816) {
    throw new Error('Donor motion component identity does not match the pinned mapping');
  }
  const result = {
    frame: runtime.frame, entity: dash.entity,
    position: { x: data.getFloat32(position.pointer, true), y: data.getFloat32(position.pointer + 4, true) },
    direction: { x: data.getFloat32(dash.pointer + 32, true), y: data.getFloat32(dash.pointer + 36, true) },
    distance: data.getUint16(dash.pointer + 40, true),
    cooldown: data.getInt16(dash.pointer + 42, true),
    remaining: data.getInt16(dash.pointer + 44, true),
    sourceBodyWidth: data.getUint16(body.pointer, true),
    walkingSpeed: data.getInt16(walking.pointer, true),
    pointers: { position: position.pointer, dash: dash.pointer },
  };
  if (![result.position.x, result.position.y, result.direction.x, result.direction.y].every(Number.isFinite)) {
    throw new Error('Donor motion mapping produced a non-finite value');
  }
  return result;
}
