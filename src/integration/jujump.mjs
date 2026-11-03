import { repositoryUrl } from '../paths.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadJujump } from '../recipients/jujump/load.mjs';
import { loadJujumpTransfer, JUJUMP_POLICY } from '../transfer/jujump.mjs';
import { hookedJujumpSource, jujumpObservationSource } from '../runtime/jujump-browser.mjs';
import { clockedPakuRuntime, replaceOnce } from '../runtime/paku-browser.mjs';
import { projectZip } from './archive.mjs';

const read = path => readFile(repositoryUrl(path), 'utf8');
const json = value => JSON.stringify(value, null, 2) + '\n';

export async function buildJujumpIntegration({ component, transfer, componentFiles, investigation, draft = false } = {}) {
  if (component && !componentFiles) throw Error('Explicit component files are required for a new integration');
  [component, transfer] = await Promise.all([component ?? loadRecoveredMotion(), transfer ?? loadJujumpTransfer()]);
  const recipient = await loadJujump();
  const readComponent = async name => {
    const text = componentFiles ? componentFiles[name] : await read('components/dashy-dango-dash/' + name);
    if (typeof text !== 'string') throw Error('Missing component package file: ' + name);
    return text;
  };
  assert.ok(transfer?.verified || draft, 'A verified JUJUMP transfer is required for export');
  assert.equal(transfer.componentId, component.provenance.id);
  assert.equal(transfer.report.componentId, component.provenance.id);
  assert.equal(transfer.report.sourceSha256, transfer.sourceSha256);
  assert.equal(transfer.report.javascriptSha256, transfer.javascriptSha256);
  const files = {};
  for (const name of ['index.html', 'style.css', 'player.js', 'serve.mjs', 'verify.test.mjs', 'README.md']) {
    files[name] = await read('integration/template/' + name);
  }
  for (const name of ['component.ts', 'component.js', 'contract.json', 'provenance.json']) {
    files['component/' + name] = await readComponent(name);
  }
  assert.equal(digest(files['component/component.ts']), component.provenance.sourceSha256);
  assert.equal(digest(files['component/component.js']), component.provenance.javascriptSha256);
  assert.deepEqual(JSON.parse(files['component/contract.json']), component.contract);
  assert.deepEqual(JSON.parse(files['component/provenance.json']), component.provenance);
  assert.equal(digest(JSON.stringify({ source: component.provenance.sourceSha256, javascript: component.provenance.javascriptSha256, contract: component.contract })), component.provenance.id);
  const evaluations = [];
  for (const suite of componentFiles ? ['development', 'acceptance'] : ['development', 'regressions', 'acceptance']) {
    const text = await readComponent(`evaluation-${suite}.json`), report = JSON.parse(text);
    assert.equal(report.passed, true); assert.equal(report.sourceSha256, component.provenance.sourceSha256);
    assert.equal(report.javascriptSha256, component.provenance.javascriptSha256);
    assert.ok(report.results.length && report.results.every(result => result.passed));
    files[`evidence/evaluation-${suite}.json`] = text; evaluations.push(report);
  }
  for (const name of ['evidence', 'recovery-history']) files[`evidence/${name}.json`] = await readComponent(`${name}.json`);
  const recovery = JSON.parse(files['evidence/recovery-history.json']);
  assert.equal(recovery.status, 'accepted'); assert.equal(recovery.cartridgeSha256, component.provenance.cartridgeSha256);
  const accepted = recovery.attempts.find(attempt => attempt.attempt === recovery.acceptedAttempt);
  assert.equal(accepted.sourceSha256, component.provenance.sourceSha256);
  assert.equal(accepted.acceptance?.passed, true);
  files['evidence/recipient-verification.json'] = json(transfer.report);
  files['adapter/adapter.ts'] = transfer.source;
  files['adapter/adapter.js'] = transfer.javascript;
  files['adapter/policy.json'] = json(JUJUMP_POLICY);
  files['adapter/host-hooks.mjs'] = await read('runtime/jujump-browser.mjs');
  // This export retains the exact hook source and its dependency for inspection.
  files['runtime/paku-browser.mjs'] = await read('runtime/paku-browser.mjs');
  files['adapter/host-hooks.mjs'] = replaceOnce(files['adapter/host-hooks.mjs'], "'./paku-browser.mjs'", "'../runtime/paku-browser.mjs'");
  files['recipient/original.js'] = recipient.source;
  files['recipient/recipient.lock.json'] = json(recipient.manifest);
  files['recipient/game-before.js'] = recipient.source + '\n' + jujumpObservationSource();
  files['recipient/game-after.js'] = hookedJujumpSource(recipient.source) + '\n' + jujumpObservationSource();
  files['assets/runtime.js'] = clockedPakuRuntime(recipient.runtime);
  files['assets/sound.js'] = recipient.sound;
  files['assets/clock.js'] = await read('web/clock.js');
  files['assets/transfer-output.js'] = await read('transfer/output.mjs');
  files['assets/port.js'] = replaceOnce(await read('web/port.js'), "'/assets/transfer-output.js'", "'./transfer-output.js'");
  let boot = await read('web/jujump-boot.js');
  for (const [from, to] of [['/assets/jujump-adapter.js', '../adapter/adapter.js'], ['/assets/component.js', '../component/component.js'], ['/assets/port.js', './port.js'], ['/api/transfer-config', 'config.json']]) boot = replaceOnce(boot, `'${from}'`, `'${to}'`);
  files['assets/boot.js'] = boot;
  files['config.json'] = json({ motion: component.contract.defaults, unitScale: JUJUMP_POLICY.unitScale, componentId: component.provenance.id });
  const html = game => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JUJUMP</title><style>body{margin:0;overflow:hidden;background:#101010}canvas{image-rendering:pixelated}</style><script src="assets/clock.js"></script><script src="assets/sound.js"></script><script src="assets/runtime.js"></script><script src="recipient/game-${game}.js"></script><script type="module" src="assets/boot.js"></script></head><body></body></html>`;
  files['original.html'] = html('before'); files['transferred.html'] = html('after');
  files['package.json'] = json({ name: 'jujump-recovered-dash-example', version: '1.0.0', private: true, type: 'module', scripts: { start: 'node serve.mjs', test: 'node --test verify.test.mjs' }, engines: { node: '>=22' } });
  files['NOTICES.txt'] = await read('targets/dashy-dango/NOTICE.txt') + '\n\nJUJUMP by Kenta Cho / ABA Games; crisp-game-lib and sounds-some-sounds are bundled locally. Upstream notices follow.\n\n' + recipient.licenses.join('\n\n----------------\n\n') + '\n\nRecovered motion generated and repaired by Meta models; human assistance and finite scope are in component/provenance.json. No donor cartridge, source game assets or donor runtime are included. This example does not assign a new blanket license to all included material.\n';
  const cases = evaluations.flatMap(report => report.results), airborne = transfer.report.browser.results.find(item => item.name === 'airborne-dash-retains-gravity');
  const caseStudy = {
    schemaVersion: 1, task: 'Recover a movement mechanic from a compiled build and reuse it in a platformer while preserving native gravity and landing.',
    beneficiary: 'Game developers maintaining or porting an existing mechanic',
    status: draft ? 'unverified-integration-draft' : investigation ? 'investigation-recovery-and-verified-integration' : 'saved-recovery-and-verified-integration', componentId: component.provenance.id,
    donor: { name: 'Dashy Dango', format: 'WASM-4', sha256: component.provenance.cartridgeSha256, sourceStatus: 'Source withheld from recovery; not actually lost', includedInExport: false },
    recipient: { name: 'JUJUMP', revision: recipient.manifest.revision, adapterSourceSha256: transfer.sourceSha256, adapterJavascriptSha256: transfer.javascriptSha256, authorship: JUJUMP_POLICY.authorship },
    recovery: { models: component.provenance.models, humanAssistance: component.provenance.humanAssistance, acceptedAttempt: recovery.acceptedAttempt,
      requests: recovery.requests.map(({ attempt, model, responseStatus, status, estimatedCostUsd }) => ({ attempt, model, responseStatus: responseStatus ?? status, estimatedCostUsd })),
      attempts: recovery.attempts.map(attempt => ({ attempt: attempt.attempt, developmentPassed: attempt.development?.passed, acceptancePassed: attempt.acceptance?.passed,
        firstFailure: attempt.acceptance?.results?.find(result => !result.passed) ?? null })),
      evidence: 'evidence/recovery-history.json', scope: investigation ? 'New candidate from this investigation; source frozen before separate acceptance. Recipient checks apply to this exact candidate.' : 'Previously accepted recovery. Later live workbench explorations did not produce a new accepted component.' },
    measurements: { traceCount: cases.length, updates: cases.reduce((sum, result) => sum + result.ticks, 0), maxPositionError: Math.max(...cases.map(result => result.maxPositionError)),
      positionTolerance: evaluations.at(-1).positionTolerance, airborne, adapterSourceLines: transfer.source.trimEnd().split('\n').length,
      recordedRecoveryCostUsd: component.provenance.estimatedCostUsd, adapterMetaCalls: 0, exportMetaCalls: 0,
      humanElapsedMinutes: null, manualTimeSavedMinutes: null, baselineComparison: null },
    evidence: { component: 'component/provenance.json', development: 'evidence/evaluation-development.json', acceptance: 'evidence/evaluation-acceptance.json', integration: 'evidence/recipient-verification.json' },
    limitations: ['Finite default-configuration motion checks, not full-game equivalence.', 'Human-authored adapter, recipient hooks, runtime normalization and verification.', 'No independent user validation or measured developer time savings.', 'Donor visual trails and presentation effects are not part of the recovered component.', 'Export checks replay saved observations; they do not run the donor or a new acceptance suite.', 'Supported compiled target is WASM-4, not arbitrary game binaries.'],
  };
  if (investigation) {
    files['evidence/investigation.json'] = json(investigation);
    caseStudy.investigation = { sessionId: investigation.session?.id, model: investigation.model, evidence: 'evidence/investigation.json' };
    files['index.html'] = files['index.html']
      .replace('A human selected the component boundary, mapped runtime fields, supplied code slices and development evidence, and authored the evaluator, recipient adapter and hooks.', 'A human supplied the component boundary, mapped runtime fields, tools, evaluators, recipient adapter and hooks. Meta selected the inspected code, experiments and candidate implementation; the exported investigation records its actual actions.')
      .replace('The current package uses the previously accepted component. Later exploratory investigations are separate and do not establish a new independent recovery.', 'This package uses the newly accepted candidate from the included investigation. It passed separate acceptance after freezing and recipient checks before publication.');
  }
  files['case-study.json'] = json(caseStudy);
  const manifest = { schemaVersion: 1, componentId: component.provenance.id, recipient: 'jujump', files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, source]) => [path, { sha256: digest(source), bytes: Buffer.byteLength(source) }])) };
  manifest.id = digest(JSON.stringify(manifest)); files['manifest.json'] = json(manifest);
  const zip = projectZip(files);
  // Optional history fields must match the actual JSON delivered in the ZIP.
  return { files, manifest, caseStudy: JSON.parse(files['case-study.json']), zip, zipSha256: digest(zip) };
}
