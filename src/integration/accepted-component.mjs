import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compileMotion, digest } from '../component/build.mjs';

/** Only this investigation's frozen, accepted publication can enter its integration. */
export async function loadAcceptedComponent(directory, report) {
  const session = report.session, recovery = session?.recovery;
  const entry = recovery?.attempts.find(item => item.attempt === recovery.acceptedAttempt);
  assert.equal(report.status, 'completed', 'An incomplete investigation cannot enter a recipient');
  assert.ok(entry?.development?.passed && entry?.acceptance?.passed, 'Separate component acceptance is required');
  assert.equal(recovery.frozenCandidateId, entry.candidateId, 'Accepted candidate must match the frozen identity');
  assert.match(session.id, /^[a-f0-9-]{36}$/);
  assert.match(entry.candidateId, /^[a-f0-9]{64}$/);
  assert.equal(digest(JSON.stringify({ candidate: entry.candidate, timerFields: entry.timerFields })), entry.candidateId);
  const root = join(directory, 'sessions', session.id, 'components', entry.candidateId);
  const { id, ...publication } = JSON.parse(await readFile(join(root, 'publication.json'), 'utf8'));
  assert.equal(digest(JSON.stringify(publication)), id, 'Component publication identity mismatch');
  assert.equal(publication.candidateId, entry.candidateId);
  const names = Object.keys(publication.files);
  assert.ok(names.every(name => /^[a-z][a-z0-9.-]+$/.test(name)), 'Invalid component file path');
  assert.deepEqual((await readdir(root)).sort(), [...names, 'publication.json'].sort());
  const files = {};
  for (const name of names) {
    files[name] = await readFile(join(root, name), 'utf8');
    assert.equal(digest(files[name]), publication.files[name], 'Component integrity mismatch: ' + name);
  }
  const source = files['component.ts'], javascript = files['component.js'];
  const contract = JSON.parse(files['contract.json']), provenance = JSON.parse(files['provenance.json']);
  const compiled = await compileMotion(source);
  assert.equal(source, entry.candidate.source);
  assert.equal(javascript, compiled.javascript);
  assert.equal(provenance.sourceSha256, compiled.sourceSha256);
  assert.equal(provenance.javascriptSha256, compiled.javascriptSha256);
  assert.equal(provenance.id, publication.componentId);
  assert.equal(digest(JSON.stringify({ source: compiled.sourceSha256, javascript: compiled.javascriptSha256, contract })), provenance.id);
  assert.equal(provenance.cartridgeSha256, session.identity.cartridgeSha256);
  assert.equal(provenance.cartridgeSha256, report.target.sha256);
  for (const suite of ['development', 'acceptance']) {
    const evaluation = JSON.parse(files[`evaluation-${suite}.json`]);
    assert.equal(evaluation.passed, true);
    assert.equal(evaluation.sourceSha256, compiled.sourceSha256);
    assert.equal(evaluation.javascriptSha256, compiled.javascriptSha256);
    assert.deepEqual(evaluation.results, entry[suite].results);
  }
  return { source, javascript, contract, provenance, files, timerFields: entry.timerFields,
    candidateId: entry.candidateId, sessionId: session.id, frozenCandidateId: recovery.frozenCandidateId,
    publication: { id, ...publication } };
}
