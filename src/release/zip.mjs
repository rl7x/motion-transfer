import { sha256 } from './sha.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stored, deterministic ZIP. Names are relative and sorted. */
export function zipStored(files) {
  const local = [];
  const central = [];
  let offset = 0;
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length || entries.length > 100) throw Error('ZIP entry count is out of range');
  for (const [name, content] of entries) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw Error('Invalid ZIP entry name');
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const encoded = Buffer.from(name);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(encoded.length, 26);
    local.push(header, encoded, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(encoded.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, encoded);
    offset += header.length + encoded.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function readStoredZip(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const files = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw Error('Unsupported ZIP structure');
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    if (method !== 0 || (flags & 0x08) !== 0) throw Error('Only stored ZIP entries are supported');
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extra;
    files.set(name, Buffer.from(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  if (!files.size) throw Error('ZIP contains no files');
  return files;
}

export function zipEntryHashes(buffer) {
  return Object.fromEntries([...readStoredZip(buffer)].map(([name, bytes]) => [name, sha256(bytes)]));
}
