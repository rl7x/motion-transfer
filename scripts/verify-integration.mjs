import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { savePackageRecording } from '../src/integration/assets.mjs';
import { buildJujumpIntegration } from '../src/integration/jujump.mjs';
import { loadJujumpAdapter } from '../src/transfer/jujump.mjs';
import { verifyJujumpBrowser } from '../src/evaluator/jujump-browser.mjs';
import { extractIntegration, serveIntegration, integrationBrowser, exec, cleanEnv } from '../src/evaluator/integration-harness.mjs';

let extracted, server, harness;
const started = performance.now(), stages = {};
try {
  const project = await buildJujumpIntegration(); stages.packageBuildMs = performance.now() - started;
  let checkpoint = performance.now();
  extracted = await extractIntegration(project); stages.extractionMs = performance.now() - checkpoint;
  checkpoint = performance.now();
  const local = await exec(process.execPath, ['--test', '--test-reporter=tap', 'verify.test.mjs'], { cwd: extracted.directory, env: cleanEnv() });
  assert.match(local.stdout, /# pass 3/); stages.nodeChecksMs = performance.now() - checkpoint;
  checkpoint = performance.now();
  server = await serveIntegration(extracted.directory); harness = await integrationBrowser(server.origin);
  const browser = await verifyJujumpBrowser(await loadJujumpAdapter(), {
    createHarness: async () => ({ ...harness, close: async () => {} }),
    playerPath: mode => `/${mode === 'original' ? 'original' : 'transferred'}.html?mode=${mode}&test=1`, onProgress: console.log,
  });
  stages.browserChecksMs = performance.now() - checkpoint;
  assert.equal(browser.passed, true, JSON.stringify(browser.results.filter(result => !result.passed)));
  assert.deepEqual(harness.externalRequests, []); assert.ok(harness.methods.every(method => method === 'GET'));
  const report = { schemaVersion: 1, kind: 'human-scripted-standalone-verification', passed: true, metaCalled: false,
    recordedAt: new Date().toISOString(), packageId: project.manifest.id, zipSha256: project.zipSha256, componentId: project.manifest.componentId,
    archiveBytes: project.zip.length, exportedFiles: Object.keys(project.files).length,
    environment: { node: process.version, platform: process.platform, arch: process.arch, browser: harness.browser.version() },
    elapsedMachineMs: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, Math.round(value)])),
    nodeChecks: { passed: true, count: 3, output: local.stdout }, browser,
    externalRequests: harness.externalRequests, nonGetRequests: harness.methods.filter(method => method !== 'GET'),
    humanEffort: { boundaryMappingAndEvaluator: 'Supplied before recovery; see component provenance', adapterAndHostHooks: 'Human-authored', elapsedMinutes: null, timeSavedMinutes: null },
    scope: 'System-unzipped export in a fresh temporary directory, no dependencies installed. Separate static server, no credentials passed, external requests blocked. Timings are automated verification on this machine, not developer effort or a baseline comparison.',
  };
  await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
  await writeFile(new URL('../reports/jujump-integration-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--save')) {
    const name = await savePackageRecording(new URL('../assets/integration/recordings/', import.meta.url), report);
    console.log(`Saved package recording ${name} without changing earlier recordings.`);
  }
  console.log(`Standalone integration verified: 3 Node checks, ${browser.results.length} actual-browser checks; ${report.archiveBytes} bytes, ${report.exportedFiles} files. No API calls.`);
  console.log(JSON.stringify(report.elapsedMachineMs));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await harness?.close(); await server?.close(); await extracted?.close(); }
