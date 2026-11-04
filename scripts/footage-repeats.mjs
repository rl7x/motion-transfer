import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { createOpenClient, OPEN_MODEL, OPEN_MODEL_NAME, OPEN_PRICE } from '../src/agent/open-client.mjs';
import { freezeFidelityStudy, scoreFidelityStudy } from '../src/benchmark/fidelity.mjs';
import { CLIP_SCALE, FIRST_PLAY_FRAME, PLAYER_POINT } from '../src/footage/calibration.mjs';
import { ledgerSam } from '../src/footage/cloud-sam.mjs';
import { recoverMove } from '../src/footage/recover.mjs';

/*
 * One good run can be luck, so this repeats the controller step in fresh sessions on the same clip.
 * The plan is committed before the first request, and every session is reported. Each one gets its
 * own exam seed, created after that session's controller is frozen.
 */
const MANIFEST = 'src/benchmark/footage-repeat-v2-tasks.json';
const CLIP = 'reports/footage/calibration-v3/clip.mp4';
const SESSIONS = 6;
const FROZEN = ['src/footage/calibration.mjs', 'src/footage/clip.mjs', 'src/footage/grade.mjs', 'src/footage/landmarks.mjs', 'src/footage/recover.mjs',
  'src/footage/request.mjs', 'src/footage/sam.mjs', 'src/footage/trajectory.mjs', 'src/agent/open-client.mjs', 'scripts/footage-repeats.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: { freeze: { type: 'boolean' }, 'allow-paid': { type: 'boolean' }, out: { type: 'string' } } });

async function definition() {
  const sources = {};
  for (const path of FROZEN) sources[path] = digest(await readFile(path));
  return {
    schemaVersion: 1, name: 'footage-repeat-v2', follows: { name: 'footage-repeat-v1', outcome: '2 of 5 sessions scored 40/40; the others scored 14, 16 and 0 after passing every footage check. Those checks never tested walking speed or a dash with no direction held, and the reported diagonal speed was wrong.' },
    question: 'How often does a fresh Muse Spark Open session reach the same exam result from the same footage?',
    sessions: SESSIONS, controllerModel: OPEN_MODEL, maxAttempts: 3, clipSha256: digest(await readFile(CLIP)),
    reported: 'Every session started, including failures.', sources,
  };
}

if (values.freeze) {
  await writeFile(MANIFEST, JSON.stringify(await definition(), null, 2) + '\n');
  console.log(`Wrote ${MANIFEST}. Commit it before any model request.`);
  process.exit(0);
}
const frozen = JSON.parse(await readFile(MANIFEST, 'utf8'));
assert.deepEqual(await definition(), frozen, 'The code no longer matches the frozen plan');
assert.equal(execFileSync('git', ['status', '--porcelain', '--', MANIFEST, ...FROZEN], { encoding: 'utf8' }), '', 'Commit the frozen plan and its sources first');
assert.ok(values['allow-paid'], 'Pass --allow-paid to spend through the ledger and Baseten');
assert.ok(values.out, 'Pass --out <directory>');
loadEnvFile('.env');
await mkdir(values.out, { recursive: true });

// Tracking is the same each time, so only the first session pays for it.
const cacheDirectory = 'reports/footage/repeats-v1/sam-cache';
let live = null;
const sam = async job => {
  const path = join(cacheDirectory, `${createHash('sha256').update(job.video).update(job.prompt).digest('hex')}.json`);
  if (existsSync(path)) return { ...JSON.parse(await readFile(path, 'utf8')), estimatedCostUsd: 0 };
  live ??= await ledgerSam();
  const result = await live(job);
  await writeFile(path, JSON.stringify(result));
  return result;
};

const client = createOpenClient(process.env.BASETEN_API_KEY);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sessions = [];
for (let session = 1; session <= SESSIONS; session += 1) {
  const directory = join(values.out, `session-${session}`);
  const record = { session, status: 'rejected', attempts: [], exam: null, config: null, failure: null };
  let modelUsd = 0;
  try {
    const result = await recoverMove({
      clip: CLIP, out: join(directory, 'recovered'), rights: 'open-license', source: 'Dashy Dango by samX500 and willGuimont (ISC)',
      player: PLAYER_POINT, pixelScale: CLIP_SCALE, from: FIRST_PLAY_FRAME, playStart: FIRST_PLAY_FRAME, sam, model: OPEN_MODEL, modelName: OPEN_MODEL_NAME,
      log: line => { if (/attempt|Attempt/.test(line)) console.log(`session ${session}: ${line}`); },
      generate: async request => {
        const response = await client.respond(request);
        const estimatedCostUsd = tokenCost(readUsage(response.usage), OPEN_PRICE);
        modelUsd += estimatedCostUsd;
        return { response, estimatedCostUsd };
      },
    });
    const study = join(directory, 'study');
    await freezeFidelityStudy(study, [
      { id: 'from-footage', condition: 'video', sourcePath: join(result.out, 'component.ts'), configPath: join(result.out, 'contract.json') },
    ]);
    const score = await scoreFidelityStudy(study);
    Object.assign(record, {
      status: 'scored', source: result.submission.source, config: result.submission.config, summary: result.submission.summary,
      attempts: result.report.attempts.map(({ attempt, passed, failures, estimatedCostUsd }) => ({ attempt, passed, failures, estimatedCostUsd })),
      exam: { seed: score.seed, passed: score.results[0].passed, total: score.results[0].total },
    });
  } catch (error) {
    record.failure = error.message;
  }
  record.estimatedCostUsd = modelUsd;
  sessions.push(record);
  console.log(`session ${session}: ${record.status}${record.exam ? ` ${record.exam.passed}/${record.exam.total}` : ` (${record.failure})`} · $${modelUsd.toFixed(4)}`);
  await writeFile(join(values.out, 'results.json'), JSON.stringify({ name: frozen.name, commit, model: frozen.controllerModel, sessions }, null, 2) + '\n');
}
const perfect = sessions.filter(session => session.exam?.passed === session.exam?.total && session.exam).length;
console.log(`${perfect} of ${SESSIONS} sessions passed every exam trace.`);
