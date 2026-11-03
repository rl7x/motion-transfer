import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { freezeFidelityStudy, scoreFidelityStudy } from '../benchmark/fidelity.mjs';
import { digest } from '../component/build.mjs';
import {
  COMPARISON_EXPLANATION, SUPPLIED_DEFAULTS, main, renderComparisonChart, scoreVideoComparison,
} from '../scripts/score-video-comparison.mjs';

const savedSource = fileURLToPath(new URL('../components/dashy-dango-dash/component.ts', import.meta.url));
const savedConfig = fileURLToPath(new URL('../components/dashy-dango-dash/contract.json', import.meta.url));
const realCampaign = fileURLToPath(new URL('../reports/motion-transfer-phase/video-001/', import.meta.url));
const pinnedComparison = fileURLToPath(new URL('../benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const scoring = 'position within 0.25 source pixels; exact ownership and output events; no internal timer scoring';
const scope = 'Finite comparison against the donor, not recovery acceptance or a productivity estimate. Do not repair candidates after observing this suite.';

function withSha(definition) {
  return { ...definition, sha256: digest(JSON.stringify(definition)) };
}
function withIntegrity(journal) {
  return { ...journal, integritySha256: digest(JSON.stringify(journal)) };
}
function withId(contents) {
  return { ...contents, id: digest(JSON.stringify(contents)) };
}
const observedFor = condition => condition === 'video'
  ? { id: 'from-video', condition: 'video', inputKind: 'video', label: 'Video + supplied defaults' }
  : { id: 'from-contact-sheet', condition: 'contact-sheet', inputKind: 'image', label: 'Contact sheet + supplied defaults' };

function studyContents(condition, seed = 123) {
  const observed = observedFor(condition);
  return {
    schemaVersion: 1, kind: 'frozen-fidelity-study', createdAt: '2026-11-03T00:00:00.000Z', seed, traceCount: 40,
    evaluator: { 'evaluator/motion.mjs': 'fixture' },
    candidates: [
      { id: observed.id, condition: observed.condition, sourceFile: `${observed.id}.ts`, configFile: `${observed.id}.config.json`, sourceSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64) },
      { id: 'saved-recovery', condition: 'saved-recovery', sourceFile: 'saved-recovery.ts', configFile: 'saved-recovery.config.json', sourceSha256: 'c'.repeat(64), configSha256: 'd'.repeat(64) },
    ],
    scoring, scope,
  };
}

function reportFor(study, rows) {
  return {
    schemaVersion: 1, studyId: study.id, status: 'complete', seed: study.seed, metaCalled: false, scoring: study.scoring, scope: study.scope,
    results: study.candidates.map((entry, index) => {
      const row = rows[index];
      return { ...entry, status: row.status, passed: row.passed, total: 40, ...(row.status === 'scored' ? { maxPositionError: row.maxPositionError } : { error: row.error }) };
    }),
  };
}

async function writeCampaign(directory, { condition = 'contact-sheet', seed = 123, rows, presetResults = false, rejection = null, studyId = 'present' } = {}) {
  const observed = observedFor(condition);
  const contents = studyContents(condition, seed);
  const study = withId(contents);
  const definition = withSha({
    schemaVersion: 1, id: 'campaign-fixture', model: 'muse-spark-1.3', defaults: { ...SUPPLIED_DEFAULTS },
  });
  const candidate = {
    status: rejection ? 'complete' : 'complete', rejection, studyId: studyId === 'present' ? study.id : studyId,
    inputKind: observed.inputKind, estimatedCostUsd: 0.2,
    publicResponse: { id: 'resp-candidate' }, phaseReservationId: 'video:fixture:candidate',
    comparison: rejection ? null : {
      observedCondition: observed.condition, parameterSource: 'supplied-public-contract', defaults: { ...SUPPLIED_DEFAULTS },
      savedRecovery: { id: 'saved-recovery', condition: 'saved-recovery' },
    },
  };
  const journal = withIntegrity({
    schemaVersion: 1, definition, status: 'complete',
    summary: { estimatedCostUsd: 0.3 },
    attempts: {
      probe: { status: 'complete', localization: observed.inputKind === 'video', estimatedCostUsd: 0.1, publicResponse: { id: 'resp-probe' }, phaseReservationId: 'video:fixture:probe', usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0, reasoningTokens: 1 } },
      candidate,
    },
  });
  await writeFile(join(directory, 'journal.json'), JSON.stringify(journal, null, 2) + '\n');
  if (rejection || studyId !== 'present') return { study, journal };
  const studyDir = join(directory, 'fidelity-study');
  await writeFile(join(directory, 'provenance.json'), JSON.stringify({
    schemaVersion: 1, studyId: study.id, scoring: 'frozen-only', repairs: false,
    candidates: [
      { id: observed.id, condition: observed.condition, parameterSource: 'supplied-public-contract', defaults: { ...SUPPLIED_DEFAULTS }, label: `${observed.label}. Those defaults were not recovered from the pixels.` },
      { id: 'saved-recovery', condition: 'saved-recovery', parameterSource: 'immutable-saved-component', label: 'Existing immutable saved recovery, included for comparison.' },
    ],
  }, null, 2) + '\n');
  await writeFile(join(studyDir, 'study.json'), JSON.stringify(study, null, 2) + '\n').catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    const { mkdir } = await import('node:fs/promises');
    await mkdir(studyDir);
    await writeFile(join(studyDir, 'study.json'), JSON.stringify(study, null, 2) + '\n');
  });
  if (presetResults) await writeFile(join(studyDir, 'results.json'), JSON.stringify(reportFor(study, rows), null, 2) + '\n');
  return { study, journal, studyDir };
}

async function tempCampaign(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fidelity-chart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the chart uses the supplied pass counts and refuses an unmeasured baseline', () => {
  const svg = renderComparisonChart({
    studyId: 'a'.repeat(64), seed: 99, scoring, defaults: SUPPLIED_DEFAULTS,
    rows: [
      { id: 'from-video', condition: 'video', label: 'Video + supplied defaults', status: 'scored', passed: 7, total: 40, maxPositionError: 4.5 },
      { id: 'saved-recovery', condition: 'saved-recovery', label: 'Saved recovery', status: 'failed', passed: 0, total: 40, error: 'compile broke <adapter>' },
    ],
  });
  assert.match(svg, /Video \+ supplied defaults versus Saved recovery/);
  assert.equal(svg.includes('Contact sheet + supplied defaults versus'), false);
  assert.match(svg, /walkingSpeed 2, dashDistance 60, cooldownTicks 25, initialCooldownTicks 10/);
  assert.match(svg, /Not recovered from the pixels/);
  assert.match(svg, /data-candidate="from-video"[^>]*data-passed="7"[^>]*data-total="40"[^>]*data-max-position-error="4\.5"/);
  assert.match(svg, /7\/40 passed\. Maximum position error 4\.5 source pixels\./);
  assert.match(svg, /data-candidate="saved-recovery"[^>]*data-status="failed"[^>]*data-passed="0"/);
  assert.equal(svg.includes('data-max-position-error="0"'), false);
  assert.match(svg, /compile broke &lt;adapter&gt;/);
  assert.match(svg, /No by-feel baseline and no external-developer baseline were measured/);
  assert.match(svg, /Internal timers are not scored/);
  assert.equal(svg.includes('<script'), false);
  assert.equal(svg.includes('href'), false);
  assert.equal(svg.replaceAll('http://www.w3.org/2000/svg', '').includes('http'), false);
  assert.equal((svg.match(/data-candidate=/g) ?? []).length, 2);
  assert.throws(() => renderComparisonChart({
    studyId: 'a'.repeat(64), seed: 1, scoring, defaults: SUPPLIED_DEFAULTS,
    rows: [
      { id: 'feel', condition: 'by-feel', label: 'By feel', status: 'scored', passed: 1, total: 40, maxPositionError: 1 },
      { id: 'saved-recovery', condition: 'saved-recovery', label: 'Saved recovery', status: 'scored', passed: 40, total: 40, maxPositionError: 0 },
    ],
  }), /unmeasured baseline/);
});

test('a rejected candidate keeps the reason and does not invent a chart', async t => {
  const directory = await tempCampaign(t);
  let calls = 0;
  await writeCampaign(directory, { rejection: 'config-mismatch', studyId: null });
  const metadata = await scoreVideoComparison({ directory, scoreStudy: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(metadata.status, 'failed');
  assert.equal(metadata.chart, null);
  assert.equal(metadata.reason, 'Candidate rejected: config-mismatch');
  assert.equal(metadata.retained.rejection, 'config-mismatch');
  assert.equal(metadata.costs.probeUsd, 0.1);
  assert.equal(metadata.costs.candidateUsd, 0.2);
  assert.equal(metadata.metaCalled, false);
  await assert.rejects(access(join(directory, 'fidelity-comparison.svg')), error => error.code === 'ENOENT');
  const stored = JSON.parse(await readFile(join(directory, 'fidelity-comparison.json'), 'utf8'));
  assert.equal(stored.reason, metadata.reason);
  await scoreVideoComparison({ directory, scoreStudy: async () => { calls += 1; } });
  assert.equal(calls, 0);
});

test('a fake scorer renders one contact-sheet chart and a rerun does not rescore', async t => {
  const directory = await tempCampaign(t);
  const { study, studyDir } = await writeCampaign(directory, { condition: 'contact-sheet' });
  const rows = [
    { status: 'scored', passed: 11, maxPositionError: 18.25 },
    { status: 'scored', passed: 40, maxPositionError: 0 },
  ];
  let calls = 0;
  const scoreStudy = async () => {
    calls += 1;
    await writeFile(join(studyDir, 'results.json'), JSON.stringify(reportFor(study, rows), null, 2) + '\n', { flag: 'wx' });
  };
  const metadata = await scoreVideoComparison({ directory, scoreStudy });
  assert.equal(calls, 1);
  assert.equal(metadata.observedCondition, 'contact-sheet');
  assert.equal(metadata.observedLabel, 'Contact sheet + supplied defaults');
  assert.equal(metadata.candidates[1].label, 'Saved recovery');
  assert.equal(metadata.baselinesMeasured.byFeel, false);
  assert.equal(metadata.baselinesMeasured.externalDevelopers, false);
  assert.equal(metadata.metaCalled, false);
  assert.equal(metadata.links.requestIds.probe, 'resp-probe');
  assert.equal(metadata.links.requestIds.candidate, 'resp-candidate');
  assert.equal(metadata.links.studyId, study.id);
  assert.deepEqual(metadata.defaults, SUPPLIED_DEFAULTS);
  assert.match(metadata.candidates[0].provenanceLabel, /not recovered from the pixels/);
  const svg = await readFile(join(directory, 'fidelity-comparison.svg'), 'utf8');
  assert.match(svg, /Contact sheet \+ supplied defaults versus Saved recovery/);
  assert.match(svg, /data-passed="11"[^>]*data-total="40"[^>]*data-max-position-error="18\.25"/);
  assert.match(svg, /data-candidate="saved-recovery"[^>]*data-passed="40"[^>]*data-max-position-error="0"/);
  assert.equal(svg.includes('data-condition="by-feel"'), false);
  assert.match(svg, /No by-feel baseline and no external-developer baseline were measured/);
  assert.equal(svg.includes(COMPARISON_EXPLANATION), true);
  const resultsBytes = await readFile(join(studyDir, 'results.json'));
  const again = await scoreVideoComparison({ directory, scoreStudy: async () => { calls += 1; throw Error('rescored'); } });
  assert.equal(calls, 1);
  assert.deepEqual(again.candidates.map(candidate => candidate.passed), [11, 40]);
  assert.deepEqual(await readFile(join(studyDir, 'results.json')), resultsBytes);
  assert.equal(await readFile(join(directory, 'fidelity-study', 'study.json'), 'utf8'), JSON.stringify(study, null, 2) + '\n');
});

test('incomplete results are retained and not charted', async t => {
  const directory = await tempCampaign(t);
  const { study, studyDir } = await writeCampaign(directory, { condition: 'video' });
  const running = { schemaVersion: 1, studyId: study.id, status: 'running', metaCalled: false };
  const text = JSON.stringify(running, null, 2) + '\n';
  await writeFile(join(studyDir, 'results.json'), text);
  let calls = 0;
  await assert.rejects(scoreVideoComparison({ directory, scoreStudy: async () => { calls += 1; } }), /refusing to overwrite/);
  assert.equal(calls, 0);
  assert.equal(await readFile(join(studyDir, 'results.json'), 'utf8'), text);
  await assert.rejects(access(join(directory, 'fidelity-comparison.svg')), error => error.code === 'ENOENT');
});

test('the real scorer retains a failed candidate beside the saved recovery', { timeout: 120_000 }, async t => {
  const directory = await tempCampaign(t);
  const broken = join(directory, 'broken.ts');
  await writeFile(broken, 'export const broken = true;\n');
  const studyDir = join(directory, 'fidelity-study');
  const manifest = await freezeFidelityStudy(studyDir, [
    { id: 'from-contact-sheet', condition: 'contact-sheet', sourcePath: broken, configPath: savedConfig },
    { id: 'saved-recovery', condition: 'saved-recovery', sourcePath: savedSource, configPath: savedConfig },
  ]);
  const definition = withSha({ schemaVersion: 1, id: 'real-scorer-fixture', model: 'muse-spark-1.3', defaults: { ...SUPPLIED_DEFAULTS } });
  const journal = withIntegrity({
    schemaVersion: 1, definition, status: 'complete', summary: { estimatedCostUsd: 0 },
    attempts: {
      probe: { status: 'complete', localization: false, estimatedCostUsd: 0, publicResponse: { id: 'resp-probe' } },
      candidate: {
        status: 'complete', rejection: null, studyId: manifest.id, inputKind: 'image', estimatedCostUsd: 0, publicResponse: { id: 'resp-candidate' },
        comparison: { observedCondition: 'contact-sheet', parameterSource: 'supplied-public-contract', defaults: { ...SUPPLIED_DEFAULTS }, savedRecovery: { id: 'saved-recovery', condition: 'saved-recovery' } },
      },
    },
  });
  await writeFile(join(directory, 'journal.json'), JSON.stringify(journal, null, 2) + '\n');
  await writeFile(join(directory, 'provenance.json'), JSON.stringify({
    schemaVersion: 1, studyId: manifest.id, scoring: 'frozen-only', repairs: false,
    candidates: [
      { id: 'from-contact-sheet', condition: 'contact-sheet', parameterSource: 'supplied-public-contract', defaults: { ...SUPPLIED_DEFAULTS }, label: 'Contact sheet plus supplied defaults. Not recovered from the pixels.' },
      { id: 'saved-recovery', condition: 'saved-recovery', parameterSource: 'immutable-saved-component', label: 'Saved recovery' },
    ],
  }, null, 2) + '\n');
  const before = await readFile(join(studyDir, 'study.json'));
  let calls = 0;
  const metadata = await scoreVideoComparison({ directory, scoreStudy: async study => { calls += 1; return scoreFidelityStudy(study); } });
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(join(studyDir, 'study.json')), before);
  assert.equal(metadata.candidates[0].status, 'failed');
  assert.equal(metadata.candidates[0].passed, 0);
  assert.match(metadata.candidates[0].error, /init/);
  assert.equal(metadata.candidates[1].status, 'scored');
  assert.equal(metadata.candidates[1].passed, 40);
  assert.equal(metadata.candidates[1].maxPositionError, 0);
  assert.equal(metadata.candidates[1].label, 'Saved recovery');
  const svg = await readFile(join(directory, 'fidelity-comparison.svg'), 'utf8');
  assert.equal(svg.includes(metadata.candidates[0].error.replaceAll('&', '&amp;').replaceAll('<', '&lt;')), true);
  assert.match(svg, /data-candidate="saved-recovery"[^>]*data-passed="40"[^>]*data-max-position-error="0"/);
  const results = JSON.parse(await readFile(join(studyDir, 'results.json'), 'utf8'));
  assert.equal(results.seed, manifest.seed);
  assert.equal(results.metaCalled, false);
  await assert.rejects(scoreFidelityStudy(studyDir), /EEXIST/);
  await scoreVideoComparison({ directory, scoreStudy: async () => { calls += 1; throw Error('rescored'); } });
  assert.equal(calls, 1);
});

test('the pinned comparison hashes match and a temporary copy reuses its results', async t => {
  const recording = JSON.parse(await readFile(join(pinnedComparison, 'recording.json'), 'utf8'));
  assert.equal(recording.studyId, 'f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5');
  assert.equal(recording.files.some(file => file.path.includes('phase-budget')), false);
  const pinnedResults = await readFile(join(pinnedComparison, 'fidelity-study/results.json'));
  for (const file of recording.files) {
    const bytes = await readFile(join(pinnedComparison, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256);
  }
  const directory = await tempCampaign(t);
  const copy = join(directory, 'campaign');
  await cp(pinnedComparison, copy, { recursive: true });
  let calls = 0;
  const metadata = await scoreVideoComparison({ directory: copy, scoreStudy: async () => { calls += 1; throw Error('rescored'); } });
  assert.equal(calls, 0);
  assert.equal(metadata.observedCondition, 'contact-sheet');
  assert.equal(metadata.candidates[0].passed, 0);
  assert.equal(metadata.candidates[0].total, 40);
  assert.equal(metadata.candidates[0].maxPositionError, 271.0249570072505);
  assert.equal(metadata.candidates[1].passed, 40);
  assert.equal(metadata.candidates[1].maxPositionError, 0);
  assert.equal(metadata.costs.probeUsd, 0.00597225);
  assert.equal(metadata.costs.candidateUsd, 0.016962);
  assert.equal(metadata.baselinesMeasured.byFeel, false);
  assert.deepEqual(await readFile(join(pinnedComparison, 'fidelity-study/results.json')), pinnedResults);
  assert.deepEqual(await readFile(join(copy, 'fidelity-study/results.json')), pinnedResults);
  assert.deepEqual(await readFile(join(copy, 'fidelity-study/from-contact-sheet.ts')), await readFile(join(pinnedComparison, 'fidelity-study/from-contact-sheet.ts')));
});

test('a restored local video campaign matches the pin when the report is present', async t => {
  try { await access(join(realCampaign, 'journal.json')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      t.skip('local video-001 campaign is not in this checkout');
      return;
    }
    throw error;
  }
  const recording = JSON.parse(await readFile(join(pinnedComparison, 'recording.json'), 'utf8'));
  const pinnedResults = await readFile(join(pinnedComparison, 'fidelity-study/results.json'));
  for (const file of recording.files) {
    assert.deepEqual(await readFile(join(realCampaign, file.path)), await readFile(join(pinnedComparison, file.path)));
  }
  assert.deepEqual(await readFile(join(pinnedComparison, 'fidelity-study/results.json')), pinnedResults);
});

test('the scorer script has no API client', async () => {
  const source = await readFile(new URL('../scripts/score-video-comparison.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('createMetaClient'), false);
  assert.equal(source.includes('freezeFidelityStudy'), false);
  assert.equal(source.includes('scoreFidelityStudy'), true);
  await main(['--help']);
  await assert.rejects(main([]), /--campaign is required/);
});
