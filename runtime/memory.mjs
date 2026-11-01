const TYPES = {
  u8: [1, 'getUint8'], i8: [1, 'getInt8'],
  u16: [2, 'getUint16'], i16: [2, 'getInt16'],
  u32: [4, 'getUint32'], i32: [4, 'getInt32'],
  f32: [4, 'getFloat32'], f64: [8, 'getFloat64'],
};
export const MEMORY_TYPES = Object.keys(TYPES);

export function validateMemoryWatches(watches, byteLength = 65_536) {
  if (!Array.isArray(watches) || watches.length > 8) throw new Error('Use at most 8 memory watches');
  const names = new Set();
  let values = 0;
  for (const watch of watches) {
    const keys = ['name', 'address', 'type', 'count'];
    if (!watch || typeof watch !== 'object' || Array.isArray(watch)
      || Object.keys(watch).length !== keys.length || keys.some(key => !Object.hasOwn(watch, key))) {
      throw new Error('A memory watch needs only name, address, type, and count');
    }
    if (typeof watch.name !== 'string' || !watch.name.trim() || watch.name.length > 40 || names.has(watch.name)) {
      throw new Error('Memory watch names must be unique and contain 1–40 characters');
    }
    if (typeof watch.type !== 'string' || !Object.hasOwn(TYPES, watch.type)
      || !Number.isSafeInteger(watch.count) || watch.count < 1 || watch.count > 16) {
      throw new Error('A memory watch needs a supported numeric type and count of 1–16');
    }
    if (!Number.isSafeInteger(watch.address) || watch.address < 0
      || watch.address + TYPES[watch.type][0] * watch.count > byteLength) {
      throw new Error('Memory watch is outside linear memory');
    }
    names.add(watch.name);
    values += watch.count;
  }
  if (values > 64) throw new Error('Memory watches cannot exceed 64 total values');
}

function jsonNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return Object.is(value, -0) ? '-0' : value;
}

export function readMemoryWatches(buffer, watches) {
  validateMemoryWatches(watches, buffer.byteLength);
  const data = new DataView(buffer);
  return watches.map(watch => {
    const [size, getter] = TYPES[watch.type];
    return {
      ...watch,
      bytesHex: Buffer.from(buffer, watch.address, size * watch.count).toString('hex'),
      values: Array.from({ length: watch.count }, (_, index) => jsonNumber(data[getter](watch.address + index * size, true))),
    };
  });
}
