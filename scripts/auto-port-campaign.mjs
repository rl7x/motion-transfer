import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { DRIVERS, EXCLUDED } from '../src/auto-port/drivers.mjs';
import { AUTO_PORT, autoPortRequest, readSubmission, repairFeedback } from '../src/auto-port/request.mjs';
import { VERIFY } from '../src/auto-port/verify.mjs';
import { dockerRun } from '../src/hosting/broker.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';

const MANIFEST = 'src/benchmark/auto-port-tasks.json';
const FROZEN = ['assets/auto-port/lock.json', 'src/auto-port/browser.mjs', 'src/auto-port/drivers.mjs', 'src/auto-port/patches.mjs',
  'src/auto-port/request.mjs', 'src/auto-port/runtime.mjs', 'src/auto-port/verify.mjs', 'scripts/auto-port-generate.mjs'];
const IMAGE = 'motion-transfer-verifier:local';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: {
  freeze: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'allow-paid': { type: 'boolean' }, out: { type: 'string' }, game: { type: 'string' },
} });

async function definition() {
  const lock = JSON.parse(await readFile('assets/auto-port/lock.json', 'utf8'));
  const sources = {};
  for (const path of FROZEN) sources[path] = digest(await readFile(path));
  return {
    schemaVersion: 1, name: 'auto-port-v1', question: 'Can Muse Spark connect a recovered dash to games nobody prepared, verified without trusting the model?',
    upstream: { repository: lock.repository, revision: lock.revision, license: lock.license },
    componentId: ACCEPTED_COMPONENT_ID, generation: AUTO_PORT, verification: VERIFY,
    games: [
      ...Object.values(DRIVERS).map(({ id, core, tests, dashKey, field }) => ({ id, status: 'eligible', core, tests, dashKey, field })),
      ...Object.entries(EXCLUDED).map(([id, reason]) => ({ id, status: 'excluded', reason })),
    ],
    sources,
  };
}

async function cloudSandbox() {
  loadEnvFile('.env.local');
  const { Sandbox } = await import('../src/hosting/vercel/sdk.mjs');
  const { name } = JSON.parse(await readFile('reports/vercel-deployment/backend-state.json', 'utf8'));
  const sandbox = await Sandbox.get({ name, resume: true });
  await sandbox.writeFiles([{ path: '/app/scripts/auto-port-generate.mjs', content: await readFile('scripts/auto-port-generate.mjs') }]);
  return sandbox;
}

/** Spend only where the authoritative ledger lives; the response comes back as a file. */
async function cloudGenerate(sandbox, job) {
  const input = `/tmp/auto-port-${job.id}.json`, output = `/tmp/auto-port-${job.id}-out.json`;
  await sandbox.writeFiles([{ path: input, content: Buffer.from(JSON.stringify(job)) }]);
  const run = await sandbox.runCommand({ cmd: 'node', args: ['scripts/auto-port-generate.mjs', input, output], cwd: '/app' });
  if (run.exitCode !== 0) throw Error(`Generation failed: ${(await run.stderr()).slice(-500)}`);
  if (job.dryRun) return (await run.stdout()).trim();
  return JSON.parse((await sandbox.readFileToBuffer({ path: output })).toString('utf8'));
}

async function portGame(sandbox, game, directory) {
  const source = await readFile(`assets/auto-port/games/${game.id}/${game.core}`, 'utf8');
  const attempts = [];
  let feedback = null, passed = false, failure = null;
  for (let attempt = 1; attempt <= AUTO_PORT.maxAttempts && !passed; attempt += 1) {
    const request = autoPortRequest({ file: game.core, source, feedback });
    const started = Date.now();
    const generated = await cloudGenerate(sandbox, { id: `auto-port-${game.id}-${attempt}-${randomUUID()}`, game: game.id, attempt, maxCostUsd: AUTO_PORT.maxAttemptCostUsd, request });
    const record = { attempt, ...generated, request: { ...request, input: 'game source omitted; see the pinned file', feedback } };
    let submission = null;
    try { submission = readSubmission(generated.response); }
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
    console.log(`${game.id} attempt ${attempt}: ${passed ? 'PASSED' : `failed (${failure})`} · ${(record.wallMs / 1000).toFixed(1)}s · $${(generated.estimatedCostUsd ?? 0).toFixed(5)}`);
    if (submission?.status === 'unsupported') break;
  }
  return { id: game.id, status: passed ? 'passed' : 'failed', failure, attempts: attempts.length, estimatedCostUsd: attempts.reduce((sum, entry) => sum + (entry.estimatedCostUsd ?? 0), 0), wallMs: attempts.reduce((sum, entry) => sum + entry.wallMs, 0) };
}

if (values.freeze) {
  await writeFile(MANIFEST, JSON.stringify(await definition(), null, 2) + '\n');
  console.log(`Wrote ${MANIFEST}. Commit it before any model request.`);
  process.exit(0);
}
const frozen = JSON.parse(await readFile(MANIFEST, 'utf8'));
assert.deepEqual(await definition(), frozen, 'The code no longer matches the frozen manifest');
assert.equal(execFileSync('git', ['status', '--porcelain', '--', MANIFEST, ...FROZEN], { encoding: 'utf8' }), '', 'Commit the frozen manifest and its sources first');
const sandbox = await cloudSandbox();
if (values['dry-run']) {
  console.log(await cloudGenerate(sandbox, { id: `auto-port-dry-${randomUUID()}`, dryRun: true }));
  process.exit(0);
}
assert.ok(values['allow-paid'], 'Pass --allow-paid to spend through the authoritative ledger');
assert.ok(values.out, 'Pass --out <new directory>');
await mkdir(values.out, { recursive: true });
const resultsPath = join(values.out, 'results.json');
const results = existsSync(resultsPath) ? JSON.parse(await readFile(resultsPath, 'utf8')) : { name: frozen.name, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), games: [] };
for (const game of frozen.games) {
  if (values.game && game.id !== values.game) continue;
  if (results.games.some(entry => entry.id === game.id)) continue;
  results.games.push(game.status === 'excluded' ? { id: game.id, status: 'excluded', reason: game.reason } : await portGame(sandbox, game, values.out));
  await writeFile(resultsPath, JSON.stringify(results, null, 2) + '\n');
}
const passed = results.games.filter(game => game.status === 'passed').length, eligible = results.games.filter(game => game.status !== 'excluded').length;
console.log(`${passed} of ${eligible} eligible games passed; $${results.games.reduce((sum, game) => sum + (game.estimatedCostUsd ?? 0), 0).toFixed(5)} estimated.`);
