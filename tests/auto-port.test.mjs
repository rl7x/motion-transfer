import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DRIVERS, EXCLUDED } from '../src/auto-port/drivers.mjs';
import { runPortInBrowser, injectRuntime } from '../src/auto-port/browser.mjs';
import { applyPatches, gatePatches } from '../src/auto-port/patches.mjs';
import { snapshot, verifyPort } from '../src/auto-port/verify.mjs';
import { parseJob } from '../src/hosting/protocol.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';
import { loadPinnedComponent } from '../src/hosting/component-load.mjs';
import { repositoryUrl } from '../src/paths.mjs';
import { REFERENCE_PORTS } from './fixtures/auto-port-references.mjs';

const reference = REFERENCE_PORTS.skyhaul.patches;
const failed = report => report.checks.filter(check => !check.passed).map(check => check.name);

test('every upstream game is pinned by hash, and each is driven or excluded with a reason', async () => {
  const lock = JSON.parse(await readFile(repositoryUrl('assets/auto-port/lock.json'), 'utf8'));
  assert.equal(lock.license, 'MIT');
  for (const file of lock.files) {
    const bytes = await readFile(repositoryUrl(`assets/auto-port/${file.local}`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.local);
  }
  const games = new Set(lock.files.map(file => file.local.split('/')[1]));
  assert.deepEqual([...games].sort(), [...Object.keys(DRIVERS), ...Object.keys(EXCLUDED)].sort());
});

test('patches apply only through unique anchors and cannot add new capabilities', () => {
  assert.equal(applyPatches('a b c', [{ anchor: 'b', replacement: '$& B' }]), 'a $& B c');
  assert.throws(() => applyPatches('a a', [{ anchor: 'a', replacement: 'b' }]), /matched 2 times/);
  assert.throws(() => applyPatches('a', [{ anchor: 'z', replacement: 'b' }]), /matched 0 times/);
  for (const banned of ['fetch("x")', 'Math.random()', 'Date.now()', 'globalThis.x=1', 'require("fs")', 'eval("1")']) {
    assert.throws(() => gatePatches([{ anchor: 'a', replacement: `a;${banned}` }]), /forbidden capability/, banned);
  }
  assert.doesNotThrow(() => gatePatches([{ anchor: 'Math.random()', replacement: 'Math.random() + MotionDash.calls' }]));
});

test('the worker accepts only a typed port job', () => {
  const job = { operation: 'auto-port-verify', gameId: 'skyhaul', patches: reference, unitsPerSourcePixel: 0.5, componentId: ACCEPTED_COMPONENT_ID };
  assert.deepEqual(parseJob(job), job);
  assert.throws(() => parseJob({ ...job, command: 'sh' }), /Arbitrary command/);
  assert.throws(() => parseJob({ ...job, extra: 1 }), /unexpected field/);
  assert.throws(() => parseJob({ ...job, gameId: '../etc' }), /Unknown auto-port game/);
  assert.throws(() => parseJob({ ...job, patches: Array(9).fill(reference[0]) }), /Invalid auto-port patches/);
});

test('state snapshots ignore the host dash slot and keep everything the game owns', () => {
  assert.equal(snapshot({ a: 1, motionDash: { core: 1 } }), snapshot({ a: 1 }));
  assert.notEqual(snapshot({ a: new Int16Array([1]) }), snapshot({ a: new Int16Array([2]) }));
});

test('the runtime is injected ahead of the first game script', () => {
  assert.match(injectRuntime('<head><script src="a.js"></script></head>'), /__motion-dash\.js"><\/script><script src="a\.js"/);
});

test('every driver passes a correct hand-written port, so a failure is not the measuring stick', { timeout: 420_000 }, async () => {
  const component = await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
  assert.deepEqual(Object.keys(REFERENCE_PORTS).sort(), Object.keys(DRIVERS).sort());
  for (const [gameId, port] of Object.entries(REFERENCE_PORTS)) {
    const report = await verifyPort({ gameId, patches: port.patches, unitsPerSourcePixel: port.scale, component, browser: runPortInBrowser });
    assert.deepEqual(failed(report), [], gameId);
    assert.equal(report.checks.length, 7);
    assert.ok(Math.abs(report.measurements.measured - report.measurements.expected) < report.measurements.expected * 0.05, gameId);
  }
});

test('broken ports fail the check built to catch them', { timeout: 180_000 }, async () => {
  const component = await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
  const verify = (patches, unitsPerSourcePixel = 0.5) => verifyPort({ gameId: 'skyhaul', patches, unitsPerSourcePixel, component });
  const usesGameRandom = [{ ...reference[0], replacement: `    g.rand();\n${reference[0].replacement}` }, reference[1]];
  assert.ok(failed(await verify(usesGameRandom)).includes('no-interference-without-dash'));
  const doubleTick = [{ ...reference[0], replacement: reference[0].replacement.replace('    L.x += L.vx * dt;', '    MotionDash.update(g, {});\n    L.x += L.vx * dt;') }, reference[1]];
  assert.ok(failed(await verify(doubleTick)).includes('recharge-blocks-second-dash'));
  assert.ok(failed(await verify(reference, 0.05)).includes('dash-fidelity'), 'the claimed distance must match the measured one');
  const unconnected = [{ anchor: '    L.x += L.vx * dt;', replacement: '    L.x += L.vx * dt;\n    const unused = 0;' }];
  const report = await verify(unconnected);
  assert.ok(failed(report).includes('recharge-blocks-second-dash'));
  assert.ok(failed(report).includes('dash-fidelity'));
});
