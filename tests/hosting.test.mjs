import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROADSTER_INSTRUCTIONS, ROADSTER_RECIPIENT_POLICY, ROADSTER_TOOL } from '../agent/roadster-request.mjs';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { SAVED_ARTIFACT_ID, SAVED_COMPONENT_ID } from '../hosting/component-pin.mjs';
import { FRAME_LIMIT, HOSTING_GENERATION_CONFIRMATION, SHARED_LEDGER_CONFIRMATION, SHARED_PHASE_DIRECTORY, STDOUT_LIMIT, VERIFIER_IMAGE } from '../hosting/constants.mjs';
import { createCoordinator, reservePublicGeneration } from '../hosting/coordinator.mjs';
import { resolveOperatorGeneration } from '../hosting/generation.mjs';
import { seedVerifiedParent } from '../hosting/seed-parent.mjs';
import { buildCreatorPage } from '../scripts/build-creator.mjs';
import { createFakeMetaClient } from '../hosting/fake-client.mjs';
import { workerArguments } from '../hosting/isolation.mjs';
import { admitProductionRequest, createProductionPolicy, parseRemixBody } from '../hosting/policy.mjs';
import { parseJob } from '../hosting/protocol.mjs';
import { publishArtifact } from '../hosting/publish.mjs';
import { createJobQueue } from '../hosting/queue.mjs';
import { createWorkerBroker, discardOutput, readOutput } from '../hosting/broker.mjs';
import { createBrokerClient } from '../hosting/broker-client.mjs';
import { createHostingServer } from '../hosting/server.mjs';

const execute = promisify(execFile);
const ledgerUrl = new URL('../reports/motion-transfer-phase/phase-budget.json', import.meta.url);
const ledgerHash = async () => createHash('sha256').update(await readFile(ledgerUrl)).digest('hex');
const intent = { unitScale: 0.1, activation: 'held', direction: 'facing' };
const parentIntent = { unitScale: 0.2, activation: 'held', direction: 'facing' };
const workerJavaScript = 'export {}\n';
const parentSource = 'export function init(motion,config){return {core:motion.init(config.motion)}}\n';
const parentComponent = {
  id: SAVED_COMPONENT_ID,
  javascript: 'export function init(){return {}}\n',
  contract: { name: 'Recovered dash and walking controller', defaults: { dashDistance: 60 } },
};
const parentRecipient = { name: 'RDSTR Stunts', revision: '8486687c6c885d49231744d5d9434ac4fe21f951' };

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'motion-hosting-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function verified(componentId, frame) {
  return job => {
    const sourceSha256 = createHash('sha256').update(job.source).digest('hex');
    const javascriptSha256 = createHash('sha256').update(workerJavaScript).digest('hex');
    const frameSha = frame ? createHash('sha256').update(frame).digest('hex') : null;
    return {
      ok: true, terminated: null, error: null, envNames: ['PATH', 'HOME'],
      result: {
        ok: true, passed: true, operation: job.operation, executedIn: 'worker', uid: 10001, componentId,
        sourceSha256, javascriptSha256, checks: [{ name: job.operation, passed: true }],
        javascript: job.operation === 'verify-native' ? workerJavaScript : null,
        frame: frame && job.operation === 'verify-browser' ? { sha256: frameSha, bytes: frame.length } : null,
        frameSha256: frame && job.operation === 'verify-browser' ? frameSha : null,
      },
      frame: frame && job.operation === 'verify-browser' ? frame : null,
    };
  };
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

async function setup(t, broker, client, options = {}) {
  const directory = await temp(t);
  const ledgerDirectory = await temp(t);
  await createPhaseBudget(ledgerDirectory);
  const coordinator = await createCoordinator({
    directory, broker, client, ledgerDirectory, localVerification: true, ...options,
  });
  const parentId = 'ab'.repeat(32);
  await coordinator.putParent({
    id: parentId, bytes: Buffer.from('parent-v1'), intent: parentIntent,
    source: parentSource, component: parentComponent, recipient: parentRecipient,
  });
  t.after(() => coordinator.close());
  return { directory, coordinator, parentId, ledgerDirectory };
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
  assert.throws(() => parseJob({ operation: 'verify-native', source: 'export {}\n', intent }), /component id is invalid/);
  assert.throws(() => parseJob({
    operation: 'verify-native', source: 'export {}\n', intent, componentId: '../components/dashy-dango-dash',
  }), /component id is invalid/);
  assert.throws(() => parseJob({
    operation: 'verify-browser', source: 'export {}\n', intent, componentId: parentComponent.id, path: '/tmp/pin',
  }), /unexpected field/);
  const parsed = parseJob({ operation: 'verify-native', source: 'export {}\n', intent, componentId: parentComponent.id });
  assert.equal(parsed.componentId, parentComponent.id);
  assert.deepEqual(Object.keys(parsed).sort(), ['componentId', 'intent', 'operation', 'source']);
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

test('broker output accepts only bounded regular files', async t => {
  const root = await temp(t);
  const marker = 'outside-marker-not-a-secret';
  await writeFile(join(root, 'outside.txt'), marker);
  const linked = join(root, 'linked');
  await mkdir(linked);
  await symlink(join(root, 'outside.txt'), join(linked, 'result.json'));
  const rejected = await readOutput(linked, marker, {}).then(() => { throw Error('symlink was accepted'); }, error => error);
  assert.match(rejected.message, /not a regular file/);
  assert.equal(rejected.message.includes(marker), false);
  assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), marker);

  const frameLink = join(root, 'frame-link');
  await mkdir(frameLink);
  const receipt = JSON.stringify({ ok: true, frame: { sha256: 'ab'.repeat(32), bytes: marker.length } });
  await writeFile(join(frameLink, 'result.json'), receipt);
  await symlink(join(root, 'outside.txt'), join(frameLink, 'frame.html'));
  const frameRejected = await readOutput(frameLink, receipt, JSON.parse(receipt)).then(() => { throw Error('frame symlink was accepted'); }, error => error);
  assert.match(frameRejected.message, /not a regular file/);
  assert.equal(frameRejected.message.includes(marker), false);

  const fifo = join(root, 'fifo');
  await mkdir(fifo);
  await execute('mkfifo', [join(fifo, 'result.json')]);
  const started = Date.now();
  const fifoResult = await Promise.race([
    readOutput(fifo, '{}', {}).then(() => { throw Error('fifo was accepted'); }, error => error),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 1000)),
  ]);
  assert.notEqual(fifoResult, 'blocked');
  assert.match(fifoResult.message, /not a regular file/);
  assert.ok(Date.now() - started < 1000);

  const extra = join(root, 'extra');
  await mkdir(extra);
  await writeFile(join(extra, 'result.json'), '{}');
  await writeFile(join(extra, 'note.txt'), 'nope');
  await assert.rejects(() => readOutput(extra, '{}', {}), /unexpected output file/);

  const oversized = join(root, 'oversized');
  await mkdir(oversized);
  const huge = Buffer.alloc(STDOUT_LIMIT + 1, 0x61).toString('utf8');
  await writeFile(join(oversized, 'result.json'), huge);
  await assert.rejects(() => readOutput(oversized, huge, {}), /exceeds the output limit/);

  const frame = Buffer.from('<!doctype html><title>ok</title>');
  const hash = createHash('sha256').update(frame).digest('hex');
  const body = JSON.stringify({ ok: true, frame: { sha256: hash, bytes: frame.length } });
  const valid = join(root, 'valid');
  await mkdir(valid);
  await writeFile(join(valid, 'result.json'), body);
  await writeFile(join(valid, 'frame.html'), frame);
  assert.equal((await readOutput(valid, body, JSON.parse(body))).toString(), frame.toString());
  const mismatched = JSON.parse(body);
  mismatched.frame.sha256 = 'cd'.repeat(32);
  await assert.rejects(() => readOutput(valid, body, mismatched), /hash mismatch/);
  mismatched.frame.sha256 = hash;
  mismatched.frame.bytes = FRAME_LIMIT + 1;
  await assert.rejects(() => readOutput(valid, body, mismatched), /exceeds the output limit/);

  const sparse = join(root, 'sparse');
  await mkdir(sparse);
  const claimed = JSON.stringify({ ok: true, frame: { sha256: hash, bytes: 4 } });
  await writeFile(join(sparse, 'result.json'), claimed);
  const handle = await open(join(sparse, 'frame.html'), 'w');
  await handle.truncate(FRAME_LIMIT + 1);
  await handle.close();
  await assert.rejects(() => readOutput(sparse, claimed, JSON.parse(claimed)), /exceeds the output limit/);
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
  assert.equal(admitProductionRequest({ ...base, method: 'GET', path: '/', headers }).ok, true);
  assert.equal(admitProductionRequest({ ...base, method: 'GET', path: `/parents/${'ab'.repeat(32)}/download`, headers }).ok, true);
  assert.equal(admitProductionRequest({ ...base, method: 'GET', path: `/artifacts/${'ab'.repeat(32)}/adapter.js`, headers }).ok, true);
  assert.equal(admitProductionRequest({ ...base, headers: { ...headers, 'x-invite-code': 'nope-nope' } }).status, 401);
  assert.equal(admitProductionRequest({ ...base, bodyLength: 5000, headers }).status, 413);
  assert.throws(() => parseRemixBody({ ...remix('ab'.repeat(32)), adultConfirmed: false }), /18 and older/);
  assert.throws(() => parseRemixBody({ ...remix('ab'.repeat(32)), model: 'muse-spark-1.3-contributor' }), /Invalid remix request/);
  assert.throws(() => parseRemixBody({ ...remix('ab'.repeat(32)), source: 'export {}' }), /Invalid remix request/);
  assert.equal(admitProductionRequest({ ...base, method: 'GET', path: '/api/catalog', headers }).ok, true);
  assert.equal(admitProductionRequest({ ...base, method: 'POST', path: '/creator/index.html', headers }).status, 403);
  assert.throws(() => createProductionPolicy({ hosts: ['localhost'], origins: ['https://play.example'] }), /Localhost/);
});

test('hosted remixes fail closed, keep the parent, and leave the public reserve unused', async t => {
  const before = await ledgerHash();
  const frame = Buffer.from('<!doctype html><title>remix</title>');
  const calls = [];
  const client = createFakeMetaClient({ source: 'export function init(){return {}}', intent });
  const count = client.countInputTokens.bind(client);
  client.countInputTokens = async request => { calls.push('provider'); return count(request); };
  const broker = fakeBroker(async job => {
    calls.push(job.operation);
    if (job.operation.startsWith('verify-')) assert.equal(job.componentId, parentComponent.id);
    return verified(parentComponent.id, frame)(job);
  });
  const { coordinator, parentId } = await setup(t, broker, client);
  const first = remix(parentId);
  const accepted = await coordinator.submit(first);
  const ready = await coordinator.wait(accepted.id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.publicReservedUsd, 0);
  assert.equal(ready.model, 'muse-spark-1.3');
  const providerRequest = client.calls.find(call => call.method === 'countInputTokens').request;
  assert.equal(providerRequest.tools[0].parameters.required.includes('status'), true);
  assert.equal(providerRequest.instructions, ROADSTER_INSTRUCTIONS);
  assert.equal(providerRequest.tools[0].name, ROADSTER_TOOL.name);
  const evidence = JSON.parse(providerRequest.input[0].content[0].text);
  assert.equal(evidence.parentSource, parentSource);
  assert.equal(evidence.parentIntent.unitScale, parentIntent.unitScale);
  assert.equal(evidence.component.javascript, parentComponent.javascript);
  assert.equal(evidence.component.contract.name, parentComponent.contract.name);
  assert.equal(evidence.recipient.name, parentRecipient.name);
  assert.equal(evidence.recipient.policy, ROADSTER_RECIPIENT_POLICY);
  assert.deepEqual(calls, ['provider', 'verify-native', 'verify-browser']);
  assert.equal(ready.urls.play.includes('localhost'), false);
  assert.equal(ready.urls.play.startsWith('/artifacts/'), true);
  assert.deepEqual(ready.parentChain, [parentId, ready.artifactId]);
  assert.equal(ready.urls.parent, `/parents/${parentId}`);
  assert.equal(ready.urls.download, `/artifacts/${ready.artifactId}/download`);
  assert.equal((await coordinator.artifactFile(ready.artifactId, 'adapter.js')).toString(), workerJavaScript);
  assert.equal((await coordinator.parentBytes(parentId)).toString(), 'parent-v1');
  const again = await coordinator.submit(first);
  assert.equal(again.id, accepted.id);
  assert.equal(calls.length, 3);
  await assert.rejects(() => coordinator.submit({ ...first, prompt: 'A different request.' }), /different input/);

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
  await assert.rejects(() => reservePublicGeneration({ releasePublished: true, id: 'public:temp', maxCostUsd: 0.15 }), /explicit phase ledger path/);
  const phase = await temp(t);
  await createPhaseBudget(phase);
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
  assert.equal(source.includes('executeAdapter'), false);
  assert.equal(source.includes('esbuild'), false);
  assert.equal(source.includes('docker.sock'), false);
  assert.equal(source.includes('child_process'), false);
  assert.equal(source.includes('transfer-roadster'), false);
  assert.equal(source.includes('createMetaClient'), false);
  assert.equal(source.includes('createFakeMetaClient'), false);
  assert.equal(source.includes('component-load'), false);
  assert.equal(source.includes('resolveComponentRef'), false);
  assert.equal(source.includes('quickjs'), false);
  assert.equal(source.includes('component/build'), false);
  const image = await readFile(new URL('../Dockerfile.coordinator', import.meta.url), 'utf8');
  assert.equal(image.includes('evaluator/'), false);
  assert.equal(image.includes('component-load'), false);
  assert.match(image, /AS creator/);
  assert.match(image, /build-creator\.mjs/);
  assert.equal(image.includes('COPY web/dist/creator'), false);
  const requestBuilder = await readFile(new URL('../agent/roadster-request.mjs', import.meta.url), 'utf8');
  assert.equal(requestBuilder.includes('evaluator/'), false);
  assert.equal(requestBuilder.includes('compileAdapter'), false);
  const docs = await readFile(new URL('../docs/hosting.md', import.meta.url), 'utf8');
  const serve = await readFile(new URL('../hosting/serve.mjs', import.meta.url), 'utf8');
  assert.equal(docs.includes('hosting-integration.patch'), false);
  assert.equal(docs.includes('/tmp/motion-transfer-cursor'), false);
  assert.match(serve, /releasePublished:\s*false/);
  assert.equal(serve.includes('docker.sock'), false);
  assert.equal(serve.includes('charge-shared-public-reserve'), false);
  assert.equal(serve.includes('createPhaseBudget'), false);
  assert.equal(serve.includes('createFakeMetaClient'), false);
  assert.match(serve, /resolveOperatorGeneration/);
});

test('the production server enforces remix limits and does not redirect', async t => {
  const frame = Buffer.from('<!doctype html><title>remix</title>');
  const broker = fakeBroker(verified(parentComponent.id, frame));
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
  const catalog = JSON.parse((await send('GET', '/')).body);
  assert.equal(catalog.parents.some(item => item.id === parentId), true);
  assert.equal(catalog.artifacts.some(item => item.id === finished.artifactId), true);
  const parent = await send('GET', finished.urls.parent);
  assert.equal(parent.status, 200);
  assert.equal(parent.body, 'parent-v1');
  assert.equal(parent.headers.location, undefined);
  const download = await send('GET', finished.urls.download);
  assert.equal(download.status, 200);
  assert.match(download.headers['content-disposition'], /attachment/);
  assert.match(download.body, /remix/);
  const adapter = await send('GET', finished.urls.adapter);
  assert.equal(adapter.status, 200);
  assert.equal(adapter.body, workerJavaScript);
  assert.match(adapter.headers['content-disposition'], /attachment/);
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

test('a follow-up keeps the full parent chain across restart', async t => {
  const frames = [Buffer.from('<!doctype html><title>child</title>'), Buffer.from('<!doctype html><title>grand</title>')];
  let browsers = 0;
  const bound = [];
  const broker = fakeBroker(async job => {
    const frame = frames[Math.min(browsers, frames.length - 1)];
    if (job.operation === 'verify-native') bound.push(job.componentId);
    if (job.operation === 'verify-browser') browsers += 1;
    return verified(parentComponent.id, frame)(job);
  });
  const followIntent = { unitScale: 0.1, activation: 'press', direction: 'opposite' };
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const respond = client.respond.bind(client);
  let responses = 0;
  client.respond = async request => {
    const response = await respond(request);
    responses += 1;
    if (responses > 1) {
      response.output[0].arguments = JSON.stringify({
        status: 'supported', source: 'export function init(){return {}}\n', summary: 'Opposite press.', intent: followIntent,
      });
    }
    return response;
  };
  const { directory, coordinator, parentId, ledgerDirectory } = await setup(t, broker, client);
  const firstRequest = remix(parentId);
  const session = firstRequest.sessionId;
  const ready = await coordinator.wait((await coordinator.submit(firstRequest)).id);
  assert.equal(ready.status, 'ready', ready.error);
  assert.deepEqual(ready.parentChain, [parentId, ready.artifactId]);
  const followRequest = remix(ready.artifactId, session);
  const next = await coordinator.wait((await coordinator.submit(followRequest)).id);
  assert.equal(next.status, 'ready', next.error);
  assert.deepEqual(next.parentChain, [parentId, ready.artifactId, next.artifactId]);
  assert.equal(next.urls.parent, `/artifacts/${ready.artifactId}/play.html`);
  assert.equal((await coordinator.parentBytes(parentId)).toString(), 'parent-v1');
  assert.equal((await coordinator.parentBytes(ready.artifactId)).toString(), frames[0].toString());
  await assert.rejects(() => coordinator.submit(remix(parentId, session)), /quota/);
  assert.equal(broker.calls.length, 4);
  assert.deepEqual(bound, [parentComponent.id, parentComponent.id]);
  assert.equal(responses, 2);
  const journal = await readFile(join(directory, 'journal.jsonl'), 'utf8');
  assert.match(journal, new RegExp(parentId));
  assert.match(journal, /"kind":"published"/);
  await coordinator.close();
  const reopened = await createCoordinator({ directory, broker, client, ledgerDirectory, localVerification: true });
  t.after(() => reopened.close());
  assert.deepEqual((await reopened.job(next.id)).parentChain, next.parentChain);
  assert.equal((await reopened.parentBytes(parentId)).toString(), 'parent-v1');
  assert.equal((await reopened.parentBytes(ready.artifactId)).toString(), frames[0].toString());
  const replay = await reopened.submit(followRequest);
  assert.equal(replay.id, next.id);
  assert.equal(broker.calls.length, 4);
  assert.equal(responses, 2);
});

test('the same idempotency key reconnects to one job', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const respond = client.respond.bind(client);
  let responses = 0;
  client.respond = async request => { responses += 1; await gate; return respond(request); };
  const broker = fakeBroker(verified(parentComponent.id, Buffer.from('<!doctype html><title>remix</title>')));
  broker.available = async () => { await new Promise(resolve => setTimeout(resolve, 30)); return true; };
  const { coordinator, parentId } = await setup(t, broker, client);
  const request = remix(parentId);
  const [first, second] = await Promise.all([coordinator.submit(request), coordinator.submit(request)]);
  assert.equal(first.id, second.id);
  release();
  assert.equal((await coordinator.wait(first.id)).status, 'ready');
  assert.equal(responses, 1);
  assert.equal(broker.calls.length, 2);
});

test('publication waits for a real worker result', async t => {
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const liar = fakeBroker(async job => ({
    ok: true, terminated: null, error: null,
    result: {
      ok: true, passed: true, executedIn: 'coordinator', operation: job.operation, uid: 10001,
      componentId: 'cd'.repeat(32), sourceSha256: createHash('sha256').update(job.source).digest('hex'),
    },
  }));
  const denied = await setup(t, liar, client);
  const failed = await denied.coordinator.wait((await denied.coordinator.submit(remix(denied.parentId))).id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /real isolated worker/);
  assert.equal(failed.artifactId, null);
  assert.equal((await denied.coordinator.parentBytes(denied.parentId)).toString(), 'parent-v1');
  const names = await readdir(join(denied.directory, 'artifacts')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(names, []);

  const frameless = fakeBroker(async job => verified(parentComponent.id, null)(job));
  const missing = await setup(t, frameless, client);
  const unpublished = await missing.coordinator.wait((await missing.coordinator.submit(remix(missing.parentId))).id);
  assert.equal(unpublished.status, 'failed');
  assert.match(unpublished.error, /frame was not returned/);
  assert.equal(unpublished.artifactId, null);
});

test('playback stays up when generation is not configured', async t => {
  const directory = await temp(t);
  const broker = fakeBroker(async () => { throw Error('worker must not run'); });
  broker.up = false;
  const coordinator = await createCoordinator({ directory, broker, client: null });
  t.after(() => coordinator.close());
  const parentId = 'ab'.repeat(32);
  await coordinator.putParent({ id: parentId, bytes: Buffer.from('<!doctype html><title>parent</title>'), intent: parentIntent });
  assert.equal(coordinator.status().generationConfigured, false);
  assert.equal(coordinator.status().publicReservedUsd, 0);
  const catalog = await coordinator.catalog();
  assert.equal(catalog.artifacts.length, 0);
  assert.equal(catalog.parents[0].id, parentId);
  const policy = createProductionPolicy({
    hosts: ['play.example'], origins: ['https://play.example'], inviteCodes: ['test-invite-code'],
  });
  const server = await createHostingServer({ policy, coordinator });
  t.after(() => server.close());
  const body = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.port, path: `/parents/${parentId}`, method: 'GET', setHost: false, headers: { Host: 'play.example' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, location: response.headers.location, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(body.status, 200);
  assert.equal(body.location, undefined);
  assert.match(body.body, /parent/);
  await assert.rejects(() => coordinator.submit(remix(parentId)), /refuses in-process execution/);
  broker.up = true;
  await assert.rejects(() => coordinator.submit(remix(parentId)), /not configured/);
  assert.equal(broker.calls.length, 0);
});

test('generation reserves an explicit temp ledger before any local fake provider call', async t => {
  const before = await ledgerHash();
  const frame = Buffer.from('<!doctype html><title>reserved</title>');
  const broker = fakeBroker(verified(parentComponent.id, frame));
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const count = client.countInputTokens.bind(client);
  let reservedBeforeCount = false;
  const { directory, coordinator, parentId, ledgerDirectory } = await setup(t, broker, client);
  client.countInputTokens = async (request, signal) => {
    const phase = await createPhaseBudget(ledgerDirectory);
    const status = await phase.status();
    assert.equal(status.categories.remix.reservedUsd, 0.15);
    assert.equal(status.categories.public.reservedUsd, 0);
    assert.equal(status.categories.public.settledUsd, 0);
    const jobFile = (await readdir(join(directory, 'jobs'))).find(name => name.endsWith('.json'));
    const stored = JSON.parse(await readFile(join(directory, 'jobs', jobFile), 'utf8'));
    assert.equal(stored.status, 'pending');
    assert.equal(stored.provider.status, 'pending');
    reservedBeforeCount = true;
    return count(request, signal);
  };
  const ready = await coordinator.wait((await coordinator.submit(remix(parentId))).id);
  assert.equal(ready.status, 'ready', ready.error);
  assert.equal(reservedBeforeCount, true);
  assert.equal(ready.publicReservedUsd, 0);
  const settled = await (await createPhaseBudget(ledgerDirectory)).status();
  assert.equal(settled.uncertain, false);
  assert.equal(settled.categories.public.settledUsd, 0);
  assert.equal(settled.categories.public.reservedUsd, 0);
  assert.ok(settled.categories.remix.settledUsd > 0);
  assert.ok(settled.categories.remix.settledUsd < 0.15);
  const stored = JSON.parse(await readFile(join(directory, 'jobs', `${ready.id}.json`), 'utf8'));
  assert.equal(stored.provider.status, 'responded');
  assert.equal(await ledgerHash(), before);
});

test('a missing or shared ledger never starts a provider call', async t => {
  const before = await ledgerHash();
  const broker = fakeBroker(verified(parentComponent.id, Buffer.from('<!doctype html>')));
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const directory = await temp(t);
  const missing = await createCoordinator({ directory, broker, client, localVerification: true });
  t.after(() => missing.close());
  const parentId = 'ab'.repeat(32);
  await missing.putParent({
    id: parentId, bytes: Buffer.from('parent-v1'), intent: parentIntent,
    source: parentSource, component: parentComponent, recipient: parentRecipient,
  });
  await assert.rejects(() => missing.submit(remix(parentId)), /explicit phase ledger/);
  assert.equal(client.calls.length, 0);
  await assert.rejects(() => access(join(directory, 'phase-budget.json')), error => error.code === 'ENOENT');
  const emptyLedger = await temp(t);
  await assert.rejects(() => reservePublicGeneration({
    directory: emptyLedger, releasePublished: true, id: 'public:missing', maxCostUsd: 0.15,
  }), /missing/);
  await assert.rejects(() => access(join(emptyLedger, 'phase-budget.json')), error => error.code === 'ENOENT');
  const sharedDirectory = await temp(t);
  const shared = await createCoordinator({
    directory: sharedDirectory, broker, client, ledgerDirectory: SHARED_PHASE_DIRECTORY, localVerification: true,
  });
  t.after(() => shared.close());
  await shared.putParent({
    id: parentId, bytes: Buffer.from('parent-v1'), intent: parentIntent,
    source: parentSource, component: parentComponent, recipient: parentRecipient,
  });
  await assert.rejects(() => shared.submit(remix(parentId)), /Shared public reserve was not confirmed/);
  assert.equal(client.calls.length, 0);
  assert.equal(await ledgerHash(), before);
  const unconfirmedLedger = await temp(t);
  const unconfirmed = await createCoordinator({
    directory: await temp(t), broker, client, ledgerDirectory: unconfirmedLedger, localVerification: false,
  });
  t.after(() => unconfirmed.close());
  await unconfirmed.putParent({
    id: parentId, bytes: Buffer.from('parent-v1'), intent: parentIntent,
    source: parentSource, component: parentComponent, recipient: parentRecipient,
  });
  await assert.rejects(() => unconfirmed.submit(remix(parentId)), /confirmation is required/);
  assert.equal(client.calls.length, 0);
  await assert.rejects(() => access(join(unconfirmedLedger, 'phase-budget.json')), error => error.code === 'ENOENT');
});

test('unknown provider usage stays reserved and a restart does not retry', async t => {
  const broker = fakeBroker(verified(parentComponent.id, Buffer.from('<!doctype html>')));
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  client.respond = async () => {
    client.calls.push({ method: 'respond' });
    throw Error('uncertain transport');
  };
  const { coordinator, parentId, ledgerDirectory } = await setup(t, broker, client);
  const failed = await coordinator.wait((await coordinator.submit(remix(parentId))).id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /uncertain transport/);
  assert.equal(broker.calls.length, 0);
  assert.equal((await (await createPhaseBudget(ledgerDirectory)).status()).uncertain, true);
  await assert.rejects(() => coordinator.submit(remix(parentId)), /no further inference admitted/);
  assert.equal(client.calls.filter(call => call.method === 'respond').length, 1);

  const hung = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  hung.respond = (request, signal) => new Promise((resolve, reject) => {
    hung.calls.push({ method: 'respond', model: request.model });
    const timer = setTimeout(resolve, 30_000);
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? Error('aborted')); };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
  const timed = await setup(t, fakeBroker(verified(parentComponent.id, Buffer.from('<!doctype html>'))), hung, { providerDeadlineMs: 200 });
  const expired = await timed.coordinator.wait((await timed.coordinator.submit(remix(timed.parentId))).id);
  assert.equal(expired.status, 'failed');
  assert.match(expired.error, /timeout|aborted/i);
  assert.equal((await (await createPhaseBudget(timed.ledgerDirectory)).status()).uncertain, true);
  await assert.rejects(() => timed.coordinator.submit(remix(timed.parentId)), /no further inference admitted/);
  assert.equal(hung.calls.filter(call => call.method === 'respond').length, 1);

  const over = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent, inputTokens: 12001 });
  let responses = 0;
  const respond = over.respond.bind(over);
  over.respond = async (...args) => { responses += 1; return respond(...args); };
  const idle = fakeBroker(async () => { throw Error('worker must not run'); });
  const limited = await setup(t, idle, over);
  const rejected = await limited.coordinator.wait((await limited.coordinator.submit(remix(limited.parentId))).id);
  assert.match(rejected.error, /input-token limit/);
  assert.equal(responses, 0);
  assert.equal(idle.calls.length, 0);
  assert.equal((await (await createPhaseBudget(limited.ledgerDirectory)).status()).uncertain, true);

  const quiet = fakeBroker(async () => { throw Error('worker must not run'); });
  const unsupported = createFakeMetaClient({
    status: 'unsupported', source: '', intent: parentIntent, summary: 'Jumping is outside the port.',
  });
  const held = await setup(t, quiet, unsupported);
  const explanation = await held.coordinator.wait((await held.coordinator.submit(remix(held.parentId))).id);
  assert.equal(explanation.status, 'unsupported');
  assert.match(explanation.error, /Jumping/);
  assert.equal(quiet.calls.length, 0);
  const heldLedger = await (await createPhaseBudget(held.ledgerDirectory)).status();
  assert.equal(heldLedger.uncertain, false);
  assert.ok(heldLedger.categories.remix.settledUsd > 0);
  assert.equal(heldLedger.categories.public.settledUsd, 0);

  const jobId = randomUUID();
  const idempotencyKey = randomUUID();
  const sessionId = randomUUID();
  const replayClient = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const pendingDirectory = await temp(t);
  const pendingLedger = await temp(t);
  await createPhaseBudget(pendingLedger);
  const pendingParent = 'ab'.repeat(32);
  await mkdir(join(pendingDirectory, 'parents'), { recursive: true });
  await writeFile(join(pendingDirectory, 'parents', pendingParent), 'parent-v1');
  await writeFile(join(pendingDirectory, 'parents', `${pendingParent}.intent.json`), JSON.stringify(parentIntent));
  await writeFile(join(pendingDirectory, 'parents', `${pendingParent}.source.ts`), parentSource);
  await writeFile(join(pendingDirectory, 'parents', `${pendingParent}.component.json`), JSON.stringify(parentComponent));
  await writeFile(join(pendingDirectory, 'parents', `${pendingParent}.recipient.json`), JSON.stringify(parentRecipient));
  await mkdir(join(pendingDirectory, 'jobs'), { recursive: true });
  await writeFile(join(pendingDirectory, 'jobs', `${jobId}.json`), JSON.stringify({
    schemaVersion: 1, id: jobId, status: 'pending', sessionId, idempotencyKey,
    parentArtifactId: pendingParent, ancestors: [pendingParent], prompt: 'Make the dash half as long.',
    model: 'muse-spark-1.3', error: null, artifactId: null, urls: null, inference: null,
    provider: { status: 'pending', reservationId: `remix:${jobId}` },
    events: [{ status: 'pending', at: '2026-11-02T00:00:00.000Z' }],
    createdAt: '2026-11-02T00:00:00.000Z', finishedAt: null,
  }));
  const reopened = await createCoordinator({
    directory: pendingDirectory, broker, client: replayClient, ledgerDirectory: pendingLedger, localVerification: true,
  });
  t.after(() => reopened.close());
  const restarted = await reopened.job(jobId);
  assert.equal(restarted.status, 'failed');
  assert.match(restarted.error, /Parent unchanged/);
  const replay = await reopened.submit({
    prompt: 'Make the dash half as long.', parentArtifactId: pendingParent, idempotencyKey, sessionId, adultConfirmed: true,
  });
  assert.equal(replay.id, jobId);
  assert.equal(replay.status, 'failed');
  assert.equal(replayClient.calls.length, 0);
});

test('operator configuration stays off and a seeded parent keeps its verified context', async t => {
  assert.equal(resolveOperatorGeneration({}, { origins: ['https://play.example'] }), null);
  assert.throws(() => resolveOperatorGeneration({
    HOSTING_GENERATION_CONFIRMATION: 'nope',
  }, { origins: ['https://play.example'] }), /confirmation is required/);
  assert.throws(() => resolveOperatorGeneration({
    HOSTING_GENERATION_CONFIRMATION, HOSTING_PHASE_LEDGER: SHARED_PHASE_DIRECTORY,
    HOSTING_PUBLISHED_ORIGIN: 'https://play.example', HOSTING_STANDARD_CLIENT: 'operator',
  }, { origins: ['https://play.example'] }), /Shared public reserve was not confirmed/);
  const configuredLedger = await temp(t);
  assert.throws(() => resolveOperatorGeneration({
    HOSTING_GENERATION_CONFIRMATION, HOSTING_PHASE_LEDGER: configuredLedger,
    HOSTING_PUBLISHED_ORIGIN: 'https://play.example', HOSTING_STANDARD_CLIENT: 'operator',
    HOSTING_SHARED_LEDGER_CONFIRMATION: SHARED_LEDGER_CONFIRMATION,
  }, { origins: ['https://play.example'] }), /existing shared phase ledger/);
  const configured = resolveOperatorGeneration({
    HOSTING_GENERATION_CONFIRMATION, HOSTING_PHASE_LEDGER: SHARED_PHASE_DIRECTORY,
    HOSTING_PUBLISHED_ORIGIN: 'https://play.example', HOSTING_STANDARD_CLIENT: 'operator',
    HOSTING_SHARED_LEDGER_CONFIRMATION: SHARED_LEDGER_CONFIRMATION,
  }, { origins: ['https://play.example'] });
  assert.equal(configured.model, 'muse-spark-1.3');
  assert.equal(configured.maxCostUsd, 0.15);
  assert.equal(configured.ledgerDirectory, resolve(SHARED_PHASE_DIRECTORY));
  assert.equal(configured.confirmSharedLedger, SHARED_LEDGER_CONFIRMATION);

  const artifactDirectory = fileURLToPath(new URL(`../transfers/roadster/versions/${SAVED_ARTIFACT_ID}/`, import.meta.url));
  await assert.rejects(() => access(join(artifactDirectory, 'recipient.json')), error => error.code === 'ENOENT');
  await assert.rejects(() => access(join(artifactDirectory, 'component.js')), error => error.code === 'ENOENT');
  const dataDirectory = await temp(t);
  const seeded = await seedVerifiedParent({ dataDirectory, artifactDirectory });
  const id = seeded.id;
  assert.equal(seeded.componentId, SAVED_COMPONENT_ID);
  const seededSource = await readFile(join(dataDirectory, 'parents', `${id}.source.ts`), 'utf8');
  assert.equal(seededSource, await readFile(join(artifactDirectory, 'adapter.ts'), 'utf8'));
  const seededIntent = JSON.parse(await readFile(join(dataDirectory, 'parents', `${id}.intent.json`), 'utf8'));
  const seededComponent = JSON.parse(await readFile(join(dataDirectory, 'parents', `${id}.component.json`), 'utf8'));
  assert.equal(seededComponent.id, SAVED_COMPONENT_ID);
  await assert.rejects(() => access(join(dataDirectory, 'phase-budget.json')), error => error.code === 'ENOENT');

  const ledgerDirectory = await temp(t);
  await createPhaseBudget(ledgerDirectory);
  const broker = fakeBroker(verified(parentComponent.id, Buffer.from('<!doctype html><title>seeded</title>')));
  const client = createFakeMetaClient({
    source: 'export function step(){return {}}\n',
    intent: { ...seededIntent, unitScale: seededIntent.unitScale === 0.1 ? 0.2 : 0.1 },
  });
  const coordinator = await createCoordinator({
    directory: dataDirectory, broker, client, ledgerDirectory, localVerification: true,
  });
  t.after(() => coordinator.close());
  const ready = await coordinator.wait((await coordinator.submit(remix(id))).id);
  assert.equal(ready.status, 'ready', ready.error);
  const evidence = JSON.parse(client.calls[0].request.input[0].content[0].text);
  assert.equal(evidence.parentSource, seededSource);
  assert.equal(evidence.component.javascript, seededComponent.javascript);
  assert.equal(evidence.component.contract.defaults.dashDistance, 60);
  const childComponent = JSON.parse((await coordinator.artifactFile(ready.artifactId, 'component.json')).toString('utf8'));
  assert.equal(childComponent.id, SAVED_COMPONENT_ID);
  assert.equal(childComponent.javascript, seededComponent.javascript);
  assert.equal((await (await createPhaseBudget(ledgerDirectory)).status()).categories.public.settledUsd, 0);

  const creatorRoot = await temp(t);
  await writeFile(join(creatorRoot, 'index.html'), (await buildCreatorPage()).html);
  const policy = createProductionPolicy({
    hosts: ['play.example'], origins: ['https://play.example'], inviteCodes: ['test-invite-code'],
  });
  const server = await createHostingServer({ policy, coordinator, creatorRoot });
  t.after(() => server.close());
  const send = path => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.port, path, method: 'GET', setHost: false, headers: { Host: 'play.example' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
  const catalog = JSON.parse((await send('/api/catalog')).body);
  assert.equal(catalog.routes.catalog, '/api/catalog');
  assert.equal(catalog.parents.some(item => item.id === id), true);
  assert.equal(catalog.parents.find(item => item.id === id).intent.unitScale, seededIntent.unitScale);
  assert.equal(catalog.parents.find(item => item.id === id).summary, await readFile(join(dataDirectory, 'parents', `${id}.summary.txt`), 'utf8'));
  const page = await send('/');
  assert.match(page.body, /<!doctype html>/i);
  assert.match(page.body, /id="creator-root"/);
  assert.match((await send('/creator/index.html')).body, /id="creator-root"/);
  assert.equal((await send('/creator/../index.html')).status, 404);
});

test('compose config describes a coordinator without a docker socket', async t => {
  try { await execute('docker', ['info'], { timeout: 20_000 }); }
  catch { t.skip('docker daemon is not available; compose config was not executed'); return; }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { stdout } = await execute('docker', ['compose', '-f', 'compose.yaml', 'config'], { cwd: root });
  assert.match(stdout, /motion-transfer-coordinator:local/);
  assert.equal(stdout.includes('docker.sock'), false);
  assert.match(stdout, /cap_drop:[\s\S]*ALL/);
  assert.equal(stdout.includes('privileged: true'), false);
});

test('concurrent requests with one idempotency key keep the first input', async t => {
  let release;
  let entered;
  const opened = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const client = createFakeMetaClient({ source: 'export function init(){return {}}\n', intent });
  const broker = fakeBroker(verified(parentComponent.id, Buffer.from('<!doctype html>')));
  const { coordinator, parentId } = await setup(t, broker, client, {
    onAdmit() { entered(); return hold; },
  });
  const request = remix(parentId);
  const first = coordinator.submit(request);
  await opened;
  const same = coordinator.submit(request);
  const mismatch = coordinator.submit({ ...request, prompt: 'A different dash.' });
  await assert.rejects(mismatch, error => error.status === 409 && /different input/.test(error.message));
  release();
  const [left, right] = await Promise.all([first, same]);
  assert.equal(left.id, right.id);
  assert.equal((await coordinator.wait(left.id)).status, 'ready');
  assert.equal(broker.calls.length, 2);
});

test('worker output cleanup does not follow a symlink or throw', async t => {
  const root = await temp(t);
  const outside = join(root, 'outside.txt');
  await writeFile(outside, 'keep');
  const linked = join(root, 'linked');
  await mkdir(linked);
  await symlink(outside, join(linked, 'frame.html'));
  await discardOutput(linked);
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  await assert.rejects(() => access(linked), error => error.code === 'ENOENT');
  const blocked = join(root, 'blocked');
  await mkdir(join(blocked, 'sealed'), { recursive: true });
  await chmod(join(blocked, 'sealed'), 0o000);
  await discardOutput(blocked);
  await chmod(join(blocked, 'sealed'), 0o700).catch(() => {});
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
