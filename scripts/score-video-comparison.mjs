import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { scoreFidelityStudy } from '../benchmark/fidelity.mjs';
import { digest } from '../component/build.mjs';

export const SUPPLIED_DEFAULTS = Object.freeze({
  walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10,
});
export const COMPARISON_EXPLANATION = 'Finite comparison against the donor on 40 traces: position within 0.25 source pixels, exact ownership, and exact output events. Internal timers are not scored. This is not recovery acceptance and not a productivity estimate. No by-feel baseline and no external-developer baseline were measured.';
const OBSERVED = Object.freeze({
  video: { id: 'from-video', condition: 'video', inputKind: 'video', label: 'Video + supplied defaults' },
  image: { id: 'from-contact-sheet', condition: 'contact-sheet', inputKind: 'image', label: 'Contact sheet + supplied defaults' },
});
const SAVED_LABEL = 'Saved recovery';

const json = value => JSON.stringify(value, null, 2) + '\n';
const sameDefaults = config => !!config
  && Object.keys(SUPPLIED_DEFAULTS).every(key => config[key] === SUPPLIED_DEFAULTS[key])
  && Object.keys(config).length === Object.keys(SUPPLIED_DEFAULTS).length;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function usageOf(usage) {
  if (!usage) return null;
  const fields = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens'];
  if (!fields.every(key => Number.isFinite(usage[key]) && usage[key] >= 0)) return null;
  return Object.fromEntries(fields.map(key => [key, usage[key]]));
}

function costsOf(journal) {
  return {
    probeUsd: journal.attempts.probe.estimatedCostUsd,
    candidateUsd: journal.attempts.candidate.estimatedCostUsd,
    totalUsd: journal.summary?.estimatedCostUsd ?? null,
  };
}

function requestsOf(journal) {
  const probe = journal.attempts.probe, candidate = journal.attempts.candidate;
  return {
    probe: {
      id: probe.publicResponse?.id ?? null, estimatedCostUsd: probe.estimatedCostUsd ?? null,
      usage: usageOf(probe.usage), localization: probe.localization ?? null, phaseReservationId: probe.phaseReservationId ?? null,
    },
    candidate: {
      id: candidate.publicResponse?.id ?? null, estimatedCostUsd: candidate.estimatedCostUsd ?? null,
      usage: usageOf(candidate.usage), inputKind: candidate.inputKind ?? null, phaseReservationId: candidate.phaseReservationId ?? null,
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeExclusive(path, text) {
  try { await writeFile(path, text, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== text) throw Error('Refusing to overwrite ' + path);
  }
}

async function readJournal(directory) {
  const { integritySha256, ...journal } = await readJson(join(directory, 'journal.json'));
  assert.equal(digest(JSON.stringify(journal)), integritySha256, 'Video campaign journal integrity mismatch');
  assert.equal(journal.schemaVersion, 1, 'Unsupported video campaign journal');
  const { sha256, ...definition } = journal.definition;
  assert.equal(digest(JSON.stringify(definition)), sha256, 'Video campaign definition changed');
  assert.equal(definition.model, 'muse-spark-1.3', 'Unexpected video comparison model');
  if (!journal.attempts?.probe || !journal.attempts?.candidate) throw Error('Video campaign attempts are missing');
  return journal;
}

function observedSpec(journal) {
  const candidate = journal.attempts.candidate;
  const spec = Object.values(OBSERVED).find(item => item.inputKind === candidate.inputKind);
  if (!spec || candidate.comparison?.observedCondition !== spec.condition || candidate.comparison?.parameterSource !== 'supplied-public-contract') return null;
  if (journal.attempts.probe.localization !== (spec.inputKind === 'video')) return null;
  if (candidate.comparison?.savedRecovery?.id !== 'saved-recovery' || candidate.comparison?.savedRecovery?.condition !== 'saved-recovery') return null;
  return spec;
}

function failureReason(journal) {
  const probe = journal.attempts.probe, candidate = journal.attempts.candidate;
  if (probe.status !== 'complete') return `Probe ${probe.status}${probe.error ? ': ' + probe.error : ''}`;
  if (candidate.status !== 'complete') return `Candidate ${candidate.status}${candidate.error ? ': ' + candidate.error : ''}`;
  if (candidate.rejection) return `Candidate rejected: ${candidate.rejection}`;
  if (!candidate.studyId) return 'No frozen fidelity study was recorded';
  if (!candidate.comparison) return 'Candidate comparison record is missing';
  if (!sameDefaults(journal.definition?.defaults) || !sameDefaults(candidate.comparison?.defaults)) return 'Recorded defaults are not the supplied public contract';
  if (!observedSpec(journal)) return 'Probe localization, input kind, and frozen condition do not describe one video or contact-sheet comparison';
  return null;
}

function failureRecord(journal, reason, studyId = null) {
  return {
    schemaVersion: 1, kind: 'fidelity-video-comparison', status: 'failed', reason, chart: null, studyId,
    retained: {
      probeStatus: journal.attempts.probe.status ?? null,
      candidateStatus: journal.attempts.candidate.status ?? null,
      rejection: journal.attempts.candidate.rejection ?? null,
      error: journal.attempts.candidate.error ?? journal.attempts.probe.error ?? null,
      localization: journal.attempts.probe.localization ?? null,
      inputKind: journal.attempts.candidate.inputKind ?? null,
    },
    costs: costsOf(journal), requests: requestsOf(journal), metaCalled: false, explanation: COMPARISON_EXPLANATION,
  };
}

function assertStudyIntact(study) {
  const { id, ...manifest } = study;
  assert.equal(digest(JSON.stringify(manifest)), id, 'Fidelity study integrity mismatch');
  assert.equal(manifest.kind, 'frozen-fidelity-study', 'Fidelity study kind mismatch');
  assert.equal(manifest.schemaVersion, 1, 'Unsupported fidelity study');
  assert.equal(manifest.traceCount, 40, 'Fidelity study is not the 40-trace comparison');
  assert.equal(Number.isSafeInteger(manifest.seed) && manifest.seed >= 0 && manifest.seed <= 0xffffffff, true, 'Fidelity study seed is invalid');
  return manifest;
}

function pairMatches(study, spec) {
  const [observed, saved] = study.candidates ?? [];
  return observed?.id === spec.id && observed?.condition === spec.condition
    && observed?.sourceFile === `${spec.id}.ts` && observed?.configFile === `${spec.id}.config.json`
    && saved?.id === 'saved-recovery' && saved?.condition === 'saved-recovery'
    && saved?.sourceFile === 'saved-recovery.ts' && saved?.configFile === 'saved-recovery.config.json';
}

function provenanceMatches(provenance, spec) {
  const [observed, saved] = provenance.candidates ?? [];
  return observed?.id === spec.id && observed?.condition === spec.condition
    && saved?.id === 'saved-recovery' && saved?.condition === 'saved-recovery'
    && saved?.parameterSource === 'immutable-saved-component';
}

function validResult(result, entry, traceCount) {
  if (!result || result.id !== entry.id || result.condition !== entry.condition) return false;
  if (result.sourceFile !== entry.sourceFile || result.configFile !== entry.configFile) return false;
  if (result.sourceSha256 !== entry.sourceSha256 || result.configSha256 !== entry.configSha256) return false;
  if (result.total !== traceCount || !Number.isInteger(result.passed) || result.passed < 0 || result.passed > result.total) return false;
  if (result.status === 'scored') return Number.isFinite(result.maxPositionError) && result.maxPositionError >= 0 && result.error == null;
  if (result.status === 'failed') return result.passed === 0 && typeof result.error === 'string' && result.error.trim().length > 0 && result.maxPositionError == null;
  return false;
}

function validReport(report, study) {
  if (report?.schemaVersion !== 1 || report.status !== 'complete' || report.metaCalled !== false) return false;
  if (report.studyId !== study.id || report.seed !== study.seed || report.scoring !== study.scoring || report.scope !== study.scope) return false;
  if (!Array.isArray(report.results) || report.results.length !== study.candidates.length) return false;
  return study.candidates.every((entry, index) => validResult(report.results[index], entry, study.traceCount));
}

export function renderComparisonChart(model) {
  const allowed = new Set(['video', 'contact-sheet', 'saved-recovery']);
  if (!Array.isArray(model.rows) || model.rows.length !== 2 || model.rows.some(row => !allowed.has(row.condition))) {
    throw Error('Refusing to chart an unmeasured baseline');
  }
  if (model.rows[1].condition !== 'saved-recovery' || !['video', 'contact-sheet'].includes(model.rows[0].condition)) {
    throw Error('Chart requires the observed candidate and the saved recovery');
  }
  if (!sameDefaults(model.defaults)) throw Error('Chart defaults are not the supplied public contract');
  const width = 800, height = 500, track = 520;
  const rows = model.rows.map((row, index) => {
    const bar = row.status === 'scored' ? Math.round((row.passed / row.total) * track) : 0;
    const color = row.status !== 'scored' ? '#cf222e' : row.condition === 'saved-recovery' ? '#1a7f37' : '#1f6feb';
    const detail = row.status === 'scored'
      ? `${row.passed}/${row.total} passed. Maximum position error ${row.maxPositionError} source pixels.`
      : `Failed, retained. ${String(row.error).replace(/\s+/g, ' ')}`;
    const measured = row.status === 'scored' ? ` data-max-position-error="${escapeXml(row.maxPositionError)}"` : '';
    const top = 172 + index * 120;
    return `<g data-candidate="${escapeXml(row.id)}" data-condition="${escapeXml(row.condition)}" data-status="${escapeXml(row.status)}" data-passed="${row.passed}" data-total="${row.total}"${measured}>
    <text x="32" y="${top}" font-family="sans-serif" font-size="16" fill="#12141a">${escapeXml(row.label)}</text>
    <rect x="32" y="${top + 12}" width="${track}" height="28" fill="#e8eaed"/>
    <rect x="32" y="${top + 12}" width="${bar}" height="28" fill="${color}"/>
    <text x="564" y="${top + 32}" font-family="sans-serif" font-size="16" fill="#12141a">${row.passed}/${row.total}</text>
    <text x="32" y="${top + 64}" font-family="sans-serif" font-size="13" fill="#34363c">${escapeXml(detail)}</text>
  </g>`;
  }).join('\n  ');
  const defaults = `walkingSpeed ${model.defaults.walkingSpeed}, dashDistance ${model.defaults.dashDistance}, cooldownTicks ${model.defaults.cooldownTicks}, initialCooldownTicks ${model.defaults.initialCooldownTicks}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>Fidelity comparison</title>
  <desc>${escapeXml(COMPARISON_EXPLANATION)}</desc>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="32" y="42" font-family="sans-serif" font-size="22" fill="#12141a">Fidelity comparison</text>
  <text x="32" y="70" font-family="sans-serif" font-size="15" fill="#12141a">${escapeXml(model.rows[0].label)} versus ${SAVED_LABEL}</text>
  <text x="32" y="96" font-family="sans-serif" font-size="13" fill="#34363c">Supplied public-contract defaults. Not recovered from the pixels.</text>
  <text x="32" y="116" font-family="sans-serif" font-size="13" fill="#34363c">${escapeXml(defaults)}.</text>
  <text x="32" y="140" font-family="sans-serif" font-size="12" fill="#34363c">Frozen seed ${model.seed}. Study ${escapeXml(model.studyId)}.</text>
  ${rows}
  <text x="32" y="430" font-family="sans-serif" font-size="12" fill="#34363c">${escapeXml(model.scoring)}</text>
  <text x="32" y="452" font-family="sans-serif" font-size="12" fill="#34363c">Internal timers are not scored. No by-feel baseline and no external-developer baseline were measured.</text>
  <text x="32" y="474" font-family="sans-serif" font-size="12" fill="#34363c">Finite donor comparison only. Not recovery acceptance and not a productivity estimate.</text>
</svg>
`;
}

function comparisonRecord(journal, study, report, provenance) {
  const spec = observedSpec(journal);
  const rows = report.results.map(result => ({
    id: result.id,
    condition: result.condition,
    label: result.condition === 'saved-recovery' ? SAVED_LABEL : spec.label,
    status: result.status,
    passed: result.passed,
    total: result.total,
    ...(result.status === 'scored' ? { maxPositionError: result.maxPositionError } : { error: result.error }),
  }));
  const provenanceById = new Map((provenance.candidates ?? []).map(candidate => [candidate.id, candidate]));
  return {
    schemaVersion: 1,
    kind: 'fidelity-video-comparison',
    status: 'complete',
    chart: 'fidelity-comparison.svg',
    studyId: study.id,
    seed: study.seed,
    scoring: study.scoring,
    scope: study.scope,
    explanation: COMPARISON_EXPLANATION,
    observedCondition: spec.condition,
    observedLabel: spec.label,
    parameterSource: 'supplied-public-contract',
    defaults: { ...SUPPLIED_DEFAULTS },
    campaignId: journal.definition.id,
    model: journal.definition.model,
    evaluator: study.evaluator,
    costs: costsOf(journal),
    requests: requestsOf(journal),
    candidates: rows.map(row => ({
      ...row,
      provenanceLabel: provenanceById.get(row.id)?.label ?? null,
      parameterSource: provenanceById.get(row.id)?.parameterSource ?? null,
      sourceSha256: study.candidates.find(candidate => candidate.id === row.id).sourceSha256,
      configSha256: study.candidates.find(candidate => candidate.id === row.id).configSha256,
    })),
    links: {
      studyId: study.id,
      studyFile: 'fidelity-study/study.json',
      resultsFile: 'fidelity-study/results.json',
      provenanceFile: 'provenance.json',
      journalFile: 'journal.json',
      requestIds: { probe: requestsOf(journal).probe.id, candidate: requestsOf(journal).candidate.id },
    },
    metaCalled: false,
    baselinesMeasured: { byFeel: false, externalDevelopers: false },
  };
}

async function loadComparison(directory, journal) {
  const reason = failureReason(journal);
  if (reason) return { failure: failureRecord(journal, reason, journal.attempts.candidate.studyId ?? null) };
  const spec = observedSpec(journal);
  let provenance, study;
  try {
    provenance = await readJson(join(directory, 'provenance.json'));
    study = await readJson(join(directory, 'fidelity-study', 'study.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { failure: failureRecord(journal, 'Frozen study or provenance is missing', journal.attempts.candidate.studyId) };
  }
  assertStudyIntact(study);
  if (study.id !== journal.attempts.candidate.studyId || provenance.studyId !== study.id) {
    throw Error('Frozen study id does not match the video campaign');
  }
  if (provenance.repairs !== false || provenance.scoring !== 'frozen-only' || !pairMatches(study, spec) || !provenanceMatches(provenance, spec)) {
    return { failure: failureRecord(journal, 'Provenance does not describe the unrepaired video or contact-sheet pair', study.id) };
  }
  const observedProvenance = provenance.candidates[0];
  if (observedProvenance.parameterSource !== 'supplied-public-contract' || !sameDefaults(observedProvenance.defaults)) {
    return { failure: failureRecord(journal, 'Provenance defaults are not the supplied public contract', study.id) };
  }
  return { study, provenance, spec };
}

/** Read a finished video campaign, score its frozen pair once, and write a chart. No API client. */
export async function scoreVideoComparison({ directory, scoreStudy = scoreFidelityStudy } = {}) {
  const root = resolve(directory);
  const journal = await readJournal(root);
  const loaded = await loadComparison(root, journal);
  const metadataPath = join(root, 'fidelity-comparison.json');
  const chartPath = join(root, 'fidelity-comparison.svg');
  if (loaded.failure) {
    try { await readFile(chartPath); throw Error('Refusing to keep a chart without a scored comparison'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeExclusive(metadataPath, json(loaded.failure));
    return loaded.failure;
  }
  const studyDir = join(root, 'fidelity-study');
  const resultsPath = join(studyDir, 'results.json');
  let existing = null;
  try { existing = await readJson(resultsPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && !validReport(existing, loaded.study)) {
    throw Error('Fidelity results are incomplete or do not match the frozen study; refusing to overwrite them');
  }
  if (!existing) {
    await scoreStudy(studyDir);
    try { existing = await readJson(resultsPath); }
    catch (error) { if (error.code === 'ENOENT') throw Error('Scorer did not record results'); throw error; }
    if (!validReport(existing, loaded.study)) throw Error('Scorer recorded results that do not match the frozen study');
  }
  const metadata = comparisonRecord(journal, loaded.study, existing, loaded.provenance);
  const chart = renderComparisonChart({
    rows: metadata.candidates.map(candidate => ({
      id: candidate.id, condition: candidate.condition, label: candidate.label, status: candidate.status,
      passed: candidate.passed, total: candidate.total, maxPositionError: candidate.maxPositionError, error: candidate.error,
    })),
    defaults: metadata.defaults, seed: metadata.seed, studyId: metadata.studyId, scoring: metadata.scoring,
  });
  await writeExclusive(chartPath, chart);
  await writeExclusive(metadataPath, json(metadata));
  return metadata;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { campaign: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('node scripts/score-video-comparison.mjs --campaign <video-campaign-directory>');
    console.log('Scores the frozen video or contact-sheet candidate and the saved recovery once. Reuses a complete results file. Writes a standalone SVG chart and metadata. No API calls, no source repair, and no seed change.');
    return;
  }
  if (!values.campaign) throw Error('--campaign is required');
  const metadata = await scoreVideoComparison({ directory: resolve(values.campaign) });
  const summary = {
    status: metadata.status, reason: metadata.reason ?? null, studyId: metadata.studyId, chart: metadata.chart,
    observedCondition: metadata.observedCondition ?? null, costs: metadata.costs,
    candidates: (metadata.candidates ?? []).map(candidate => ({
      id: candidate.id, condition: candidate.condition, status: candidate.status, passed: candidate.passed,
      total: candidate.total, maxPositionError: candidate.maxPositionError ?? null, error: candidate.error ?? null,
    })),
  };
  console.log(JSON.stringify(summary));
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error.message).slice(0, 500)); process.exitCode = 1; });
}
