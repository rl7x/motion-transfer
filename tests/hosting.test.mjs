import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { SHARED_PHASE_DIRECTORY, VERIFIER_IMAGE } from '../hosting/constants.mjs';
import { createCoordinator, reservePublicGeneration } from '../hosting/coordinator.mjs';
import { createFakeMetaClient } from '../hosting/fake-client.mjs';
import { workerArguments } from '../hosting/isolation.mjs';
import { admitProductionRequest, createProductionPolicy, parseRemixBody } from '../hosting/policy.mjs';
import { parseJob } from '../hosting/protocol.mjs';
import { publishArtifact } from '../hosting/publish.mjs';
import { createJobQueue } from '../hosting/queue.mjs';
import { createWorkerBroker } from '../hosting/broker.mjs';
import { createBrokerClient } from '../hosting/broker-client.mjs';
import { createHostingServer } from '../hosting/server.mjs';

const execute = promisify(execFile);
const ledgerUrl = new URL('../reports/motion-transfer-phase/phase-budget.json', import.meta.url);
const ledgerHash = async () => createHash('sha256').update(await readFile(ledgerUrl)).digest('hex');
const intent = { unitScale: 0.1, activation: 'held', direction: 'facing' };
const parentIntent = { unitScale: 0.2, activation: 'held', direction: 'facing' };

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'motion-hosting-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function verified(componentId, frame) {
  return job => ({
    ok: true, terminated: null, error: null, envNames: ['PATH', 'HOME'],
    result: {
      ok: true, passed: true, operation: job.operation, componentId, checks: [{ name: job.operation, passed: true }],
      frame: frame && job.operation === 'verify-browser' ? { sha256: createHash('sha256').update(frame).digest('hex'), bytes: frame.length } : null,
    },
    frame: frame && job.operation === 'verify-browser' ? frame : null,
  });
}

function fakeBroker(handler) {
  const calls = [];
  return {
    calls,
    async available() { return this.up; },
    up: true,
    async submit(job) { calls.push(job); return handler(job); },
  };
}

async function setup(t, broker, client) {
  const directory = await temp(t);
  const coordinator = await createCoordinator({ directory, broker, client });
  const parentId = 'ab'.repeat(32);
  await coordinator.putParent({ id: parentId, bytes: Buffer.from('parent-v1'), intent: parentIntent });
  t.after(() => coordinator.close());
  return { directory, coordinator, parentId };
}

function remix(parentId, sessionId = randomUUID()) {
  return {
    prompt: 'Make the dash half as long.', parentArtifactId: parentId, idempotencyKey: randomUUID(),
    sessionId, adultConfirmed: true,
  };
}

test('worker jobs reject arbitrary commands and unsafe launch flags', async t => {
  assert.throws(() => parseJob({ operation: 'verify-native', command: 'id', source: 'x', intent }), /Arbitrary command/);
  assert.throws(() => parseJob({ operation: 'verify-native', shell: '/bin/sh', source: 'x', intent }), /Arbitrary command/);
  assert.throws(() => parseJob({ operation: 'sh' }), /Unknown hosting operation/);
  assert.throws(() => parseJob({ operation: 'probe-egress', env: { PATH: '/tmp' } }), /Arbitrary command/);
  const directory = await temp(t);
  const name = `mt-${'a'.repeat(16)}`;
  const spec = workerArguments({ image: VERIFIER_IMAGE, name, operation: 'probe-egress' });
  assert.equal(spec.args.includes('--privileged'), false);
  assert.equal(spec.args.join('\n').includes('docker.sock'), false);
  assert.deepEqual(spec.args.slice(spec.args.indexOf('--network'), spec.args.indexOf('--network') + 2), ['--network', 'none']);
  assert.ok(spec.args.includes('--read-only'));
  assert.equal(spec.args[spec.args.indexOf('--cap-drop') + 1], 'ALL');
  assert.ok(spec.args.includes('no-new-privileges:true'));
  assert.equal(spec.args.includes('--user'), true);
  assert.equal(spec.args.at(-1), VERIFIER_IMAGE);
  assert.throws(() => workerArguments({ image: VERIFIER_IMAGE, name, operation: 'verify-native', outputDir: '/etc' }), /temp directory/);
  const output = join(directory, 'out');
  await import('node:fs/promises').then(fs => fs.mkdir(output));
  const bound = workerArguments({ image: VERIFIER_IMAGE, name, operation: 'verify-native', outputDir: output });
  assert.equal(bound.args.some(arg => arg.includes('/output') && arg.includes(output) === false && arg.startsWith('type=bind') === false && arg.includes('/etc')), false);
  assert.ok(bound.args.some(arg => arg.startsWith('type=bind') && arg.includes('/output')));
});

test('production admission is an exact host, origin, and proxy allowlist', () => {
  const policy = createProductionPolicy({
    hosts: ['play.example'], origins: ['https://play.example'], trustedProxies: ['10.0.0.8'], inviteCodes: ['test-invite-code'],
  });
  const base = { policy, method: 'POST', path: '/api/remixes', bodyLength: 100, remoteAddress: '203.0.113.4' };
  const headers = { host: 'play.example', origin: 'https://play.example', 'content-type': 'application/json', 'x-invite-code': 'test-invite-code' };
  assert.equal(admitProductionRequest({ ...base, headers }).ok, true);
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, host: 'play.example.evil.com' } }).ok, false);
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, host: 'localhost:8080' } }).error, 'Unrecognized public host');
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, origin: 'https://play.example.evil' } }).error, 'Unrecognized public origin');
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, origin: 'http://127.0.0.1:8080' } }).ok, false);
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, 'x-forwarded-host': 'play.example' } }).error, 'Untrusted proxy headers');
  const proxied = admitProductionRequest({
    ...base, remoteAddress: '::ffff:10.0.0.8',
    headers: { ...headers, host: 'coordinator:8080', 'x-forwarded-host': 'play.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(proxied.ok, true);
  assert.equal(admitProductionRequest({
    ...base, remoteAddress: '10.0.0.8',
    headers: { ...headers, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
  }).ok, false);
  assert.equal(admitProductionRequest({
    ...base, remoteAddress: '10.0.0.8',
    headers: { ...headers, 'x-forwarded-host': 'play.example', 'x-forwarded-proto': 'http' },
  }).ok, false);
  assert.equal(admitProductionRequest({ ...base, path: '/api/investigations', headers }).error, 'Broad recovery is disabled on the public service');
  assert.equal(admitProductionRequest({ ...base, path: '/api/roadster/transfers', headers }).status, 403);
  assert.equal(admitProductionRequest({ ...base, method: 'GET', path: '/recovery-projects/abc/play', headers }).status, 403);
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, 'x-invite-code': 'nope-nope' } }).status, 401);
  assert.equal(admitProductionRequest({ ...base, bodyLength: 5000, headers }).status, 413);
  assert.throws(() => parseRemixBody({ ...remix('ab'.repeat(32)), adultConfirmed: false }), /18 and older/);
  assert.throws(() => parseRemixBody({ ...remix('ab'.repeat(32)), model: 'muse-spark-1.3-contributor' }), /Invalid remix request/);
  assert.throws(() => createProductionPolicy({ hosts: ['localhost'], origins: ['https://play.example'] }), /Localhost/);
});

test('hosted remixes fail closed, keep the parent, and leave the public reserve unused', async t => {
  const before = await ledgerHash();
  const frame = Buffer.from('<!doctype html><title>remix</title>');
  const componentId = 'cd'.repeat(32);
  const calls = [];
  const client = createFakeMetaClient({ source: 'export function init(){return {}}', intent });
  const count = client.countInputTokens.bind(client);
  client.countInputTokens = async request => { calls.push('provider'); return count(request); };
  const broker = fakeBroker(async job => { calls.push(job.operation); return verified(componentId, frame)(job); });
  const { coordinator, parentId } = await setup(t, broker, client);
  const first = remix(parentId);
  const accepted = await coordinator.submit(first);
  const ready = await coordinator.wait(accepted.id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.publicReservedUsd, 0);
  assert.equal(ready.model, 'muse-spark-1.3');
  assert.deepEqual(calls, ['provider', 'verify-native', 'verify-browser']);
  assert.equal(ready.urls.play.includes('localhost'), false);
  assert.equal(ready.urls.play.startsWith('/artifacts/'), true);
  assert.equal((await coordinator.parentBytes(parentId)).toString(), 'parent-v1');
  const again = await coordinator.submit(first);
  assert.equal(again.id, accepted.id);
  assert.equal(calls.length, 3);

  const same = createFakeMetaClient({ source: 'export function init(){return {}}', intent: parentIntent });
  const quiet = fakeBroker(async () => { throw Error('worker must not run'); });
  const noop = await setup(t, quiet, same);
  const unchanged = await noop.coordinator.submit(remix(noop.parentId));
  assert.equal((await noop.coordinator.wait(unchanged.id)).error, 'The proposed mapping does not change the parent');
  assert.equal(quiet.calls.length, 0);

  const denied = fakeBroker(async () => ({ ok: true }));
  denied.up = false;
  const blocked = await setup(t, denied, client);
  await assert.rejects(() => blocked.coordinator.submit(remix(blocked.parentId)), /refuses in-process execution/);
  assert.equal(denied.calls.length, 0);
  await assert.rejects(() => coordinator.verifyIsolated({ source: 'x', intent, runtime: 'vm' }), /cannot fall back to vm/);
  assert.equal(await ledgerHash(), before);
});

test('a killed worker does not publish or rewrite the parent', async t => {
  const client = createFakeMetaClient({ source: 'export function init(){return {}}', intent });
  const broker = fakeBroker(async () => ({ ok: false, terminated: 'oom', exitCode: 137, oomKilled: true, error: 'killed', result: null, frame: null }));
  const { coordinator, parentId } = await setup(t, broker, client);
  const job = await coordinator.submit(remix(parentId));
  const failed = await coordinator.wait(job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.artifactId, null);
  assert.equal((await coordinator.parentBytes(parentId)).toString(), 'parent-v1');
  assert.equal(failed.publicReservedUsd, 0);
});

test('queues, publication, and the public reserve survive restarts without charging the shared ledger', async t => {
  const before = await ledgerHash();
  const directory = await temp(t);
  const queue = await createJobQueue(directory);
  const id = randomUUID();
  await queue.save({ id, status: 'verifying', events: [{ status: 'verifying', at: '2026-11-02T00:00:00.000Z' }], sessionId: 's', idempotencyKey: 'k' });
  const reopened = await createJobQueue(directory);
  assert.equal(reopened.get(id).status, 'failed');
  assert.match(reopened.get(id).error, /Parent unchanged/);
  const published = await publishArtifact({
    directory, parentId: 'ab'.repeat(32), files: { 'receipt.json': '{"passed":true}\n', 'play.html': '<!doctype html>' },
  });
  assert.equal(published.urls.play, `/artifacts/${published.id}/play.html`);
  assert.equal(published.urls.receipt.includes('http'), false);
  await assert.rejects(() => reservePublicGeneration({
    directory: SHARED_PHASE_DIRECTORY, releasePublished: false, id: 'public:unused', maxCostUsd: 0.15,
  }), /not published/);
  await assert.rejects(() => reservePublicGeneration({
    directory: SHARED_PHASE_DIRECTORY, releasePublished: true, id: 'public:unused', maxCostUsd: 0.15,
  }), /not confirmed/);
  const phase = await temp(t);
  const reserved = await reservePublicGeneration({
    directory: phase, releasePublished: true, id: 'public:temp', maxCostUsd: 0.15, metadata: { test: true },
  });
  assert.equal(reserved.category, 'public');
  assert.equal(reserved.status, 'reserved');
  const opened = await createPhaseBudget(phase);
  assert.equal((await opened.status()).categories.public.reservedUsd, 0.15);
  assert.equal((await opened.status()).categories.public.limitUsd, 15);
  assert.equal(await ledgerHash(), before);
  const source = await readFile(new URL('../hosting/coordinator.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('evaluator/'), false);
  assert.equal(source.includes('transfer/adapter'), false);
  assert.equal(source.includes('compileAdapter'), false);
});

test('the production server enforces remix limits and does not redirect', async t => {
  const frame = Buffer.from('<!doctype html><title>remix</title>');
  const broker = fakeBroker(verified('ef'.repeat(32), frame));
  const client = createFakeMetaClient({ source: 'export function init(){return {}}', intent });
  const { coordinator, parentId } = await setup(t, broker, client);
  const policy = createProductionPolicy({
    hosts: ['play.example'], origins: ['https://play.example'], trustedProxies: ['127.0.0.1'], inviteCodes: ['test-invite-code'],
  });
  const server = await createHostingServer({ policy, coordinator });
  t.after(() => server.close());
  const send = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: server.port, path, method, setHost: false,
      headers: { Host: 'play.example', ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const health = await send('GET', '/health');
  assert.equal(JSON.parse(health.body).publicReservedUsd, 0);
  assert.equal(JSON.parse(health.body).releasePublished, false);
  const recovery = await send('POST', '/api/investigations', {
    headers: { Origin: 'https://play.example', 'Content-Type': 'application/json', 'x-invite-code': 'test-invite-code' }, body: '{}',
  });
  assert.equal(recovery.status, 403);
  assert.equal(recovery.headers.location, undefined);
  const created = await send('POST', '/api/remixes', {
    headers: { Origin: 'https://play.example', 'Content-Type': 'application/json', 'x-invite-code': 'test-invite-code' },
    body: JSON.stringify(remix(parentId)),
  });
  assert.equal(created.status, 202);
  const job = JSON.parse(created.body);
  const finished = await coordinator.wait(job.id);
  const play = await send('GET', finished.urls.play);
  assert.equal(play.status, 200);
  assert.equal(play.headers.location, undefined);
  assert.match(play.headers['content-security-policy'], /sandbox/);
  assert.match(play.body, /remix/);
  const young = await send('POST', '/api/remixes', {
    headers: { Origin: 'https://play.example', 'Content-Type': 'application/json', 'x-invite-code': 'test-invite-code' },
    body: JSON.stringify({ ...remix(parentId), adultConfirmed: false }),
  });
  assert.equal(young.status, 403);
  const foreign = await send('POST', '/api/remixes', {
    headers: { Host: 'localhost:8080', Origin: 'http://localhost:8080', 'Content-Type': 'application/json', 'x-invite-code': 'test-invite-code' },
    body: JSON.stringify(remix(parentId)),
  });
  assert.equal(foreign.status, 403);
});

test('compose config describes a coordinator without a docker socket', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { stdout } = await execute('docker', ['compose', '-f', 'compose.yaml', 'config'], { cwd: root });
  assert.match(stdout, /motion-transfer-coordinator:local/);
  assert.equal(stdout.includes('docker.sock'), false);
  assert.match(stdout, /cap_drop:[\s\S]*ALL/);
  assert.equal(stdout.includes('privileged: true'), false);
});

test('a typed socket rejects a command without starting a worker', async t => {
  const socketPath = `/tmp/mt-${process.pid}-broker.sock`;
  let ran = false;
  const broker = await createWorkerBroker({
    socketPath, run: async () => { ran = true; return { ok: true }; },
  });
  t.after(() => broker.close());
  const client = createBrokerClient(socketPath);
  const rejected = await client.submit({ operation: 'verify-native', command: 'id', source: 'x', intent });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Arbitrary command/);
  assert.equal(ran, false);
});
