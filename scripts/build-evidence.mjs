import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Derives small, committed evidence from gitignored run records. Makes no model request.
const OUT = 'assets/evidence';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const write = (name, value) => writeFile(join(OUT, name), JSON.stringify(value, null, 2) + '\n');
await mkdir(OUT, { recursive: true });

async function recovery() {
  const root = 'reports/motion-transfer-phase/wonder-development-001/reports';
  const report = await json(join(root, readdirSync(root).find(name => name.endsWith('.json'))));
  const { attempts, frozenCandidateId, acceptedAttempt } = report.session.recovery;
  const stages = {}, tools = {};
  for (const request of report.requests) stages[request.recoveryStage] = (stages[request.recoveryStage] ?? 0) + 1;
  for (const call of report.toolCalls) tools[call.name] = (tools[call.name] ?? 0) + 1;
  await write('recovery.json', {
    model: report.model, startedAt: report.startedAt, finishedAt: report.finishedAt, requests: report.requests.length,
    estimatedCostUsd: report.estimatedCostUsd, inputTokens: report.usage.inputTokens, outputTokens: report.usage.outputTokens,
    stages, tools, frozenCandidateId, acceptedAttempt,
    attempts: attempts.map(attempt => {
      const results = attempt.development.results, failed = results.filter(result => !result.passed);
      const first = failed[0]?.firstDivergence;
      return {
        attempt: attempt.attempt, candidateId: attempt.candidateId, passed: results.length - failed.length, total: results.length,
        failedTraces: failed.map(result => result.name),
        firstFailure: first ? { trace: failed[0].name, tick: first.tick, expected: first.expected, actual: first.actual } : null,
        acceptance: attempt.acceptance ? { passed: attempt.acceptance.results.filter(result => result.passed).length, total: attempt.acceptance.results.length } : null,
      };
    }),
  });
}

async function liveMechanics() {
  const { positive, negative, estimatedCostUsd, observedRepairBenefits, tasks } = await json('reports/live-mechanics/frozen-tasks-v1/results.json');
  await write('live-mechanics.json', { positive, negative, estimatedCostUsd, observedRepairBenefits, tasks });
}

async function autoPort() {
  const directory = 'reports/auto-port/campaign-v1';
  if (!existsSync(join(directory, 'results.json'))) return;
  const results = await json(join(directory, 'results.json'));
  const manifest = await json('src/benchmark/auto-port-tasks.json');
  const games = [];
  for (const game of manifest.games) {
    const result = results.games.find(entry => entry.id === game.id);
    if (!result) throw Error(`${game.id} has no campaign result`);
    if (game.status === 'excluded') { games.push({ id: game.id, status: 'excluded', reason: game.reason }); continue; }
    const attempts = [];
    for (let attempt = 1; attempt <= result.attempts; attempt += 1) {
      const record = await json(join(directory, `${game.id}-attempt-${attempt}.json`));
      const text = record.response.output?.filter(item => item.type === 'message').flatMap(item => item.content ?? []).map(part => part.text ?? '').join(' ').trim() || null;
      attempts.push({
        attempt, message: text, summary: record.submission?.summary ?? null, status: record.submission?.status ?? 'no-submission',
        unitsPerSourcePixel: record.submission?.unitsPerSourcePixel ?? null, patches: record.submission?.patches ?? [],
        inputTokens: record.inputTokens, outputTokens: record.response.usage?.output_tokens ?? null,
        estimatedCostUsd: record.estimatedCostUsd, wallMs: record.wallMs,
        checks: record.report?.checks ?? [], measurements: record.report?.measurements ?? {},
      });
    }
    games.push({ id: game.id, core: game.core, dashKey: game.dashKey, status: result.status, failure: result.failure, estimatedCostUsd: result.estimatedCostUsd, wallMs: result.wallMs, attempts });
  }
  await write('auto-port.json', { name: results.name, commit: results.commit, model: manifest.generation.model, upstream: manifest.upstream, componentId: manifest.componentId, games });
}

async function wonderRepeat() {
  const plan = await json('src/benchmark/wonder-repeat-tasks.json');
  const read = async (path, label, kind) => {
    const trial = (await json(path)).trials[0], { report } = trial, { attempts, acceptedAttempt } = report.session.recovery;
    const score = attempt => attempt.development.results.filter(result => result.passed).length;
    const exam = attempts.find(attempt => attempt.acceptance)?.acceptance.results;
    return { label, kind, status: acceptedAttempt ? 'accepted' : 'rejected', failureCategory: acceptedAttempt ? null : trial.failureCategory,
      bestDevelopment: { passed: Math.max(...attempts.map(score)), total: attempts[0].development.results.length },
      acceptance: exam ? { passed: exam.filter(result => result.passed).length, total: exam.length } : null,
      stuckOn: [...new Set(attempts.at(-1).development.results.filter(result => !result.passed).map(result => result.name))],
      candidates: attempts.length, requests: report.requests.length, elapsedMs: trial.elapsedMachineMs, estimatedCostUsd: report.estimatedCostUsd };
  };
  const repeats = [];
  for (let ordinal = 1; ordinal <= plan.plannedTrials; ordinal += 1) {
    const path = `reports/wonder-repeat/trial-${ordinal}/journal.json`;
    repeats.push(existsSync(path) ? await read(path, `Repeat ${ordinal}`, 'repeat') : { label: `Repeat ${ordinal}`, kind: 'repeat', status: 'not-run' });
  }
  const run = repeats.filter(session => session.status !== 'not-run');
  const repeatCostUsd = run.reduce((sum, session) => sum + session.estimatedCostUsd, 0);
  const remainingUsd = plan.budget.remainingAtFreezeUsd - repeatCostUsd;
  const sessions = [await read('reports/motion-transfer-phase/wonder-development-001/journal.json', 'First session', 'baseline'), ...repeats];
  await write('wonder-repeat.json', { name: plan.name, model: plan.model, protocolId: plan.protocolId, plannedTrials: plan.plannedTrials,
    repeatsRun: run.length, repeatsAccepted: run.filter(session => session.status === 'accepted').length,
    fullSessions: run.length + 1, acceptedSessions: sessions.filter(session => session.status === 'accepted').length,
    repeatCostUsd, remainingUsd, sessions });
}

await recovery(); await liveMechanics(); await autoPort(); await wonderRepeat();
console.log(readdirSync(OUT).join(', '));
