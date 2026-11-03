import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { compileMotion, digest } from '../component/build.mjs';
import { executeMotion } from '../component/run.mjs';
import { executeAdapter } from '../transfer/adapter.mjs';
import { adapterCases } from '../evaluator/paku-adapter.mjs';
import { verifyJujumpBrowser } from '../evaluator/jujump-browser.mjs';
import { extractIntegration, serveIntegration, integrationBrowser, exec, cleanEnv } from '../evaluator/integration-harness.mjs';
import { jujumpEnvironment, JUJUMP_POLICY } from '../transfer/jujump.mjs';
import { loadAcceptedComponent } from './accepted-component.mjs';
import { buildJujumpIntegration } from './jujump.mjs';

// This is the existing recipient's supported integration policy, not an answer
// supplied to the model. An accepted component can still fail this boundary.
export function assertJujumpCompatibility(component) {
  assert.equal(component.contract.interfaceVersion, 1, 'Unsupported motion interface');
  assert.equal(component.contract.tickRate, 60, 'JUJUMP needs the verified 60 Hz interface');
  assert.equal(component.contract.units, 'source-pixels-per-tick');
  assert.deepEqual(component.contract.defaults, { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 }, 'JUJUMP policy does not support this component configuration');
  assert.deepEqual(component.timerFields, { cooldown: 'cooldown', remaining: 'remaining' }, 'JUJUMP instrumentation needs canonical timer field names');
}

export async function compileRecoveryAdapter(component) {
  assertJujumpCompatibility(component);
  const source = await readFile(new URL('../../assets/transfers/jujump/adapter.ts', import.meta.url), 'utf8');
  const compiled = await compileMotion(source);
  const code = await transform(component.javascript, { format: 'iife', globalName: 'recovered', target: 'es2022' });
  return { source, ...compiled, componentCode: code.code, componentId: component.provenance.id, defaults: component.contract.defaults };
}

/** Compare the adapter to THIS candidate, never to the saved implementation. */
export async function verifyRecoveryAdapter(component, adapter) {
  const cases = adapterCases();
  const outputs = await executeAdapter(adapter, cases);
  const direct = await executeMotion(await compileMotion(component.source), cases.map(trace => ({ name: trace.name,
    inputs: trace.frames.map(frame => ({ buttons: (frame.facing < 0 ? 16 : 32) | (frame.dash ? 1 : 0), sourceBodyWidth: 8 })) })), adapter.defaults);
  const results = cases.map((trace, index) => {
    let firstDivergence = null;
    trace.frames.forEach((frame, tick) => {
      const output = trace.mockOutputs?.[tick] ?? direct[index].frames[tick];
      const expected = { ownsMotion: output.ownsMotion, events: output.events,
        displacement: output.ownsMotion ? output.displacement.x * (trace.scale ?? JUJUMP_POLICY.unitScale) : frame.normalDisplacement };
      const actual = outputs[index].outputs[tick];
      if (!firstDivergence && (expected.ownsMotion !== actual.ownsMotion || Math.abs(expected.displacement - actual.displacement) > 1e-9
        || JSON.stringify(expected.events) !== JSON.stringify(actual.events))) firstDivergence = { tick: tick + 1, expected, actual };
    });
    return { name: trace.name, ticks: trace.frames.length, passed: firstDivergence === null, firstDivergence };
  });
  return { schemaVersion: 1, gate: 'candidate-adapter-conformance', componentId: component.provenance.id,
    sourceSha256: adapter.sourceSha256, javascriptSha256: adapter.javascriptSha256,
    passed: results.every(result => result.passed), results };
}

async function checkProject(project, adapter, component, { node = false, onProgress = () => {} } = {}) {
  const extracted = await extractIntegration(project);
  let server, harness;
  try {
    let nodeChecks = null;
    if (node) {
      const result = await exec(process.execPath, ['--test', '--test-reporter=tap', 'verify.test.mjs'], { cwd: extracted.directory, env: cleanEnv(), timeout: 15_000, maxBuffer: 128 * 1024 });
      assert.match(result.stdout, /# pass 3/);
      nodeChecks = { passed: true, count: 3, output: result.stdout };
    }
    server = await serveIntegration(extracted.directory);
    harness = await integrationBrowser(server.origin);
    const browser = await verifyJujumpBrowser(adapter, { component,
      createHarness: async () => ({ ...harness, close: async () => {} }),
      playerPath: mode => `/${mode === 'original' ? 'original' : 'transferred'}.html?mode=${mode}&test=1`, onProgress });
    assert.equal(browser.passed, true, 'Recipient checks failed: ' + JSON.stringify(browser.results.filter(result => !result.passed)));
    assert.deepEqual(harness.externalRequests, []);
    assert.ok(harness.methods.every(method => method === 'GET'));
    return { browser, nodeChecks, externalRequests: [], nonGetRequests: [],
      environment: { node: process.version, platform: process.platform, arch: process.arch, browser: harness.browser.version() } };
  } finally { await harness?.close(); await server?.close(); await extracted.close(); }
}

export async function finishRecoveryIntegration({ directory, report, onStage = async () => {} }) {
  const started = performance.now();
  const component = await loadAcceptedComponent(directory, report);
  await onStage('integrating');
  const adapter = await compileRecoveryAdapter(component);
  const conformance = await verifyRecoveryAdapter(component, adapter);
  assert.equal(conformance.passed, true, 'New component adapter conformance failed');
  const environment = await jujumpEnvironment();
  const base = { schemaVersion: 1, componentId: component.provenance.id, sourceSha256: adapter.sourceSha256,
    javascriptSha256: adapter.javascriptSha256, environment, conformance, metaCalled: false,
    candidateId: component.candidateId, sessionId: report.session.id, policySha256: digest(JSON.stringify(JUJUMP_POLICY)) };
  const draft = await buildJujumpIntegration({ component, componentFiles: component.files, investigation: report, draft: true,
    transfer: { ...adapter, report: { ...base, passed: false, browser: { results: [], traces: {} } } } });
  const checked = await checkProject(draft, adapter, component);
  assert.deepEqual(await jujumpEnvironment(), environment, 'Recipient environment changed during verification');
  const receipt = { ...base, passed: true, browser: checked.browser };
  const project = await buildJujumpIntegration({ component, componentFiles: component.files, investigation: report,
    transfer: { ...adapter, verified: true, report: receipt } });
  await onStage('checking-export');
  const standalone = await checkProject(project, adapter, component, { node: true });
  return { project, verification: { schemaVersion: 1, kind: 'host-scripted-standalone-verification', passed: true, metaCalled: false,
    packageId: project.manifest.id, zipSha256: project.zipSha256, componentId: component.provenance.id,
    candidateId: component.candidateId, sessionId: report.session.id, ...standalone,
    elapsedMachineMs: Math.round(performance.now() - started),
    scope: 'This exact candidate passed recipient checks, then its final ZIP was system-unzipped into a fresh directory and checked on a separate static server. External browser requests were blocked. Machine time is not developer effort or time saved.' } };
}
