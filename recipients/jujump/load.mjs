import { readFile } from 'node:fs/promises';
import { digest } from '../../component/build.mjs';
import { loadPakuPaku } from '../paku-paku/load.mjs';

export async function loadJujump() {
  const root = new URL('./', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('recipient.lock.json', root), 'utf8'));
  const files = {};
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.local, root));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw Error(`JUJUMP integrity mismatch: ${file.local}`);
    files[file.local] = bytes.toString('utf8');
  }
  const runtime = await loadPakuPaku(); // Reuse the already pinned browser engine and audio, not the PAKU game.
  return { ...runtime, manifest, source: files['upstream/main.js'], licenses: [files['upstream/LICENSE.txt'], ...runtime.licenses.slice(1)] };
}
