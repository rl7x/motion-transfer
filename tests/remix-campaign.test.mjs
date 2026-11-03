import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateRoadsterTransfer } from '../src/agent/transfer-roadster.mjs';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { REMIX_PROMPTS, canonicalIntent, roadsterGenerator, runRemixCampaign } from '../src/campaign/remix-campaign.mjs';
import { readRoadsterArtifact } from '../src/roadster/artifact.mjs';
import { main } from '../scripts/remix-campaign.mjs';

function savedParent() {
  return {
    id: 'a'.repeat(64), componentId: 'b'.repeat(64),
    intent: { activation: 'held', direction: 'facing', unitScale: 0.1 },
    files: { 'adapter.ts': 'export function init(){return {core:1};}\n' },
  };
}
const report = (estimatedCostUsd = 0.01) => ({ estimatedCostUsd, reservedCostUsd: 0, requests: [{ status: 'completed', estimatedCostUsd }] });

function transfer(calls, mutate = () => null) {
  return async arguments_ => {
    calls.push(arguments_);
    const { parent, prompt, maxCostUsd, verifyBrowser } = arguments_;
    assert.equal(maxCostUsd, 0.05);
    assert.equal(verifyBrowser, undefined);
    const spec = REMIX_PROMPTS.find(item => item.prompt === prompt);
    const override = mutate(spec, parent);
    if (override) return override;
    if (spec.kind !== 'supported') {
      const error = Error(spec.kind === 'noop' ? 'The proposed mapping does not change the parent' : 'Unsupported request: flight is outside the adapter contract');
      if (spec.kind === 'unsupported') error.code = 'UNSUPPORTED_REQUEST';
      error.report = { ...report(0.008), submission: spec.kind === 'unsupported'
        ? { status: 'unsupported', source: '', intent: parent.intent, summary: 'A per-flight allowance is not a distance, direction, or activation edit.' }
        : { status: 'supported', source: 'unchanged', intent: parent.intent, summary: 'No mapping changed.' } };
      throw error;
    }
    const source = `export const id = ${JSON.stringify(spec.id)};\n`;
    return {
      files: {
        'adapter.ts': source, 'adapter.js': 'export {}\n', 'frame.html': '<!doctype html>\n',
        'generation.json': JSON.stringify(report()), 'notices.txt': 'notice\n', 'verification.json': JSON.stringify({ passed: true }),
      },
      metadata: { parentArtifactId: parent.id, intent: spec.expectedIntent, componentId: parent.componentId, summary: spec.id,
        component: { source: `marker ${spec.id}`, javascript: 'marker', provenance: { id: parent.componentId }, contract: { defaults: { walkingSpeed: 2 } } } },
    };
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'remix-campaign-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const phaseBudget = await createPhaseBudget(join(root, 'phase'));
  const events = [];
  const reserve = phaseBudget.reserve.bind(phaseBudget);
  phaseBudget.reserve = async entry => {
    events.push(['reserve', entry.category, entry.maxCostUsd, entry.metadata?.promptId ?? null]);
    return reserve(entry);
  };
  return { root, phaseBudget, events, directory: join(root, 'campaign') };
}

test('the frozen set checks full intents and follow-up lineage, not only a completed response', async t => {
  const { directory, phaseBudget, events } = await fixture(t);
  const calls = [];
  const generateTransfer = transfer(calls);
  const campaign = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer: async arguments_ => { events.push('generate'); return generateTransfer(arguments_); } });
  assert.deepEqual(events.filter(event => event === 'generate' || event[0] === 'reserve').map(event => event === 'generate' ? 'generate' : event[0]),
    Array.from({ length: 8 }, () => ['reserve', 'generate']).flat());
  assert.equal(campaign.summary.matched, 6);
  assert.equal(campaign.summary.expectedNegatives, 2);
  for (const spec of REMIX_PROMPTS.filter(item => item.kind === 'supported')) {
    const attempt = campaign.attempts.find(item => item.id === spec.id);
    assert.equal(attempt.outcome, 'matched');
    assert.deepEqual(attempt.resultIntent, spec.expectedIntent);
    assert.deepEqual(Object.keys(attempt.resultIntent).sort(), ['activation', 'direction', 'unitScale']);
    assert.equal(attempt.input.prompt, spec.prompt);
    assert.equal(attempt.input.maxCostUsd, 0.05);
    assert.ok(attempt.durationMs >= 0);
  }
  const previous = campaign.attempts.find(item => item.id === 'backward-fresh-press');
  const follow = calls.find(call => call.prompt.startsWith('Change only the distance'));
  assert.equal(previous.child.published, true);
  assert.equal(previous.child.adapterSource, undefined);
  assert.equal(follow.parent.id, previous.child.id);
  assert.equal(follow.parent.id.length, 64);
  assert.deepEqual(follow.parent.intent, { activation: 'press', direction: 'opposite', unitScale: 0.1 });
  assert.match(follow.parent.files['adapter.ts'], /backward-fresh-press/);
  assert.match(follow.parent.files['frame.html'], /</);
  assert.match(follow.parent.files['notices.txt'], /notice/);
  assert.equal(JSON.parse(follow.parent.files['verification.json']).passed, true);
  JSON.parse(follow.parent.files['generation.json']);
  assert.equal(campaign.attempts.find(item => item.id === 'three-meter-followup').resultIntent.unitScale, 0.05);
  assert.equal(campaign.attempts.find(item => item.id === 'three-meter-followup').input.parentArtifactId, previous.child.id);
  assert.equal(calls.find(call => call.prompt.includes('exactly 9 meters')).parent.id, savedParent().id);
  assert.equal(campaign.attempts.find(item => item.id === 'flight').outcome, 'expected-unsupported');
  assert.equal(campaign.attempts.find(item => item.id === 'noop').outcome, 'expected-noop');
  assert.equal(campaign.attempts.find(item => item.id === 'flight').child, undefined);
  const status = await phaseBudget.status();
  assert.equal(status.uncertain, false);
  assert.ok(Math.abs(status.categories.remix.settledUsd - (6 * 0.01 + 2 * 0.008)) < 1e-9);
  const again = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer: transfer(calls) });
  assert.equal(calls.length, 8);
  assert.equal(again.definition.sha256, campaign.definition.sha256);
  assert.equal(60 * REMIX_PROMPTS.find(item => item.id === 'half-distance').expectedIntent.unitScale, 3);
  assert.equal(60 * REMIX_PROMPTS.find(item => item.id === 'nine-meter').expectedIntent.unitScale, 9);
  assert.equal(roadsterGenerator, generateRoadsterTransfer);
  const implementation = await readFile(new URL('../src/campaign/remix-campaign.mjs', import.meta.url), 'utf8');
  assert.match(implementation, /generateTransfer = generateRoadsterTransfer/);
  assert.equal(implementation.includes('verifyBrowser'), false);
});

test('a successful response with the wrong intent is not a child and does not feed the follow-up', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const calls = [];
  const campaign = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer: transfer(calls, spec => {
    if (spec.id !== 'backward-fresh-press') return null;
    const source = 'export const id = "wrong";\n';
    return { files: { 'adapter.ts': source, 'adapter.js': 'export {}\n', 'frame.html': '<!doctype html>wrong\n', 'generation.json': JSON.stringify(report()), 'notices.txt': 'notice\n', 'verification.json': JSON.stringify({ passed: true }) },
      metadata: { parentArtifactId: savedParent().id, intent: { activation: 'held', direction: 'facing', unitScale: 0.1 }, componentId: savedParent().componentId, summary: 'unchanged rules' } };
  }) });
  const missed = campaign.attempts.find(item => item.id === 'backward-fresh-press');
  assert.equal(missed.outcome, 'intent-mismatch');
  assert.equal(missed.child, undefined);
  assert.deepEqual(missed.resultIntent, { activation: 'held', direction: 'facing', unitScale: 0.1 });
  assert.equal(campaign.attempts.find(item => item.id === 'three-meter-followup').outcome, 'blocked');
  assert.equal(calls.some(call => call.prompt.startsWith('Change only the distance')), false);
  assert.equal(campaign.attempts.find(item => item.id === 'nine-meter').outcome, 'matched');
  assert.equal(campaign.summary.matched, 4);
  assert.equal(missed.unpublished.published, false);
  const retained = join(directory, 'unpublished', 'backward-fresh-press');
  assert.match(await readFile(join(retained, 'adapter.ts'), 'utf8'), /wrong/);
  assert.match(await readFile(join(retained, 'frame.html'), 'utf8'), /wrong/);
  assert.match(await readFile(join(retained, 'notices.txt'), 'utf8'), /notice/);
  assert.equal(JSON.parse(await readFile(join(retained, 'verification.json'), 'utf8')).passed, true);
  JSON.parse(await readFile(join(retained, 'generation.json'), 'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(retained, 'metadata.json'), 'utf8')).intent, { activation: 'held', direction: 'facing', unitScale: 0.1 });
  const artifacts = join(directory, 'published', 'artifacts');
  for (const id of await readdir(artifacts)) {
    const artifact = await readRoadsterArtifact(artifacts, id);
    assert.equal(artifact.files['adapter.ts'].includes('wrong'), false);
    assert.equal(artifact.files['frame.html'].includes('wrong'), false);
  }
});

test('a bare success object does not publish a child', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const campaign = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer: async () => ({ ok: true }) });
  assert.equal(campaign.attempts[0].outcome, 'checks-failed');
  assert.equal(campaign.attempts[0].child, undefined);
  assert.equal(campaign.attempts[0].unpublished, undefined);
  assert.notEqual(campaign.attempts[0].outcome, 'matched');
  assert.deepEqual(await readdir(join(directory, 'published', 'artifacts')), []);
});

test('uncertain generation is retained, blocks later prompts, and is not repeated', async t => {
  const { directory, phaseBudget } = await fixture(t);
  let calls = 0;
  const generateTransfer = async () => { calls++; throw Error('socket closed before a body'); };
  const campaign = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer });
  assert.equal(calls, 1);
  assert.equal(campaign.attempts[0].outcome, 'failed');
  assert.equal(campaign.status, 'blocked');
  assert.equal((await phaseBudget.status()).uncertain, true);
  await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer });
  assert.equal(calls, 1);
  await assert.rejects(phaseBudget.reserve({ id: 'video:blocked-by-remix', category: 'video', maxCostUsd: 0.4 }), /uncertain/);
});

test('a bare success payload and a logged key do not become a published child', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const campaign = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), apiKey: 'super-secret-key', generateTransfer: async () => {
    throw Error('super-secret-key exploded');
  } });
  assert.equal(campaign.attempts[0].outcome, 'failed');
  assert.equal(campaign.attempts[0].child, undefined);
  assert.equal(campaign.attempts[0].error.includes('super-secret-key'), false);
  assert.equal((await readFile(join(directory, 'journal.json'), 'utf8')).includes('super-secret-key'), false);
  await assert.rejects(main(['--out', directory, '--phase-ledger', join(directory, 'missing-ledger')]), error => error.code === 'ENOENT');
  await main(['--help']);
});

test('published remix artifacts keep manifest identity and a resumed follow-up reads that child', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const calls = [];
  const controller = new AbortController();
  const stopped = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), signal: controller.signal, generateTransfer: transfer(calls, spec => {
    if (spec.id === 'backward-fresh-press') controller.abort();
    return null;
  }) });
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.attempts.find(item => item.id === 'three-meter-followup').status, 'prepared');
  const childId = stopped.attempts.find(item => item.id === 'backward-fresh-press').child.id;
  assert.equal(calls.length, 4);
  await assert.rejects(access(join(directory, 'published', '.lock')), error => error.code === 'ENOENT');
  const campaign = await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer: transfer(calls) });
  const follow = calls.find(call => call.prompt.startsWith('Change only the distance'));
  assert.equal(follow.parent.id, childId);
  assert.deepEqual(follow.parent.intent, { activation: 'press', direction: 'opposite', unitScale: 0.1 });
  assert.match(follow.parent.files['adapter.ts'], /backward-fresh-press/);
  assert.equal(follow.parent.component.source, 'marker backward-fresh-press');
  assert.equal(follow.parent.component.provenance.id, savedParent().componentId);
  assert.match(follow.parent.files['frame.html'], /</);
  assert.equal(calls.length, 8);
  const artifacts = join(directory, 'published', 'artifacts');
  const ids = await readdir(artifacts);
  assert.equal(ids.length, 6);
  const byPrompt = new Map(campaign.attempts.filter(attempt => attempt.outcome === 'matched').map(attempt => [attempt.id, attempt]));
  for (const promptId of ['half-distance', 'backward', 'fresh-press', 'backward-fresh-press', 'nine-meter']) {
    const attempt = byPrompt.get(promptId);
    const artifact = await readRoadsterArtifact(artifacts, attempt.child.id);
    assert.equal(artifact.id, attempt.child.id);
    assert.equal(artifact.parentArtifactId, savedParent().id);
    assert.deepEqual(canonicalIntent(artifact.intent), REMIX_PROMPTS.find(item => item.id === promptId).expectedIntent);
    assert.match(artifact.files['frame.html'], /</);
    assert.match(artifact.files['notices.txt'], /notice/);
    assert.equal(JSON.parse(artifact.files['verification.json']).passed, true);
    JSON.parse(artifact.files['generation.json']);
    assert.match(artifact.files['adapter.ts'], new RegExp(promptId));
  }
  const followAttempt = byPrompt.get('three-meter-followup');
  const followArtifact = await readRoadsterArtifact(artifacts, followAttempt.child.id);
  const backward = byPrompt.get('backward-fresh-press');
  assert.equal(followArtifact.parentArtifactId, backward.child.id);
  assert.deepEqual(canonicalIntent(followArtifact.intent), { activation: 'press', direction: 'opposite', unitScale: 0.05 });
  assert.equal(campaign.attempts.find(item => item.id === 'flight').child, undefined);
  assert.equal(campaign.attempts.find(item => item.id === 'noop').child, undefined);
  await runRemixCampaign({ directory, phaseBudget, parent: savedParent(), generateTransfer: transfer(calls) });
  assert.equal(calls.length, 8);
  assert.equal((await readdir(artifacts)).length, 6);
  const resumed = await readRoadsterArtifact(artifacts, backward.child.id);
  assert.equal(resumed.id, backward.child.id);
  assert.equal(resumed.files['adapter.ts'], await readFile(join(artifacts, backward.child.id, 'adapter.ts'), 'utf8'));
  assert.match(resumed.files['adapter.ts'], /backward-fresh-press/);
  await writeFile(join(artifacts, backward.child.id, 'adapter.ts'), 'tampered adapter\n');
  await assert.rejects(readRoadsterArtifact(artifacts, backward.child.id), /integrity/);
});
