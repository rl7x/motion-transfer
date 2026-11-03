import { readFile } from 'node:fs/promises';
import { digest } from '../../component/build.mjs';

export async function loadParallaxia() {
  const root = new URL('./', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('recipient.lock.json', root), 'utf8'));
  const files = {};
  for (const file of manifest.files) {
    if (file.local.includes('..') || file.local.startsWith('/')) throw Error('Invalid recipient path');
    const bytes = await readFile(new URL(file.local, root));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) {
      throw Error(`PARALLAXIA recipient integrity mismatch: ${file.local}`);
    }
    files[file.local] = bytes;
  }
  return {
    manifest,
    files,
    notices: files['upstream/LICENSE'].toString('utf8'),
  };
}
