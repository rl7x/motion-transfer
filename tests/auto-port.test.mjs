import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DRIVERS, EXCLUDED } from '../src/auto-port/drivers.mjs';
import { runPortInBrowser, injectRuntime } from '../src/auto-port/browser.mjs';
import { applyPatches, gatePatches } from '../src/auto-port/patches.mjs';
import { snapshot, verifyPort } from '../src/auto-port/verify.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';
import { loadPinnedComponent } from '../src/hosting/component-load.mjs';
import { repositoryUrl } from '../src/paths.mjs';

// A hand-written port of one game, used only to prove the verifier. Spark never sees it.
const reference = [
  { anchor: '    L.x += L.vx * dt;', replacement: '    const dash = MotionDash.update(g, { left: dx < 0, right: dx > 0, up: dy < 0, down: dy > 0 });\n    L.x += L.vx * dt;\n    if (dash.owns) L.x += dash.dx * 0.5;' },
  { anchor: '    L.y += L.vy * dt;', replacement: '    L.y += L.vy * dt;\n    if (dash.owns) L.y += dash.dy * 0.5;' },
];
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

test('state snapshots ignore the host dash slot and keep everything the game owns', () => {
  assert.equal(snapshot({ a: 1, motionDash: { core: 1 } }), snapshot({ a: 1 }));
  assert.notEqual(snapshot({ a: new Int16Array([1]) }), snapshot({ a: new Int16Array([2]) }));
});

test('the runtime is injected ahead of the first game script', () => {
  assert.match(injectRuntime('<head><script src="a.js"></script></head>'), /__motion-dash\.js"><\/script><script src="a\.js"/);
});

test('a correct port passes every check, including the real browser game', { timeout: 180_000 }, async () => {
  const component = await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
  const report = await verifyPort({ gameId: 'skyhaul', patches: reference, unitsPerSourcePixel: 0.5, component, browser: runPortInBrowser });
  assert.deepEqual(failed(report), []);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 7);
  assert.ok(Math.abs(report.measurements.measured - 30) <= 3.2, String(report.measurements.measured));
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
