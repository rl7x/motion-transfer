import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');

/** Publish an immutable directory. Returned URLs are paths, never hostnames. */
export async function publishArtifact({ directory, parentId, files }) {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.some(([name]) => name === 'receipt.json')) throw Error('Publication requires a verification receipt');
  const buffers = entries.map(([name, value]) => {
    if (!/^[a-z0-9.-]+$/i.test(name) || name.includes('..')) throw Error('Invalid artifact file');
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    return { name, buffer };
  });
  const id = digest(JSON.stringify(buffers.map(({ name, buffer }) => [name, digest(buffer)])));
  const staging = join(directory, 'staging', id);
  const destination = join(directory, 'artifacts', id);
  await mkdir(staging, { recursive: true });
  try {
    for (const file of buffers) await writeFile(join(staging, file.name), file.buffer);
    await mkdir(join(directory, 'artifacts'), { recursive: true });
    try {
      await rename(staging, destination);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      await rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const urls = { receipt: `/artifacts/${id}` };
  if (buffers.some(file => file.name === 'play.html')) {
    urls.play = `/artifacts/${id}/play.html`;
    urls.download = `/artifacts/${id}/download`;
  }
  if (buffers.some(file => file.name === 'adapter.js')) urls.adapter = `/artifacts/${id}/adapter.js`;
  for (const url of Object.values(urls)) {
    if (url.includes('localhost') || url.includes('127.0.0.1') || /^https?:/i.test(url)) throw Error('Artifact URL must be a path');
  }
  return { id, parentId, urls };
}
