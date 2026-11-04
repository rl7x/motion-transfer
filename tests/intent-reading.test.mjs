import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
import { requestedParallaxiaIntent } from '../src/agent/recipient-request.mjs';

const source = await readFile(new URL('../web/app/ai-lab/intent.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { readRequest } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const parent = { unitScale: 0.1, activation: 'held', direction: 'facing' };
const PROMPTS = [
  'Make the dash backward, only on a fresh press.', 'Make it forward', 'Hold to dash', 'Half as far.', 'Twice as far.', 'double it',
  '3 world units', 'Set it to 9 units', 'Make it 40 units', 'triple the distance', 'make it longer', 'turn it into a teleport', '',
  'Make it backward and half as far', 'Give the ship a shield', 'Keep collisions and go backward', 'Give me invulnerability while dashing',
];

test('the page reads a request exactly the way the server will check it', () => {
  for (const prompt of PROMPTS) assert.deepEqual(readRequest(prompt, parent), requestedParallaxiaIntent(prompt, parent), prompt);
  const longer = { ...parent, unitScale: 0.2 };
  assert.equal(readRequest('Twice as far', longer), requestedParallaxiaIntent('Twice as far', longer));
});

test('requests this version can\'t do are caught before they cost anything', () => {
  for (const prompt of ['triple the distance', 'make it longer', 'turn it into a teleport']) assert.equal(readRequest(prompt, parent), null, prompt);
  assert.deepEqual(readRequest('backward and half as far', parent), { unitScale: 0.05, activation: 'held', direction: 'opposite' });
});
