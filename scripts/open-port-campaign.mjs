import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { createOpenClient, OPEN_MODEL, OPEN_PRICE } from '../src/agent/open-client.mjs';
import { AUTO_PORT, autoPortRequest, readSubmission, repairFeedback } from '../src/auto-port/request.mjs';
import { VERIFY } from '../src/auto-port/verify.mjs';
import { dockerRun } from '../src/hosting/broker.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';

/*
 * The same eight games, request, attempt limit and isolated checks as the Muse Spark campaign,
 * with only the model changed. Freeze and commit this plan before the first request.
 */
const MANIFEST = 'src/benchmark/open-port-tasks.json';
const SPARK_MANIFEST = 'src/benchmark/auto-port-tasks.json';
const FROZEN = ['src/agent/open-client.mjs', 'scripts/open-port-campaign.mjs', SPARK_MANIFEST];
const IMAGE = 'motion-transfer-verifier:local';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: { freeze: { type: 'boolean' }, 'allow-paid': { type: 'boolean' }, out: { type: 'string' } } });

async function definition() {
  const spark = JSON.parse(await readFile(SPARK_MANIFEST, 'utf8'));
  const sources = { ...spark.sources };
  for (const path of FROZEN) sources[path] = digest(await readFile(path));
  return {
    schemaVersion: 1, name: 'open-port-v1',
    question: 'With only the model changed, can Muse Spark Open connect the recovered dash to the eight games Muse Spark faced?',
    model: OPEN_MODEL, provider: 'baseten', comparedWith: spark.name, componentId: ACCEPTED_COMPONENT_ID,
    generation: { effort: AUTO_PORT.effort, maxOutputTokens: AUTO_PORT.maxOutputTokens, maxAttempts: AUTO_PORT.maxAttempts },
    verification: VERIFY, games: spark.games, sources,
  };
}

async function portGame(client, game, directory) {
  const source = await readFile(`assets/auto-port/games/${game.id}/${game.core}`, 'utf8');
  const attempts = [];
  let feedback = null, passed = false, failure = null;
  for (let attempt = 1; attempt <= AUTO_PORT.maxAttempts && !passed; attempt += 1) {
    const started = Date.now();
    const response = await client.respond(autoPortRequest({ file: game.core, source, feedback }));
    const usage = readUsage(response.usage);
    const record = { attempt, status: response.status, usage, estimatedCostUsd: tokenCost(usage, OPEN_PRICE) };
    let submission = null;
    try { submission = readSubmission(response); }
    catch (error) { failure = String(error.message); }
    record.submission = submission;
    if (submission?.status === 'unsupported') failure = `Model declined: ${submission.summary}`;
    if (submission?.status === 'supported') {
      const run = await dockerRun(IMAGE, { operation: 'auto-port-verify', gameId: game.id, patches: submission.patches, unitsPerSourcePixel: submission.unitsPerSourcePixel, componentId: ACCEPTED_COMPONENT_ID });
      const report = run.result?.ok ? run.result : { passed: false, checks: [{ name: 'worker', passed: false, error: run.error ?? 'worker failed' }] };
      record.report = report;
      passed = report.passed === true;
      failure = passed ? null : report.checks.filter(check => !check.passed).map(check => check.name).join(', ');
      if (!passed) feedback = repairFeedback(submission, report);
    }
    record.wallMs = Date.now() - started;
    attempts.push(record);
    await writeFile(join(directory, `${game.id}-attempt-${attempt}.json`), JSON.stringify(record, null, 2) + '\n');
    console.log(`${game.id} attempt ${attempt}: ${passed ? 'PASSED' : `failed (${failure})`} · ${(record.wallMs / 1000).toFixed(1)}s · $${record.estimatedCostUsd.toFixed(4)}`);
    if (submission?.status === 'unsupported') break;
  }
  return { id: game.id, status: passed ? 'passed' : 'failed', failure, attempts, estimatedCostUsd: attempts.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0) };
}

if (values.freeze) {
  await writeFile(MANIFEST, JSON.stringify(await definition(), null, 2) + '\n');
  console.log(`Wrote ${MANIFEST}. Commit it before any model request.`);
  process.exit(0);
}
const frozen = JSON.parse(await readFile(MANIFEST, 'utf8'));
assert.deepEqual(await definition(), frozen, 'The code no longer matches the frozen plan');
assert.equal(execFileSync('git', ['status', '--porcelain', '--', MANIFEST, ...Object.keys(frozen.sources)], { encoding: 'utf8' }), '', 'Commit the frozen plan and its sources first');
assert.ok(values['allow-paid'], 'Pass --allow-paid to spend Baseten credits');
assert.ok(values.out, 'Pass --out <new directory>');
loadEnvFile('.env');
const client = createOpenClient(process.env.BASETEN_API_KEY);
await mkdir(values.out, { recursive: true });
const resultsPath = join(values.out, 'results.json');
const results = existsSync(resultsPath) ? JSON.parse(await readFile(resultsPath, 'utf8'))
  : { name: frozen.name, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), model: frozen.model, games: [] };
for (const game of frozen.games) {
  if (results.games.some(entry => entry.id === game.id)) continue;
  results.games.push(game.status === 'excluded' ? { id: game.id, status: 'excluded', reason: game.reason } : await portGame(client, game, values.out));
  await writeFile(resultsPath, JSON.stringify(results, null, 2) + '\n');
}
const passed = results.games.filter(game => game.status === 'passed').length, eligible = results.games.filter(game => game.status !== 'excluded').length;
console.log(`${passed} of ${eligible} eligible games passed; $${results.games.reduce((sum, game) => sum + (game.estimatedCostUsd ?? 0), 0).toFixed(4)} estimated.`);
