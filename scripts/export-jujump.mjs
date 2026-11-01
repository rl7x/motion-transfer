import { mkdir, writeFile } from 'node:fs/promises';
import { buildJujumpIntegration } from '../integration/jujump.mjs';

const project = await buildJujumpIntegration();
const output = new URL('../reports/exports/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('jujump-dash.zip', output), project.zip);
console.log(`JUJUMP integration: reports/exports/jujump-dash.zip (${project.zip.length} bytes)`);
console.log(`Package ${project.manifest.id}\nArchive SHA-256 ${project.zipSha256}\nNo API calls.`);
