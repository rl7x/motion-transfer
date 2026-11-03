import { readFile } from 'node:fs/promises';
import { digest } from './build.mjs';

export async function loadRecoveredMotion() {
  const root = new URL('../../assets/components/dashy-dango-dash/', import.meta.url);
  const source = await readFile(new URL('component.ts', root), 'utf8');
  const javascript = await readFile(new URL('component.js', root), 'utf8');
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  const contract = JSON.parse(await readFile(new URL('contract.json', root), 'utf8'));
  if (digest(source) !== provenance.sourceSha256 || digest(javascript) !== provenance.javascriptSha256
    || digest(JSON.stringify({ source: provenance.sourceSha256, javascript: provenance.javascriptSha256, contract })) !== provenance.id) {
    throw new Error('Recovered motion package integrity mismatch');
  }
  return { source, javascript, provenance, contract };
}
