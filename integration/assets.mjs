import { buildJujumpIntegration } from './jujump.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const LEGACY_RECORDING = 'jujump-validation.json';
const PACKAGE_ID = /^[a-f0-9]{64}$/;

export function packageRecordingName(packageId) {
  if (!PACKAGE_ID.test(packageId)) throw Error('Invalid integration package id');
  return `${packageId}.json`;
}

function recordingUrl(directory, name) {
  const base = directory instanceof URL ? new URL(directory.href) : new URL(directory);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(name, base);
}

function matchesExport(saved, project) {
  return Boolean(saved
    && saved.passed === true
    && saved.metaCalled === false
    && saved.kind === 'human-scripted-standalone-verification'
    && saved.packageId === project.manifest.id
    && saved.zipSha256 === project.zipSha256
    && saved.nodeChecks?.passed === true
    && Number.isInteger(saved.nodeChecks?.count)
    && saved.nodeChecks.count > 0
    && saved.browser?.passed === true
    && Array.isArray(saved.browser?.results)
    && saved.browser.results.length > 0
    && saved.browser.results.every(result => result.passed === true));
}

async function readJson(url) {
  try { return JSON.parse(await readFile(url, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function readPackageVerification(directory, project) {
  const keyed = await readJson(recordingUrl(directory, packageRecordingName(project.manifest.id)));
  if (matchesExport(keyed, project)) return keyed;
  const legacy = await readJson(recordingUrl(directory, LEGACY_RECORDING));
  return matchesExport(legacy, project) ? legacy : null;
}

export async function savePackageRecording(directory, report) {
  if (report?.passed !== true || report.metaCalled !== false || report.kind !== 'human-scripted-standalone-verification') {
    throw Error('Only a passed standalone verification can be saved');
  }
  const name = packageRecordingName(report.packageId);
  if (name === LEGACY_RECORDING) throw Error('Refusing to overwrite the legacy recording');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(recordingUrl(directory, name), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw Error(`Package recording ${name} already exists and was not overwritten`);
    throw error;
  }
  return name;
}

export async function integrationAssets() {
  const project = await buildJujumpIntegration();
  const assets = new Map();
  const saved = await readPackageVerification(new URL('recordings/', import.meta.url), project);
  const verification = saved && { kind: saved.kind, nodeChecks: saved.nodeChecks.count, browserChecks: saved.browser.results.length,
    elapsedMachineMs: saved.elapsedMachineMs, report: '/integrations/jujump/validation.json' };
  if (saved) assets.set(verification.report, ['application/json', JSON.stringify(saved)]);
  const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', ts: 'text/plain', txt: 'text/plain', md: 'text/plain' };
  for (const [path, source] of Object.entries(project.files)) assets.set('/integrations/jujump/' + path, [types[path.split('.').at(-1)] ?? 'text/plain', source]);
  assets.set('/integrations/jujump/project.zip', ['application/zip', project.zip]);
  assets.set('/api/developer-task', ['application/json', JSON.stringify({ ...project.caseStudy, verification,
    package: { id: project.manifest.id, bytes: project.zip.length, sha256: project.zipSha256, fileCount: Object.keys(project.files).length,
      download: '/integrations/jujump/project.zip', play: '/integrations/jujump/index.html', guide: '/integrations/jujump/README.md' },
  })]);
  return assets;
}
