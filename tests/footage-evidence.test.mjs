import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { acceptanceCases } from '../src/evaluator/cases.mjs';
import { evaluateMotion } from '../src/evaluator/motion.mjs';
import { repositoryUrl } from '../src/paths.mjs';

const { earlier: [, second], repeats } = JSON.parse(await readFile(repositoryUrl('assets/evidence/footage-recovery.json'), 'utf8'));

async function score({ source, config, seed, total }) {
  const cases = acceptanceCases(seed, total);
  let passed = 0;
  for (let offset = 0; offset < cases.length; offset += 20) {
    const { results } = await evaluateMotion(source, config, cases.slice(offset, offset + 20), { suite: 'fidelity-comparison' });
    passed += results.filter(result => result.passed).length;
  }
  return passed;
}

test('the second calibration scores what the record says', async () => {
  assert.equal(await score({ ...second.controller, ...second.exam }), second.exam.fromFootage);
});

test('every repeat session scores what the record says', async () => {
  for (const run of repeats) for (const session of run.sessions) {
    if (!session.exam) { assert.ok(session.failure, `${run.name} session ${session.session} needs a reason`); continue; }
    assert.equal(await score({ source: session.source, config: session.config, ...session.exam }), session.exam.passed, `${run.name} session ${session.session}`);
  }
});
