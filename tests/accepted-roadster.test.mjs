import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateRoadsterTransfer } from '../agent/transfer-roadster.mjs';
import { buildRoadsterChallenge } from '../roadster/challenge.mjs';
import {
  ACCEPTED_ROADSTER_MAX_USD, ACCEPTED_ROADSTER_PROMPT, acceptedRoadsterExecution, readAcceptedRoadster,
  roadsterGenerator, selectAcceptedRoadsterTrial, transferAcceptedRoadster,
} from '../campaign/accepted-roadster.mjs';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { readRecoveryCampaign, runRecoveryCampaign } from '../campaign/recovery-runner.mjs';
import { digest } from '../component/build.mjs';
import { componentIdentity, resolveComponentRef } from '../component/reference.mjs';
import { loadAcceptedComponent } from '../integration/accepted-component.mjs';
import { readRoadsterArtifact } from '../roadster/artifact.mjs';
import { ROADSTER_INTENT } from '../roadster/port.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';
import { main } from '../scripts/transfer-accepted-roadster.mjs';
import { acceptedRecoveryFixture } from './helpers/recovery-fixture.mjs';
import { roadsterAdapterFixture } from './helpers/roadster-adapter.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const WONDER_JOURNAL = join(repo, 'reports/motion-transfer-phase/wonder-development-001/journal.json');
const SESSION = 'fa8e3d4a-8578-4098-8042-f29e607c9267';
const TRIAL = '0f594188-18ed-4e7a-9aaf-6e2843823e9a';

let fixtureDir;
let fixtureRoot;

before(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'accepted-roadster-fixture-'));
  fixtureDir = join(fixtureRoot, 'campaign');
  await runRecoveryCampaign({
    directory: fixtureDir, phaseBudget: await createPhaseBudget(join(fixtureRoot, 'recovery-phase')), development: true,
    investigateRun: async () => acceptedRecoveryFixture(fixtureDir),
  });
});
after(async () => { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }); });

function acceptedTrial(origin) {
  const candidateId = 'a'.repeat(64);
  const report = {
    status: 'completed', origin, session: {
      id: SESSION, recovery: {
        acceptedAttempt: 1, frozenCandidateId: candidateId,
        attempts: [{ attempt: 1, candidateId }],
      },
    },
  };
  return { id: TRIAL, report, reportRef: { path: `reports/${'b'.repeat(64)}.json`, sha256: 'c'.repeat(64) } };
}

test('fixture reports stay off the paid path and the hook cannot widen a real report', () => {
  const fixture = { trials: [acceptedTrial('local-verification')] };
  const real = { trials: [acceptedTrial(undefined)] };
  assert.throws(() => selectAcceptedRoadsterTrial(fixture), /Local fixtures are not accepted recovery deliveries/);
  assert.throws(() => selectAcceptedRoadsterTrial(real, { allowLocalFixture: true }), /only admits an explicit local-verification report/);
  assert.equal(selectAcceptedRoadsterTrial(fixture, { allowLocalFixture: true }).id, TRIAL);
  assert.equal(selectAcceptedRoadsterTrial(real).report.session.recovery.frozenCandidateId, 'a'.repeat(64));
  const missing = acceptedTrial(undefined);
  missing.report.session.recovery.frozenCandidateId = 'd'.repeat(64);
  assert.throws(() => selectAcceptedRoadsterTrial({ trials: [missing] }), /frozen identity/);
  assert.throws(() => selectAcceptedRoadsterTrial({ trials: [] }), /No completed trial/);
});

test('injected hooks cannot be recorded as a live delivery and CLI defaults can', () => {
  const live = acceptedRoadsterExecution({ generateTransfer: generateRoadsterTransfer, buildChallenge: buildRoadsterChallenge });
  assert.equal(live.outcome, 'delivered');
  assert.equal(live.liveMeta, true);
  assert.equal(live.injected, false);
  const hooks = [
    { client: { countInputTokens: async () => 0 } },
    { verifyBrowser: async () => ({ passed: true }) },
    { generateTransfer: async () => ({}) },
    { buildChallenge: async () => ({}) },
    { fixture: true },
    { allowLocalFixture: true },
  ];
  for (const hook of hooks) {
    const execution = acceptedRoadsterExecution(hook);
    assert.notEqual(execution.outcome, 'delivered', JSON.stringify(hook));
    assert.equal(execution.liveMeta, false);
    assert.equal(execution.injected, true);
  }
  assert.equal(acceptedRoadsterExecution({ fixture: true, client: {} }).outcome, 'local-fixture');
});

test('the command requires an existing ledger and does not open credentials while it is missing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'accepted-roadster-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await main(['--help']);
  await assert.rejects(() => main([]), /--campaign, --out, and --phase-ledger are required/);
  await assert.rejects(() => main([
    '--campaign', join(root, 'campaign'), '--out', join(root, 'out'), '--phase-ledger', join(root, 'missing-ledger'),
    '--env-file', join(root, 'secret.env'),
  ]), error => error.code === 'ENOENT');
  await assert.rejects(() => stat(join(root, 'missing-ledger')), error => error.code === 'ENOENT');
  await assert.rejects(() => stat(join(root, 'secret.env')), error => error.code === 'ENOENT');
  const source = await readFile(new URL('../scripts/transfer-accepted-roadster.mjs', import.meta.url), 'utf8');
  assert.match(source, /--env-file/);
  assert.equal(source.includes('allowLocalFixture'), false);
  assert.equal(source.includes('verifyBrowser'), false);
  assert.equal(source.includes('generateTransfer'), false);
  assert.equal(source.includes('buildChallenge'), false);
  const implementation = await readFile(new URL('../campaign/accepted-roadster.mjs', import.meta.url), 'utf8');
  assert.equal(implementation.includes('loadSavedRoadster'), false);
  assert.equal(implementation.includes('loadEnvFile'), false);
  assert.equal(implementation.includes('reconcileBoundedUnknown'), false);
  assert.equal(roadsterGenerator, generateRoadsterTransfer);
});

async function tempLedger(t) {
  const root = await mkdtemp(join(tmpdir(), 'accepted-roadster-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const phaseBudget = await createPhaseBudget(join(root, 'phase'));
  await phaseBudget.reserve({ id: 'video:keep', category: 'video', maxCostUsd: 0.4, metadata: { keep: true } });
  await phaseBudget.settle({ id: 'video:keep', estimatedCostUsd: 0.2, uncertain: false });
  const events = [];
  const reserve = phaseBudget.reserve.bind(phaseBudget);
  phaseBudget.reserve = async entry => {
    events.push(['reserve', entry.category, entry.maxCostUsd, entry.metadata?.componentId ?? null]);
    return reserve(entry);
  };
  return { root, out: join(root, 'out'), phaseBudget, events };
}

test('an unsettled local fixture stays on a temporary ledger and is not sent again', async t => {
  const { root, out, phaseBudget, events } = await tempLedger(t);
  await assert.rejects(() => transferAcceptedRoadster({
    campaignDirectory: fixtureDir, outDirectory: join(root, 'rejected'), phaseBudget,
    generateTransfer: async () => { throw Error('must not generate a fixture on the paid path'); },
  }), /Local fixtures are not accepted recovery deliveries/);
  assert.equal(events.length, 0);
  let calls = 0;
  const generateTransfer = async arguments_ => {
    calls += 1;
    events.push('generate');
    assert.equal(arguments_.maxCostUsd, ACCEPTED_ROADSTER_MAX_USD);
    assert.equal(arguments_.prompt, ACCEPTED_ROADSTER_PROMPT);
    assert.equal(arguments_.parent.id, null);
    assert.deepEqual(arguments_.parent.files, {});
    assert.equal(arguments_.parent.intent, ROADSTER_INTENT);
    assert.match(arguments_.parent.componentId, /^[a-f0-9]{64}$/);
    assert.equal(arguments_.componentRef.provenance.id, arguments_.parent.componentId);
    const persist = arguments_.onUpdate;
    arguments_.onUpdate = async report => {
      await persist(report);
      if (report.status === 'generating') {
        const stored = JSON.parse(await readFile(join(out, 'journal.json'), 'utf8'));
        assert.equal(stored.job.status, 'running');
        assert.equal(stored.job.report.reservedCostUsd > 0, true);
      }
    };
    return generateRoadsterTransfer({ ...arguments_, client: {
      countInputTokens: async () => 1000,
      respond: async () => { throw Error('socket closed before a body'); },
    } });
  };
  const first = await transferAcceptedRoadster({
    campaignDirectory: fixtureDir, outDirectory: out, phaseBudget, allowLocalFixture: true, client: { injected: true }, generateTransfer,
  });
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event === 'generate' ? event : event[0]), ['reserve', 'generate']);
  assert.equal(events[0][1], 'remix');
  assert.equal(events[0][2], 0.05);
  assert.equal(events[0][3], first.definition.input.componentId);
  assert.equal(first.status, 'blocked');
  assert.equal(first.job.outcome, 'failed');
  assert.notEqual(first.job.outcome, 'delivered');
  assert.equal(first.job.injected, true);
  assert.equal(first.job.report.requests[0].status, 'unsettled');
  assert.match(first.job.report.error, /socket closed/);
  assert.match(first.job.error, /socket closed/);
  assert.equal(first.definition.input.fixture, true);
  assert.match(first.definition.input.report.sha256, /^[a-f0-9]{64}$/);
  assert.match(first.definition.input.componentId, /^[a-f0-9]{64}$/);
  assert.equal(first.definition.input.parentArtifactId, null);
  assert.equal(digest(await readFile(join(fixtureDir, first.definition.input.report.path))), first.definition.input.report.sha256);
  const status = await phaseBudget.status();
  assert.equal(status.uncertain, true);
  assert.equal(status.categories.video.settledUsd, 0.2);
  assert.equal(status.categories.remix.reservedUsd, 0.05);
  const kept = (await phaseBudget.journal()).reservations.find(entry => entry.id === 'video:keep');
  assert.equal(kept.status, 'settled');
  assert.equal(kept.estimatedCostUsd, 0.2);
  await transferAcceptedRoadster({
    campaignDirectory: fixtureDir, outDirectory: out, phaseBudget, allowLocalFixture: true, client: { injected: true },
    generateTransfer: async () => { calls += 1; throw Error('retried'); },
  });
  assert.equal(calls, 1);
  const { integritySha256: ignored, ...journal } = JSON.parse(await readFile(join(out, 'journal.json'), 'utf8'));
  journal.status = 'running';
  journal.job.status = 'running';
  await writeFile(join(out, 'journal.json'), JSON.stringify({ ...journal, integritySha256: digest(JSON.stringify(journal)) }, null, 2) + '\n');
  const resumed = await transferAcceptedRoadster({
    campaignDirectory: fixtureDir, outDirectory: out, phaseBudget, allowLocalFixture: true, client: { injected: true },
    generateTransfer: async () => { calls += 1; throw Error('retried after restart'); },
  });
  assert.equal(calls, 1);
  assert.equal(resumed.job.status, 'interrupted');
  assert.equal(resumed.job.report.requests[0].status, 'unsettled');
  assert.equal((await phaseBudget.status()).uncertain, true);
  await assert.rejects(phaseBudget.reserve({ id: 'remix:after-unknown', category: 'remix', maxCostUsd: 0.05 }), /uncertain/);
  void ignored;
});

test('an injected fixture client publishes the local component and does not repeat the job', { timeout: 180000 }, async t => {
  const { out, phaseBudget, events } = await tempLedger(t);
  const saved = await loadSavedRoadster();
  let calls = 0;
  let componentId;
  const source = roadsterAdapterFixture();
  const client = {
    countInputTokens: async () => 1000,
    respond: async () => ({
      id: 'injected-client', status: 'completed', usage: { input_tokens: 1000, output_tokens: 200 },
      output: [{ type: 'function_call', name: 'submit_roadster_adapter', arguments: JSON.stringify({
        status: 'supported', source, intent: ROADSTER_INTENT, summary: 'Injected local client. Not a Meta delivery.',
      }) }],
    }),
  };
  const generateTransfer = async arguments_ => {
    calls += 1;
    events.push('generate');
    componentId = arguments_.parent.componentId;
    assert.deepEqual(arguments_.parent.files, {});
    assert.equal(arguments_.parent.id, null);
    return generateRoadsterTransfer(arguments_);
  };
  const verifyBrowser = async (_source, _intent, options) => {
    assert.equal(options.componentRef.provenance.id, componentId);
    assert.equal(options.componentRef.candidateId, options.componentRef.frozenCandidateId);
    return { passed: true, componentId, fixture: true };
  };
  const campaign = await transferAcceptedRoadster({
    campaignDirectory: fixtureDir, outDirectory: out, phaseBudget, allowLocalFixture: true, client, generateTransfer, verifyBrowser,
  });
  assert.equal(componentId, campaign.definition.input.componentId);
  assert.notEqual(componentId, saved.componentId);
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event === 'generate' ? event : event[0]), ['reserve', 'generate']);
  assert.equal(campaign.status, 'complete');
  assert.equal(campaign.job.outcome, 'local-fixture');
  assert.notEqual(campaign.job.outcome, 'delivered');
  assert.equal(campaign.summary.injected, true);
  assert.equal(campaign.definition.input.fixture, true);
  assert.equal(campaign.job.ordinaryOutsideTarget, true);
  assert.equal(campaign.job.borrowedInsideTarget, true);
  const artifact = await readRoadsterArtifact(join(out, 'published', 'artifacts'), campaign.job.artifactId);
  assert.equal(artifact.componentId, componentId);
  assert.equal(artifact.parentArtifactId, null);
  assert.equal(artifact.files['adapter.ts'], source);
  assert.equal(artifact.files['frame.html'].includes(componentId), true);
  assert.equal(artifact.files['frame.html'].includes(saved.componentId), false);
  const challengeManifest = JSON.parse(await readFile(join(out, 'challenge', 'manifest.json'), 'utf8'));
  const challengeReport = JSON.parse(await readFile(join(out, 'challenge', 'challenge.json'), 'utf8'));
  assert.equal(challengeManifest.componentId, componentId);
  assert.equal(challengeManifest.componentRef.candidateId, campaign.definition.input.candidateId);
  assert.equal(challengeManifest.componentRef.sessionId, campaign.definition.input.sessionId);
  assert.equal(challengeManifest.parentArtifactId, artifact.id);
  assert.equal(challengeReport.ordinaryOutsideTarget, true);
  assert.equal(challengeReport.borrowedInsideTarget, true);
  assert.equal(challengeReport.componentId, componentId);
  const delivery = JSON.parse(await readFile(join(out, 'delivery.json'), 'utf8'));
  const { sha256, ...body } = delivery;
  assert.equal(digest(JSON.stringify(body)), sha256);
  assert.equal(delivery.status, 'local-fixture');
  assert.equal(delivery.liveMeta, false);
  assert.equal(delivery.injected, true);
  assert.equal(delivery.fixture, true);
  assert.equal(delivery.componentId, componentId);
  assert.equal(delivery.candidateId, campaign.definition.input.candidateId);
  assert.equal(delivery.sessionId, campaign.definition.input.sessionId);
  assert.equal(delivery.protocolId, campaign.definition.input.protocolId);
  assert.equal(delivery.report.sha256, campaign.definition.input.report.sha256);
  assert.equal(delivery.artifactId, artifact.id);
  assert.equal(delivery.challengeId, challengeManifest.id);
  assert.equal(delivery.parentArtifactId, null);
  const phase = await phaseBudget.status();
  assert.equal(phase.uncertain, false);
  assert.equal(phase.categories.video.settledUsd, 0.2);
  assert.ok(Math.abs(phase.categories.remix.settledUsd - 0.0021) < 1e-9);
  const again = await transferAcceptedRoadster({
    campaignDirectory: fixtureDir, outDirectory: out, phaseBudget, allowLocalFixture: true, client,
    generateTransfer: async () => { calls += 1; throw Error('retried'); },
  });
  assert.equal(calls, 1);
  assert.equal(again.definition.sha256, campaign.definition.sha256);
  assert.equal(again.job.outcome, 'local-fixture');
  assert.equal(await readAcceptedRoadster(out).then(value => value.job.artifactId), artifact.id);
});

test('the pinned accepted Roadster delivery agrees on ids, source, frame, and receipt', async () => {
  const id = '216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c';
  const challengeId = '6aa98fb93cd2e921fbf15966c4fcc0517f947e436994b0e12dc816977ce7ed64';
  const componentId = '544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858';
  const pin = join(repo, 'transfers/roadster/accepted', id);
  const campaign = await readAcceptedRoadster(pin);
  const artifact = await readRoadsterArtifact(join(pin, 'published/artifacts'), id);
  const component = await resolveComponentRef(artifact.component);
  const identity = componentIdentity(component);
  const delivery = JSON.parse(await readFile(join(pin, 'delivery.json'), 'utf8'));
  const { sha256, ...deliveryBody } = delivery;
  const play = await readFile(join(pin, 'challenge/play.html'), 'utf8');
  const source = await readFile(join(pin, 'challenge/adapter.ts'), 'utf8');
  const notices = await readFile(join(pin, 'challenge/notices.txt'), 'utf8');
  const evidence = JSON.parse(await readFile(join(pin, 'challenge/challenge.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(pin, 'challenge/manifest.json'), 'utf8'));
  const { id: manifestId, ...manifestBody } = manifest;
  assert.equal(digest(JSON.stringify(deliveryBody)), sha256);
  assert.equal(delivery.status, 'delivered');
  assert.equal(delivery.liveMeta, true);
  assert.equal(delivery.fixture, false);
  assert.equal(delivery.injected, false);
  assert.equal(campaign.status, 'complete');
  assert.equal(campaign.job.outcome, 'delivered');
  assert.equal(campaign.job.estimatedCostUsd, 0.008666);
  assert.equal(campaign.summary.estimatedCostUsd, 0.008666);
  assert.equal(artifact.id, id);
  assert.equal(artifact.parentArtifactId, null);
  assert.equal(artifact.componentId, componentId);
  assert.equal(component.provenance.id, componentId);
  assert.equal(identity.kind, 'accepted');
  assert.equal(identity.candidateId, delivery.candidateId);
  assert.equal(identity.sessionId, delivery.sessionId);
  assert.equal(source, artifact.files['adapter.ts']);
  assert.equal(notices, artifact.files['notices.txt']);
  assert.match(notices, /Copyright \(c\) samX500 and willGuimont/);
  assert.match(notices, /Copyright \(c\) 2026 sebayaki\.eth/);
  assert.equal(digest(play), evidence.frameSha256);
  assert.equal(digest(source), evidence.sourceSha256);
  assert.equal(digest(JSON.stringify(manifestBody)), manifestId);
  assert.equal(manifestId, challengeId);
  assert.equal(evidence.componentId, componentId);
  assert.equal(evidence.ordinaryOutsideTarget, true);
  assert.equal(evidence.borrowedInsideTarget, true);
  assert.equal(JSON.parse(artifact.files['generation.json']).estimatedCostUsd, 0.008666);
  const verification = JSON.parse(artifact.files['verification.json']);
  assert.equal(verification.conformance.passed, true);
  assert.equal(verification.conformance.results.length, 8);
  assert.equal(verification.browser.passed, true);
  assert.equal(verification.browser.results.length, 8);
  assert.equal(verification.browser.componentId, componentId);
});

test('restored Wonder evidence names the accepted component when the campaign is present', {
  skip: existsSync(WONDER_JOURNAL) ? false : 'restored Wonder campaign is absent from this checkout',
}, async () => {
  const directory = join(repo, 'reports/motion-transfer-phase/wonder-development-001');
  const campaign = await readRecoveryCampaign(directory);
  const trial = selectAcceptedRoadsterTrial(campaign);
  assert.notEqual(trial.report.origin, 'local-verification');
  const component = await loadAcceptedComponent(directory, trial.report);
  assert.equal(component.provenance.id, '544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858');
  assert.equal(component.candidateId, 'accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f');
  assert.equal(trial.report.session.id, 'fa8e3d4a-8578-4098-8042-f29e607c9267');
});
