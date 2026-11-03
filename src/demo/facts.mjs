import { repositoryPath } from '../paths.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeCommittedRemix } from './committed-remix.mjs';

const CAMPAIGN_ID = 'eb9ac874-30ad-4a0b-9bcc-78f8c25f539a';
const HUMAN_ASSISTANCE = [
  'Selected the motion boundary and function slices',
  'Mapped live registry and numeric state fields',
  'Selected development inputs and evaluator events',
];

function mustMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw Error('Demo fact missing from ' + label);
  return match;
}

async function readJson(root, path) {
  const text = await readFile(join(root, repositoryPath(path)), 'utf8');
  return { text, data: JSON.parse(text) };
}

function suiteTotals(files) {
  let ticks = 0;
  let maxPositionError = 0;
  const counts = {};
  for (const [name, file] of Object.entries(files)) {
    counts[name] = file.results.length;
    for (const result of file.results) {
      ticks += result.ticks;
      maxPositionError = Math.max(maxPositionError, result.maxPositionError);
    }
  }
  return { counts, ticks, maxPositionError, tolerance: files.acceptance.positionTolerance };
}

export async function loadDemoFacts(root) {
  const provenance = await readJson(root, 'components/dashy-dango-dash/provenance.json');
  const history = await readJson(root, 'components/dashy-dango-dash/recovery-history.json');
  const componentReadme = await readFile(join(root, 'assets/components/dashy-dango-dash/README.md'), 'utf8');
  const development = await readJson(root, 'components/dashy-dango-dash/evaluation-development.json');
  const regression = await readJson(root, 'components/dashy-dango-dash/evaluation-regressions.json');
  const acceptance = await readJson(root, 'components/dashy-dango-dash/evaluation-acceptance.json');
  const totals = suiteTotals({
    development: development.data,
    regression: regression.data,
    acceptance: acceptance.data,
  });
  const tickLabel = totals.ticks.toLocaleString('en-US');
  if (!componentReadme.includes(tickLabel)) throw Error('Trace total does not match the component README');
  if (!componentReadme.includes('$0.28511425')) throw Error('Component README cost does not match the saved figure');
  if (totals.counts.development !== 12 || totals.counts.regression !== 21 || totals.counts.acceptance !== 20) {
    throw Error('Saved suite sizes are not the recorded 12, 21, and 20 traces');
  }
  if (history.data.requests.length !== 3 || history.data.status !== 'accepted') {
    throw Error('Saved recovery history is not the three-request accepted component');
  }
  const humanAssistance = provenance.data.humanAssistance ?? [];
  for (const item of HUMAN_ASSISTANCE) {
    if (!humanAssistance.includes(item)) throw Error('Component provenance is missing recorded human assistance');
  }

  const journal = await readJson(root, `benchmark/recordings/${CAMPAIGN_ID}/journal.json`);
  const benchmarkReadme = await readFile(join(root, 'assets/benchmark/recordings/README.md'), 'utf8');
  const summary = journal.data.summary;
  const recovery = summary.tasks.find(task => task.id === 'recovery');
  if (!recovery || summary.completedTasks !== 2 || summary.attemptedTasks !== 3) {
    throw Error('November 2 campaign summary does not match the saved journal');
  }
  if (journal.data.summary.estimatedCostUsd.toFixed(7) !== '0.7299162') {
    throw Error('November 2 campaign cost does not match the saved journal');
  }
  const noSubmittedCandidate = /no submitted candidate/i.test(benchmarkReadme);
  if (!noSubmittedCandidate) throw Error('Benchmark README no longer records that recovery submitted no candidate');
  if (recovery.complete) throw Error('Campaign journal marks recovery complete, which conflicts with that README');

  const handoff = await readFile(join(root, 'docs/recovery-handoff.md'), 'utf8');
  const laterCost = mustMatch(handoff, /Total spend for these two development trials was \*\*\$([0-9.]+)\*\*/, 'recovery handoff')[1];
  if (!/scores were \*\*0\/13, 9\/13, and 10\/13\*\*/.test(handoff)) {
    throw Error('Recovery handoff is missing the 0/13, 9/13, and 10/13 scores');
  }
  if (!/Neither passed fresh recovery/.test(handoff)) throw Error('Recovery handoff is missing the acceptance result');

  let phase = { present: false, quoted: false, ceiling: null, reservations: [], reservationCount: 0 };
  try {
    const phaseFile = await readJson(root, 'reports/motion-transfer-phase/phase-budget.json');
    const definition = phaseFile.data.definition ?? {};
    const reservations = Array.isArray(phaseFile.data.reservations) ? phaseFile.data.reservations : [];
    const historical = definition.name === 'motion-transfer-additional-inference-v1' && definition.maxCostUsd === 45;
    phase = historical
      ? {
        present: true,
        quoted: true,
        ceiling: 45,
        onDiskName: definition.name,
        onDiskCeiling: 45,
        historicalSpendingIncluded: definition.historicalSpendingIncluded !== false,
        reservationCount: reservations.length,
        reservations: reservations.map(item => ({
          category: item.category,
          status: item.status,
          cap: item.maxCostUsd,
          estimate: item.estimatedCostUsd ?? null,
        })),
      }
      : {
        present: true,
        quoted: false,
        ceiling: null,
        reservations: [],
        onDiskName: definition.name ?? null,
        onDiskCeiling: typeof definition.maxCostUsd === 'number' ? definition.maxCostUsd : null,
        historicalSpendingIncluded: definition.historicalSpendingIncluded === true,
        reservationCount: reservations.length,
      };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const investigation = await readJson(root, 'lab/recordings/neutral-after-left.json');
  const manifest = JSON.parse(await readFile(join(root, 'assets/lab/recordings/manifest.json'), 'utf8'));
  const recorded = manifest.records.find(record => record.id === 'neutral-after-left');
  if (!recorded || investigation.data.report?.model !== 'muse-spark-1.3') {
    throw Error('Saved neutral-after-left investigation is not the Muse Spark recording');
  }
  if (!String(investigation.data.report.conclusion).includes('rejects preservation hypothesis')) {
    throw Error('Saved investigation conclusion does not record the contradicted hypothesis');
  }

  const roadster = await readJson(root, 'transfers/roadster/current.json');
  const remix = await describeCommittedRemix(root);

  return {
    component: {
      id: provenance.data.id,
      cost: '$0.28511425',
      requests: history.data.requests.length,
      models: [...new Set(history.data.requests.map(request => request.model))],
      development: totals.counts.development,
      regression: totals.counts.regression,
      acceptance: totals.counts.acceptance,
      ticks: totals.ticks,
      tickLabel,
      maxPositionError: totals.maxPositionError,
      tolerance: totals.tolerance,
      historicallyAccepted: true,
      humanAssistance,
    },
    campaign: {
      id: CAMPAIGN_ID,
      completedTasks: summary.completedTasks,
      attemptedTasks: summary.attemptedTasks,
      cost: '$0.7299162',
      recoveryAttempts: recovery.attempts,
      recoveryComplete: recovery.complete,
      noSubmittedCandidate,
    },
    laterTrials: {
      cost: '$' + laterCost,
      peak: '10/13',
      passedAcceptance: false,
      ids: ['dec3cd86-cbbe-48dd-8e73-36b6ad79db44', '6a53d6da-c6f4-4dec-a53f-c2d638769885'],
    },
    phase,
    investigation: {
      id: 'neutral-after-left',
      runId: recorded.runId,
      model: investigation.data.report.model,
      conclusionVerified: investigation.data.report.conclusionVerified === true,
    },
    roadsterParentId: roadster.data.id,
    remix,
  };
}
