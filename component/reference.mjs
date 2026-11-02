import assert from 'node:assert/strict';
import { compileMotion, digest } from './build.mjs';
import { loadRecoveredMotion } from './load.mjs';

/** Resolve a loaded, verified package. A supplied candidate never falls back to the saved dash. */
export async function resolveComponentRef(componentRef) {
  const component = componentRef ?? await loadRecoveredMotion();
  const { source, javascript, contract, provenance } = component;
  assert.ok(typeof source === 'string' && typeof javascript === 'string' && contract && provenance,
    'A component reference must contain its exact verified package');
  const compiled = await compileMotion(source);
  assert.equal(javascript, compiled.javascript, 'Component JavaScript differs from its source');
  assert.equal(provenance.sourceSha256, compiled.sourceSha256, 'Component source identity mismatch');
  assert.equal(provenance.javascriptSha256, compiled.javascriptSha256, 'Component JavaScript identity mismatch');
  assert.equal(provenance.id, digest(JSON.stringify({ source: compiled.sourceSha256,
    javascript: compiled.javascriptSha256, contract })), 'Component identity mismatch');
  if (componentRef && !component.candidateId) {
    assert.equal(provenance.id, (await loadRecoveredMotion()).provenance.id,
      'An unfamiliar component requires a separately accepted publication');
  }
  if (component.candidateId) {
    assert.match(component.candidateId, /^[a-f0-9]{64}$/, 'Invalid candidate identity');
    assert.match(component.sessionId, /^[a-f0-9-]{36}$/, 'Accepted component needs its session identity');
    assert.ok(component.publication, 'Accepted component needs its publication receipt');
    const { id: publicationId, ...publication } = component.publication;
    assert.equal(digest(JSON.stringify(publication)), publicationId, 'Component publication identity mismatch');
    assert.equal(publication.componentId, provenance.id, 'Publication component identity mismatch');
    assert.equal(publication.candidateId, component.candidateId, 'Publication candidate identity mismatch');
    assert.deepEqual(Object.keys(component.files ?? {}).sort(), Object.keys(publication.files).sort(),
      'Component publication file set differs');
    for (const [name, expected] of Object.entries(publication.files)) {
      assert.equal(digest(component.files[name]), expected, 'Component publication file differs: ' + name);
    }
    const history = JSON.parse(component.files['recovery-history.json']);
    const accepted = history.attempts?.find(attempt => attempt.attempt === history.acceptedAttempt);
    assert.equal(history.status, 'accepted', 'Separate component acceptance is required');
    assert.equal(history.investigationSessionId, component.sessionId, 'Accepted session identity mismatch');
    assert.equal(component.frozenCandidateId, component.candidateId, 'Accepted candidate differs from the frozen identity');
    assert.equal(accepted?.candidateId, component.candidateId, 'Accepted history candidate identity mismatch');
    assert.equal(digest(JSON.stringify({ candidate: accepted.candidate, timerFields: accepted.timerFields })),
      component.candidateId, 'Accepted candidate identity mismatch');
    assert.equal(accepted.candidate.source, source, 'Accepted candidate source differs');
    assert.deepEqual(component.timerFields, accepted.timerFields, 'Accepted timer mapping differs');
    assert.ok(accepted.development?.passed && accepted.acceptance?.passed, 'Separate component acceptance is required');
    for (const suite of ['development', 'acceptance']) {
      const evaluation = JSON.parse(component.files?.[`evaluation-${suite}.json`] ?? 'null');
      assert.equal(evaluation?.passed, true, 'Separate component acceptance is required');
      assert.equal(evaluation.sourceSha256, compiled.sourceSha256, 'Accepted source identity mismatch');
      assert.equal(evaluation.javascriptSha256, compiled.javascriptSha256, 'Accepted JavaScript identity mismatch');
    }
    assert.equal(component.files['component.ts'], source, 'Accepted publication source differs');
    assert.equal(component.files['component.js'], javascript, 'Accepted publication JavaScript differs');
    assert.deepEqual(JSON.parse(component.files['contract.json']), contract, 'Accepted contract differs');
    assert.deepEqual(JSON.parse(component.files['provenance.json']), provenance, 'Accepted provenance differs');
  }
  return component;
}

export function componentIdentity(component) {
  return { id: component.provenance.id, kind: component.candidateId ? 'accepted' : 'saved',
    ...(component.candidateId ? { candidateId: component.candidateId, sessionId: component.sessionId,
      publicationId: component.publication.id } : {}) };
}
