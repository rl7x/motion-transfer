import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildExhaustiveEvidence } from '../src/evaluator/exhaustive-evidence.mjs';

const evidenceFile = new URL('../assets/evidence/exhaustive.json', import.meta.url);

export async function verifyExhaustiveEvidence({ onCandidate } = {}) {
  const expected = JSON.parse(await readFile(evidenceFile, 'utf8'));
  const actual = await buildExhaustiveEvidence({ onCandidate });
  assert.deepEqual(actual, expected, 'Exhaustive evidence must recompute from the committed binary and candidates');
  return `Exhaustive: ${actual.donor.states} states, ${actual.donor.transitions} transitions, ${actual.donor.conflicts} abstraction conflicts; `
    + `${actual.candidates.filter(candidate => candidate.verdict === 'proved').length} proved, `
    + `${actual.candidates.filter(candidate => candidate.verdict === 'counterexample').length} counterexamples, `
    + `${actual.candidates.filter(candidate => candidate.verdict === 'inconclusive').length} inconclusive. No model request was made.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onCandidate = candidate => console.log(`${candidate.id}: ${candidate.verdict}`
    + (candidate.counterexample ? ` (${candidate.counterexample.length} ticks)` : '')
    + (candidate.reason ? ` (${candidate.reason})` : ''));
  if (process.argv.slice(2).some(flag => flag !== '--write')) throw Error('Usage: node scripts/verify-exhaustive.mjs [--write]');
  if (process.argv.includes('--write')) {
    const evidence = await buildExhaustiveEvidence({ onCandidate });
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log('Created exhaustive evidence. Existing evidence is never overwritten.');
  } else {
    console.log(await verifyExhaustiveEvidence({ onCandidate }));
  }
}
