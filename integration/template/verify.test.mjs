import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as component from './component/component.js';
import * as adapter from './adapter/adapter.js';

const read = path => readFile(new URL(path, import.meta.url));
const json = async path => JSON.parse(await read(path));
const sha = value => createHash('sha256').update(value).digest('hex');

test('downloaded files match the recorded package identities', async () => {
  const manifest = await json('manifest.json');
  for (const [path, expected] of Object.entries(manifest.files)) assert.equal(sha(await read(path)), expected.sha256, `Modified file: ${path}. Saved verification applies to the original export.`);
  const provenance = await json('component/provenance.json'), contract = await json('component/contract.json');
  const source = sha(await read('component/component.ts')), javascript = sha(await read('component/component.js'));
  assert.equal(source, provenance.sourceSha256); assert.equal(javascript, provenance.javascriptSha256);
  assert.equal(sha(JSON.stringify({ source, javascript, contract })), manifest.componentId);
});

test('standalone adapter reproduces the 100 saved controller observations', async () => {
  const config = await json('config.json');
  const report = await json('evidence/recipient-verification.json');
  let state = adapter.init(component, config);
  // These are the inputs of the report\'s declared held-timing fixture.
  // This replays saved integration evidence; it is not fresh donor acceptance.
  for (const [index, frame] of report.browser.traces.timing.frames.entries()) {
    const input = { tick: index, position: 30, facing: index >= 13 && index < 18 ? -1 : 1, dash: index >= 10, normalDisplacement: index === 0 ? 0 : 1 };
    const result = adapter.step(state, input, component, config);
    assert.deepEqual(result.state.core, frame.core, `Controller at tick ${frame.tick}`);
    assert.deepEqual(result.output, frame.output, `Adapter at tick ${frame.tick}`);
    state = result.state;
  }
});

test('ordinary recipient motion is retained before dash activation', async () => {
  const config = await json('config.json');
  let state = adapter.init(component, config);
  for (const normalDisplacement of [0, -1, 1, 0.25]) {
    const result = adapter.step(state, { facing: 1, dash: false, normalDisplacement }, component, config);
    assert.equal(result.output.ownsMotion, false); assert.equal(result.output.displacement, normalDisplacement);
    state = result.state;
  }
});
