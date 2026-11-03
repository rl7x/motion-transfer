import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { COORDINATOR_TAG, VERIFIER_IMAGE } from '../hosting/constants.mjs';
import { createCoordinator } from '../hosting/coordinator.mjs';
import { createFakeMetaClient } from '../hosting/fake-client.mjs';
import { createWorkerBroker } from '../hosting/broker.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const ledgerUrl = new URL('../reports/motion-transfer-phase/phase-budget.json', import.meta.url);
const ledgerHash = () => readFile(ledgerUrl).then(bytes => createHash('sha256').update(bytes).digest('hex'));

function docker(args, timeout) {
  return execute('docker', args, { cwd: root, timeout, maxBuffer: 32 * 1024 * 1024 });
}

test('restricted worker containers enforce isolation and verify in-process only inside the worker', { timeout: 900_000 }, async t => {
  try { await execute('docker', ['info'], { timeout: 20_000 }); }
  catch { t.skip('docker daemon is not available; isolation was not executed'); return; }
  const beforeLedger = await ledgerHash();
  const marker = 'hosting-marker-do-not-leak';
  const previousMarker = process.env.HOSTING_SECRET_MARKER;
  process.env.HOSTING_SECRET_MARKER = marker;
  const broker = await createWorkerBroker({ image: VERIFIER_IMAGE });
  t.after(async () => {
    if (previousMarker === undefined) delete process.env.HOSTING_SECRET_MARKER;
    else process.env.HOSTING_SECRET_MARKER = previousMarker;
    await broker.close();
    const listed = await docker(['ps', '-aq', '--filter', 'name=mt-'], 20_000).catch(() => ({ stdout: '' }));
    const ids = listed.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    if (ids.length) await docker(['rm', '-f', ...ids], 20_000).catch(() => {});
  });

  await docker(['build', '-f', 'Dockerfile', '-t', VERIFIER_IMAGE, '.'], 600_000);
  await docker(['build', '-f', 'Dockerfile.coordinator', '-t', COORDINATOR_TAG, '.'], 180_000);
  assert.equal(await broker.available(), true);

  const env = await broker.submit({ operation: 'probe-env' });
  assert.equal(env.ok, true, env.error);
  assert.equal(env.result.markerSeen, false);
  assert.equal(env.result.credentialPresent, false);
  assert.equal(env.result.uid, 10001);
  assert.equal(env.envNames.includes('HOSTING_SECRET_MARKER'), false);
  assert.equal(env.envNames.includes('MODEL_API_KEY'), false);
  assert.equal(JSON.stringify(env).includes(marker), false);

  const egress = await broker.submit({ operation: 'probe-egress' });
  assert.equal(egress.ok, true, egress.error);
  assert.equal(egress.result.egress, false);
  assert.equal(egress.result.attempts.every(attempt => attempt.ok === false), true);
  assert.ok(egress.result.interfaces.includes('lo'));
  assert.equal(egress.result.interfaces.includes('eth0'), false);

  const writes = await broker.submit({ operation: 'probe-write' });
  assert.equal(writes.ok, true, writes.error);
  assert.equal(writes.result.escaped, false);
  assert.equal(writes.result.writes['/tmp/hosting-probe'], 'ok');
  assert.equal(writes.result.writes['/output/hosting-probe'], 'ok');
  for (const path of ['/etc/hosting-probe', '/usr/hosting-probe', '/app/hosting-probe', '/home/verifier/hosting-probe']) {
    assert.notEqual(writes.result.writes[path], 'ok', path);
  }

  const started = Date.now();
  const spin = await broker.submit({ operation: 'probe-spin' });
  assert.equal(spin.terminated, 'timeout');
  assert.equal(spin.oomKilled, false);
  assert.equal(spin.ok, false);
  assert.ok(Date.now() - started < 45_000);

  const memory = await broker.submit({ operation: 'probe-memory' });
  assert.equal(memory.ok, false);
  assert.equal(memory.exitCode, 137);

  const phase = await mkdtemp(join(tmpdir(), 'motion-hosting-ledger-'));
  t.after(() => rm(phase, { recursive: true, force: true }));
  const budget = await createPhaseBudget(phase);
  await budget.reserve({ id: 'remix:preserve', category: 'remix', maxCostUsd: 0.15, metadata: { case: 'worker-death' } });
  const ledgerBefore = await readFile(join(phase, 'phase-budget.json'));
  const parentFile = join(phase, 'parent.bin');
  await writeFile(parentFile, 'parent-v1');
  await broker.submit({ operation: 'probe-memory' });
  assert.equal(await readFile(parentFile, 'utf8'), 'parent-v1');
  assert.deepEqual(await readFile(join(phase, 'phase-budget.json')), ledgerBefore);

  const current = JSON.parse(await readFile(join(root, 'transfers/roadster/current.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'transfers/roadster/versions', current.id, 'manifest.json'), 'utf8'));
  const source = await readFile(join(root, 'transfers/roadster/versions', current.id, 'adapter.ts'), 'utf8');
  const provenance = JSON.parse(await readFile(join(root, 'components/dashy-dango-dash/provenance.json'), 'utf8'));
  const native = await broker.submit({
    operation: 'verify-native', source, intent: manifest.intent, componentId: provenance.id,
  });
  assert.equal(native.ok, true, native.error);
  assert.equal(native.result.passed, true);
  assert.equal(native.result.executedIn, 'worker');
  assert.equal(native.result.uid, 10001);
  assert.equal(native.result.componentId, provenance.id);
  const broken = await broker.submit({
    operation: 'verify-native', intent: manifest.intent, componentId: provenance.id,
    source: 'export function init(){return {}}; export function step(){return {}};',
  });
  assert.equal(broken.result?.passed === true, false);

  const directory = await mkdtemp(join(tmpdir(), 'motion-hosting-coord-'));
  const ledgerDirectory = await mkdtemp(join(tmpdir(), 'motion-hosting-ledger-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(() => rm(ledgerDirectory, { recursive: true, force: true }));
  await createPhaseBudget(ledgerDirectory);
  const client = createFakeMetaClient({ source, intent: manifest.intent, summary: 'Saved held dash, verified in the worker.' });
  const coordinator = await createCoordinator({ directory, broker, client, ledgerDirectory, localVerification: true });
  t.after(() => coordinator.close());
  const parentId = current.id;
  const parentBytes = Buffer.from('saved-parent');
  const componentJs = await readFile(new URL('../components/dashy-dango-dash/component.js', import.meta.url), 'utf8');
  const contract = JSON.parse(await readFile(new URL('../components/dashy-dango-dash/contract.json', import.meta.url), 'utf8'));
  await coordinator.putParent({
    id: parentId, bytes: parentBytes,
    intent: { ...manifest.intent, unitScale: manifest.intent.unitScale === 0.1 ? 0.2 : 0.1 },
    source, component: { id: provenance.id, javascript: componentJs, contract },
    recipient: { name: 'RDSTR Stunts', revision: manifest.recipientRevision },
  });
  const submitted = await coordinator.submit({
    prompt: 'Make the dash half as long.', parentArtifactId: parentId, idempotencyKey: randomUUID(),
    sessionId: randomUUID(), adultConfirmed: true,
  });
  const ready = await coordinator.wait(submitted.id);
  assert.equal(ready.status, 'ready', ready.error);
  assert.equal(ready.publicReservedUsd, 0);
  assert.equal(ready.urls.play.startsWith('/artifacts/'), true);
  assert.equal(ready.urls.play.includes('localhost'), false);
  assert.deepEqual(ready.parentChain, [parentId, ready.artifactId]);
  assert.equal(ready.urls.parent, `/parents/${parentId}`);
  assert.equal(ready.urls.download, `/artifacts/${ready.artifactId}/download`);
  assert.deepEqual(await coordinator.parentBytes(parentId), parentBytes);
  const receipt = JSON.parse((await coordinator.artifactFile(ready.artifactId, 'receipt.json')).toString('utf8'));
  assert.equal(receipt.passed, true);
  assert.equal(receipt.model, 'muse-spark-1.3');
  assert.deepEqual(receipt.parentChain, [parentId]);
  const adapter = await coordinator.artifactFile(ready.artifactId, 'adapter.js');
  assert.ok(adapter.length > 20);
  const play = await coordinator.artifactFile(ready.artifactId, 'play.html');
  assert.ok(play.length > 1000);
  assert.equal(ready.urls.play.includes('127.0.0.1'), false);

  const script = `
    import { access } from 'node:fs/promises';
    import { pathToFileURL } from 'node:url';
    const { reservePublicGeneration } = await import(pathToFileURL('/app/hosting/coordinator.mjs').href);
    for (const path of ['/app/hosting/broker.mjs', '/app/hosting/worker.mjs', '/app/hosting/isolation.mjs', '/app/evaluator/roadster.mjs', '/var/run/docker.sock']) {
      if (await access(path).then(() => true, () => false)) process.exit(2);
    }
    const refused = await reservePublicGeneration({ directory: '/tmp/unused', releasePublished: false, id: 'public:image', maxCostUsd: 0.01 }).then(() => false, () => true);
    if (!refused) process.exit(3);
  `;
  await docker(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--user', '10001:10001', '--tmpfs', '/tmp:rw,nosuid,size=16m', COORDINATOR_TAG,
    'node', '--input-type=module', '-e', script], 60_000);

  assert.equal(await ledgerHash(), beforeLedger);
});
