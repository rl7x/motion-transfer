import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Files saved from the running site at deploy time, stored beside the Function. They keep the
 * site playable while the free backend sleeps or is paused. Without a snapshot this returns null.
 */
export async function loadSnapshot(directory) {
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return {
    has: url => Object.hasOwn(manifest.files, url),
    async read(url) {
      if (!Object.hasOwn(manifest.files, url)) return null;
      const { file, headers } = manifest.files[url];
      return { headers, bytes: await readFile(join(directory, 'files', file)) };
    },
  };
}
