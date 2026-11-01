import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function loadTarget() {
  const directory = new URL('../targets/dashy-dango/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('target.lock.json', directory), 'utf8'));
  const bytes = await readFile(new URL('cart.wasm', directory));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (manifest.integrity.algorithm !== 'sha256' || sha256 !== manifest.integrity.digest || bytes.length !== manifest.integrity.bytes) {
    throw new Error('Target cartridge does not match target.lock.json');
  }
  return { bytes, sha256, id: 'target-001' };
}
