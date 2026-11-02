import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acceptedRecoveryFixture } from './helpers/recovery-fixture.mjs';
import { loadAcceptedComponent } from '../integration/accepted-component.mjs';
import { finishRecoveryIntegration, assertJujumpCompatibility } from '../integration/recovery.mjs';
import { createIntegrationPublication } from '../integration/publication.mjs';
import { recoveryTask } from '../lab/recovery-task.mjs';

test('a newly frozen candidate passes recipient and final ZIP checks without using the saved component identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'new-recovery-integration-'));
  const publications = createIntegrationPublication(directory);
  try {
    const report = await acceptedRecoveryFixture(directory), stages = [];
    const component = await loadAcceptedComponent(directory, report);
    const saved = JSON.parse(await readFile(new URL('../components/dashy-dango-dash/provenance.json', import.meta.url)));
    assert.notEqual(component.provenance.id, saved.id);
    assert.throws(() => assertJujumpCompatibility({ ...component, timerFields: { cooldown: 'other', remaining: 'remaining' } }), /canonical timer/);
    const result = await finishRecoveryIntegration({ directory, report, onStage: async stage => stages.push(stage) });
    assert.deepEqual(stages, ['integrating', 'checking-export']);
    assert.equal(result.project.manifest.componentId, component.provenance.id);
    assert.equal(result.project.files['component/component.ts'], component.source);
    assert.equal(result.verification.nodeChecks.count, 3); assert.equal(result.verification.browser.results.length, 7);
    assert.match(result.project.files['index.html'], /newly accepted candidate/);
    const publication = await publications.publish(result), loaded = await publications.read(publication.id);
    assert.deepEqual(loaded.project.zip, result.project.zip);
    const afterInterruption = createIntegrationPublication(join(directory, 'fresh-journal'), { savedDirectory: join(directory, 'integrations') });
    assert.equal((await afterInterruption.read(publication.id)).receipt.packageId, result.project.manifest.id);
    await afterInterruption.close();
    const preview = await publications.preview(publication.id);
    assert.ok(preview.startsWith('http://127.0.0.1:'));
    assert.equal((await fetch(preview + '/api/investigations', { method: 'POST' })).status, 404);
    assert.equal((await fetch(preview + '/.env')).status, 404);
    const job = { status: 'ready', report, integration: publication, events: [] };
    assert.equal(recoveryTask(job).origin, 'local-verification');
    assert.equal(recoveryTask(job).measurements.modelRequests, 0);
    assert.equal(recoveryTask(job).measurements.manualTimeSavedMinutes, null);
    const invalid = structuredClone(result); invalid.verification.nodeChecks.passed = false;
    await assert.rejects(publications.publish(invalid), /true/);
    const root = join(directory, 'integrations', publication.id);
    const corrupted = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'));
    corrupted.files['component/component.js'] += '\n// edited';
    await writeFile(join(root, 'project.json'), JSON.stringify(corrupted));
    await assert.rejects(publications.read(publication.id));
  } finally { await publications.close(); await rm(directory, { recursive: true, force: true }); }
});

test('incomplete, unfrozen, mismatched or tampered recoveries cannot be substituted with the old success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'invalid-recovery-integration-'));
  try {
    const report = await acceptedRecoveryFixture(directory);
    await assert.rejects(loadAcceptedComponent(directory, { ...report, status: 'failed' }), /incomplete investigation/);
    const unfrozen = structuredClone(report); unfrozen.session.recovery.frozenCandidateId = 'a'.repeat(64);
    await assert.rejects(loadAcceptedComponent(directory, unfrozen), /frozen identity/);
    const rejected = structuredClone(report); delete rejected.session.recovery.acceptedAttempt;
    await assert.rejects(loadAcceptedComponent(directory, rejected), /Separate component acceptance/);
    const component = await loadAcceptedComponent(directory, report);
    const root = join(directory, 'sessions', report.session.id, 'components', component.candidateId);
    await writeFile(join(root, 'component.ts'), component.source + '\n// edited');
    await assert.rejects(loadAcceptedComponent(directory, report), /integrity mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
