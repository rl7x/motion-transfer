import { access, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRoadsterIntent } from '../roadster/port.mjs';
import { readVerifiedPin, readParallaxiaPin } from './component-pin.mjs';

/**
 * Copies one allowlisted verified Roadster artifact into the playback parent store.
 * The directory is a real artifact: manifest.json plus the published file set.
 * Component, source, and frame evidence must match that pin. Public requests cannot supply this source.
 */
export async function seedVerifiedParent({ dataDirectory, artifactDirectory } = {}) {
  if (!dataDirectory || !artifactDirectory) throw Error('A verified parent artifact directory is required');
  const manifest = JSON.parse(await readFile(join(artifactDirectory,'manifest.json'),'utf8'));
  const pin = manifest.kind === 'parallaxia-transfer' ? await readParallaxiaPin(artifactDirectory) : await readVerifiedPin(artifactDirectory);
  validateRoadsterIntent(pin.intent);
  if (!pin.source.trim() || Buffer.byteLength(pin.source) > 16384) throw Error('Verified parent source is invalid');
  if (!pin.component.javascript.trim() || Buffer.byteLength(pin.component.javascript) > 65536) throw Error('Verified parent component is invalid');
  const frame = Buffer.from(pin.frame);
  if (frame.length === 0 || frame.length > 8 * 1024 * 1024) throw Error('Verified parent frame is invalid');
  const parents = join(resolve(dataDirectory), 'parents');
  await mkdir(parents, { recursive: true });
  const target = join(parents, pin.id);
  try {
    await access(target);
    throw Error('Verified parent is already seeded');
  } catch (error) {
    if (error.message === 'Verified parent is already seeded') throw error;
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(target, frame, { flag: 'wx' });
  await writeFile(join(parents, `${pin.id}.intent.json`), JSON.stringify(pin.intent), { flag: 'wx' });
  await writeFile(join(parents, `${pin.id}.source.ts`), pin.source, { flag: 'wx' });
  await writeFile(join(parents, `${pin.id}.component.json`), JSON.stringify(pin.component), { flag: 'wx' });
  await writeFile(join(parents, `${pin.id}.recipient.json`), JSON.stringify(pin.recipient), { flag: 'wx' });
  if (typeof pin.summary === 'string' && pin.summary.trim() && pin.summary.length <= 1000) {
    await writeFile(join(parents, `${pin.id}.summary.txt`), pin.summary, { flag: 'wx' });
  }
  return { id: pin.id, componentId: pin.componentId };
}
