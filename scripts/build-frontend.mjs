import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { buildFrontend } from '../web/build.mjs';

const output = new URL('../reports/frontend-build/', import.meta.url);
await mkdir(new URL('assets/', output), { recursive: true });
await writeFile(new URL('assets/app.js', output), await buildFrontend());
for (const name of ['index.html', 'style.css']) await copyFile(new URL('../web/' + name, import.meta.url), new URL(name, output));
console.log('Frontend built in reports/frontend-build/. Game and API routes are supplied by the existing preview server.');
