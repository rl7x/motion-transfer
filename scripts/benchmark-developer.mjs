import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { digest } from '../src/component/build.mjs';
import { benchmarkDefinition } from '../src/benchmark/definition.mjs';
import { benchmarkStore } from '../src/benchmark/store.mjs';
import { benchmarkTransport } from '../src/benchmark/transport.mjs';
import { currentBenchmarkProtocol } from '../src/benchmark/protocol.mjs';
import { runDeveloperBenchmark } from '../src/benchmark/runner.mjs';

const { values } = parseArgs({ options: { campaign: { type: 'string' }, 'fix-note': { type: 'string' }, validation: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('npm run benchmark:developer -- [--campaign <id>] [--fix-note "local fix"] [--validation <receipt.json>]');
  console.log('Uses the running loopback preview and its existing journals. Additional phase cap $2; recovery at most 3 x $0.50, Roadster $0.05, PAKU 2 x $0.03. No automatic retries.');
} else {
  const directory = resolve('reports/developer-benchmark'), store = benchmarkStore(directory);
  const transport = benchmarkTransport({ labDirectory: resolve('reports/lab'), remixDirectory: resolve('reports/remixes') });
  const protocol = await currentBenchmarkProtocol();
  const validationBytes = await readFile(resolve(values.validation ?? 'reports/developer-benchmark/validation.json'));
  const validation = JSON.parse(validationBytes);
  assert.equal(validation.protocolSha256, protocol.sha256, 'Run local verification against this exact protocol first');
  assert.equal(validation.passed, true);
  assert.ok(validation.checks.length && validation.checks.every(check => check.exitCode === 0), 'Local validation failed');
  await mkdir(directory, { recursive: true });
  let campaignId = values.campaign;
  if (!campaignId) {
    try { campaignId = JSON.parse(await readFile(resolve(directory, 'current.json'), 'utf8')).id; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!campaignId) {
    const read = async path => { const response = await fetch('http://127.0.0.1:4173' + path); if (!response.ok) throw Error('Preview is unavailable'); return response.json(); };
    const [lab, remix, ability] = await Promise.all([read('/api/lab/status'), read('/api/remixes/status'), read('/api/ability')]);
    assert.equal(lab.activeRunId, null); assert.equal(remix.activeRunId, null);
    assert.equal(lab.unsettled, false); assert.equal(remix.unsettled, false);
    let setup = null;
    try {
      const observed = JSON.parse(await readFile(resolve(directory, 'setup-observation.json'), 'utf8'));
      const endedAt = new Date().toISOString();
      setup = { ...observed, endedAt, observedWallMs: Date.parse(endedAt) - Date.parse(observed.startedAt), humanHandsOnMinutes: null };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    campaignId = randomUUID();
    const definition = benchmarkDefinition({ protocol, componentId: ability.id, roadsterParentId: lab.baseArtifactId,
      pakuParentId: remix.baseArtifactId, budgetsBefore: { lab: lab.budget, remix: remix.budget } }, { id: campaignId, setup });
    await store.create(definition);
    await writeFile(resolve(directory, 'current.json'), JSON.stringify({ id: campaignId }, null, 2) + '\n', { flag: 'wx' });
  }
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
  console.log(`Campaign: ${campaignId}. Observing existing jobs on resume; no hidden resubmission.`);
  try {
    const campaign = await runDeveloperBenchmark({ store, campaignId, transport, protocol, signal: controller.signal,
      ...(values['fix-note'] ? { recoveryFix: { note: values['fix-note'], validation: { sha256: digest(validationBytes), protocolSha256: validation.protocolSha256, checks: validation.checks } } } : {}),
      onProgress: console.log });
    console.log(JSON.stringify({ id: campaign.id, status: campaign.status, summary: campaign.summary }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
