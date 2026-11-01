import { buildJujumpIntegration } from './jujump.mjs';
import { readFile } from 'node:fs/promises';

export async function integrationAssets() {
  const project = await buildJujumpIntegration();
  const assets = new Map();
  let verification = null;
  try {
    const saved = JSON.parse(await readFile(new URL('recordings/jujump-validation.json', import.meta.url), 'utf8'));
    if (saved.passed && saved.packageId === project.manifest.id && saved.zipSha256 === project.zipSha256) {
      verification = { kind: saved.kind, nodeChecks: saved.nodeChecks.count, browserChecks: saved.browser.results.length,
        elapsedMachineMs: saved.elapsedMachineMs, report: '/integrations/jujump/validation.json' };
      assets.set(verification.report, ['application/json', JSON.stringify(saved)]);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', ts: 'text/plain', txt: 'text/plain', md: 'text/plain' };
  for (const [path, source] of Object.entries(project.files)) assets.set('/integrations/jujump/' + path, [types[path.split('.').at(-1)] ?? 'text/plain', source]);
  assets.set('/integrations/jujump/project.zip', ['application/zip', project.zip]);
  assets.set('/api/developer-task', ['application/json', JSON.stringify({ ...project.caseStudy, verification,
    package: { id: project.manifest.id, bytes: project.zip.length, sha256: project.zipSha256, fileCount: Object.keys(project.files).length,
      download: '/integrations/jujump/project.zip', play: '/integrations/jujump/index.html', guide: '/integrations/jujump/README.md' },
  })]);
  return assets;
}
