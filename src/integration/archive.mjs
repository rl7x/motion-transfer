// Deterministic, uncompressed ZIPs for the small, explicitly enumerated project.
// No filesystem traversal or archive input is accepted by this writer.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function projectZip(files) {
  const local = [], central = [];
  let offset = 0;
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > 1000) throw Error('Too many project files');
  for (const [path, content] of entries) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Invalid project path');
    const name = Buffer.from('jujump-dash/' + path), bytes = Buffer.from(content);
    if (bytes.length > 16_000_000 || offset + bytes.length > 32_000_000) throw Error('Project archive exceeds limit');
    const checksum = crc32(bytes), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12); // 1980-01-01, stable across builds.
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(33, 14); record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
