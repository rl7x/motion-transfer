import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CAMPAIGN_ID = 'eb9ac874-30ad-4a0b-9bcc-78f8c25f539a';
const SAVED_REMIX_ID = 'f67245c401fc82cfd516d6e333fe67dad2acfd232ca7607baea6a6d05d912fbf';

function mustMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw Error('Demo fact missing from ' + label);
  return match;
}

async function readJson(root, path) {
  const text = await readFile(join(root, path), 'utf8');
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
  const componentReadme = await readFile(join(root, 'components/dashy-dango-dash/README.md'), 'utf8');
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

  const journal = await readJson(root, `benchmark/recordings/${CAMPAIGN_ID}/journal.json`);
  const benchmarkReadme = await readFile(join(root, 'benchmark/recordings/README.md'), 'utf8');
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

  const phase = await readJson(root, 'reports/motion-transfer-phase/phase-budget.json');
  if (phase.data.definition.maxCostUsd !== 45) throw Error('Phase budget ceiling is not $45');
  const investigation = await readJson(root, 'lab/recordings/neutral-after-left.json');
  const manifest = JSON.parse(await readFile(join(root, 'lab/recordings/manifest.json'), 'utf8'));
  const recorded = manifest.records.find(record => record.id === 'neutral-after-left');
  if (!recorded || investigation.data.report?.model !== 'muse-spark-1.3') {
    throw Error('Saved neutral-after-left investigation is not the Muse Spark recording');
  }
  if (!String(investigation.data.report.conclusion).includes('rejects preservation hypothesis')) {
    throw Error('Saved investigation conclusion does not record the contradicted hypothesis');
  }

  const roadster = await readJson(root, 'transfers/roadster/current.json');
  let remix = null;
  try {
    const remixRecord = await readJson(root, `reports/lab/artifacts/${SAVED_REMIX_ID}/manifest.json`);
    if (remixRecord.data.parentArtifactId !== roadster.data.id || remixRecord.data.componentId !== provenance.data.id) {
      throw Error('Saved remix is not a child of the current Roadster transfer');
    }
    remix = {
      id: SAVED_REMIX_ID,
      parentId: remixRecord.data.parentArtifactId,
      componentId: remixRecord.data.componentId,
      intent: remixRecord.data.intent,
      summary: remixRecord.data.summary,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

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
    phase: {
      ceiling: phase.data.definition.maxCostUsd,
      reservations: phase.data.reservations.map(item => ({
        category: item.category,
        status: item.status,
        cap: item.maxCostUsd,
        estimate: item.estimatedCostUsd ?? null,
      })),
    },
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
